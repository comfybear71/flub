// ==========================================
// PHANTOM WALLET - Solana Wallet Integration
// ==========================================

const PhantomWallet = {
    provider: null,
    walletAddress: null,
    isConnected: false,

    async init() {
        // Check if Phantom is installed
        if (window.solana && window.solana.isPhantom) {
            this.provider = window.solana;
            Logger.log('Phantom wallet detected', 'success');

            // Check if already connected
            if (this.provider.isConnected) {
                await this.handleConnect();
            }

            // Listen for account changes
            this.provider.on('connect', () => this.handleConnect());
            this.provider.on('disconnect', () => this.handleDisconnect());
            this.provider.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    this.walletAddress = publicKey.toString();
                    this.determineRole();
                    this.saveUserSession();
                } else {
                    this.handleDisconnect();
                }
            });
        } else {
            Logger.log('Phantom wallet not found', 'error');
            this.showInstallPrompt();
        }

        // Click-outside to close wallet panel
        this._initClickOutside();
    },

    // ── Click-outside handler ────────────────────────────────────────────────

    _initClickOutside() {
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('walletPanel');
            if (!panel || !panel.classList.contains('show')) return;

            const content = panel.querySelector('.wallet-panel-content');
            const phantomBtn = document.getElementById('phantomBtn');

            // Close if click is on the overlay backdrop (not the content or the trigger button)
            if (!content.contains(e.target) && !phantomBtn.contains(e.target)) {
                panel.classList.remove('show');
            }
        });
    },

    // ── Role determination (no backend needed) ───────────────────────────────

    determineRole() {
        if (CONFIG.ADMIN_WALLETS.includes(this.walletAddress)) {
            State.userRole = 'admin';
        } else {
            State.userRole = 'user';
        }
        UI.applyRole(State.userRole);
        Logger.log(`Role: ${State.userRole}`, 'success');
    },

    // ── Connection ───────────────────────────────────────────────────────────

    async connect() {
        if (!this.provider) {
            this.showInstallPrompt();
            return;
        }

        try {
            Logger.log('Connecting to Phantom...', 'info');
            const response = await this.provider.connect();
            this.walletAddress = response.publicKey.toString();
            this.isConnected = true;

            Logger.log(`Connected: ${this.walletAddress.substring(0, 8)}...`, 'success');

            // Determine role immediately from config
            this.determineRole();

            // Auto-register in MongoDB (non-blocking)
            this._registerInBackend();

            // Load server-synced state (auto-trader config, pending orders, etc.)
            if (typeof ServerState !== 'undefined' && State.userRole === 'admin') {
                ServerState.load();
            }

            // Load deposit history from localStorage
            UI.loadDeposits(this.walletAddress);

            // Fetch on-chain balances (SOL + USDC + BUDJU)
            await this.fetchOnChainBalances();

            this.saveUserSession();
            UI.updateWalletStatus('connected', this.walletAddress);

        } catch (error) {
            Logger.log(`Connection failed: ${error.message}`, 'error');
            UI.updateWalletStatus('disconnected');
        }
    },

    async disconnect() {
        if (this.provider && this.isConnected) {
            try {
                await this.provider.disconnect();
                this.handleDisconnect();
            } catch (error) {
                Logger.log(`Disconnect failed: ${error.message}`, 'error');
            }
        }
    },

    async handleConnect() {
        if (this.provider.publicKey) {
            this.walletAddress = this.provider.publicKey.toString();
            this.isConnected = true;

            // Determine role immediately from config
            this.determineRole();

            // Auto-register in MongoDB (non-blocking)
            this._registerInBackend();

            // Load server-synced state
            if (typeof ServerState !== 'undefined' && State.userRole === 'admin') {
                ServerState.load();
            }

            // Load deposit history from localStorage
            UI.loadDeposits(this.walletAddress);

            // Fetch on-chain balances
            await this.fetchOnChainBalances();

            this.saveUserSession();
            UI.updateWalletStatus('connected', this.walletAddress);
        }
    },

    async _registerInBackend() {
        if (!this.walletAddress) return;
        try {
            const res = await fetch('/api/user/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: this.walletAddress })
            });
            if (res.ok) {
                const data = await res.json();
                Logger.log(`Registered in backend: ${data.role}`, 'success');
                this.saveUserData(data);

                // Sync any localStorage deposits to MongoDB
                this._syncDepositsToBackend();
            } else {
                Logger.log('Backend registration skipped', 'info');
            }
        } catch (e) {
            Logger.log('Backend registration unavailable (offline mode)', 'info');
        }
    },

    async _syncDepositsToBackend() {
        if (!this.walletAddress) return;

        const key = `flub_deposits_${this.walletAddress}`;
        const depositsRaw = localStorage.getItem(key);
        if (!depositsRaw) return;

        const deposits = JSON.parse(depositsRaw);
        if (!deposits || deposits.length === 0) return;

        // Get current pool value for context
        const totalPoolValue = State.portfolioData?.assets?.reduce(
            (sum, a) => sum + (a.usd_value || 0), 0
        ) || 0;

        try {
            const res = await fetch('/api/user/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: this.walletAddress,
                    deposits: deposits,
                    totalPoolValue: totalPoolValue
                })
            });

            if (res.ok) {
                const result = await res.json();
                if (result.imported > 0) {
                    Logger.log(
                        `Synced ${result.imported} deposits to database ` +
                        `(${result.skipped} already existed)`, 'success'
                    );
                }
            }
        } catch (e) {
            Logger.log('Deposit sync to database unavailable', 'info');
        }
    },

    handleDisconnect() {
        this.walletAddress = null;
        this.isConnected = false;
        State.userRole = null;
        State.walletBalances = { sol: 0, usdc: 0, budju: 0 };
        this.clearUserSession();
        UI.updateWalletStatus('disconnected');
        UI.applyRole(null);
        Logger.log('Wallet disconnected', 'info');
    },

    // ── On-chain balance fetching (Helius RPC) ──────────────────────────────

    async fetchOnChainBalances() {
        if (!this.walletAddress) return;

        try {
            Logger.log('Fetching on-chain balances...', 'info');

            const rpcUrl = this._getRpcUrl();

            // Fetch SOL, USDC and BUDJU balances in parallel
            const [solBalance, usdcBalance, budjuBalance] = await Promise.all([
                this._getSolBalance(rpcUrl),
                this._getTokenBalance(rpcUrl, CONFIG.USDC_MINT),
                this._getTokenBalance(rpcUrl, CONFIG.BUDJU_MINT)
            ]);

            State.walletBalances = {
                sol: solBalance,
                usdc: usdcBalance,
                budju: budjuBalance
            };

            Logger.log(`Wallet: ${solBalance.toFixed(4)} SOL, ${usdcBalance.toFixed(2)} USDC, ${Math.floor(budjuBalance)} BUDJU`, 'success');

            // Update panel if it's open
            this.updateWalletPanel();

            // Update deposited banner with latest wallet balance
            UI._updateUserDepositBanner();

        } catch (error) {
            Logger.log(`Balance fetch error: ${error.message}`, 'error');
        }
    },

    _getRpcUrl() {
        // Route through server-side proxy so the Helius key stays secret
        return CONFIG.RPC_PROXY || CONFIG.SOLANA_RPC;
    },

    async _getSolBalance(rpcUrl) {
        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getBalance',
                    params: [this.walletAddress]
                })
            });
            const data = await response.json();
            if (data.error) {
                Logger.log(`SOL RPC error: ${data.error.message}`, 'error');
                return 0;
            }
            // Convert lamports to SOL (1 SOL = 1e9 lamports)
            return (data.result?.value || 0) / 1e9;
        } catch (e) {
            Logger.log(`SOL balance error: ${e.message}`, 'error');
            return 0;
        }
    },

    async _getTokenBalance(rpcUrl, mintAddress) {
        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [
                        this.walletAddress,
                        { mint: mintAddress },
                        { encoding: 'jsonParsed' }
                    ]
                })
            });
            const data = await response.json();
            if (data.error) {
                Logger.log(`Token RPC error (${mintAddress.substring(0,8)}): ${data.error.message}`, 'error');
                return 0;
            }
            const accounts = data.result?.value || [];
            if (accounts.length === 0) return 0;

            // Sum all token accounts (usually just one)
            let total = 0;
            for (const account of accounts) {
                const info = account.account?.data?.parsed?.info;
                if (info) {
                    total += parseFloat(info.tokenAmount?.uiAmount || 0);
                }
            }
            return total;
        } catch (e) {
            Logger.log(`Token balance error: ${e.message}`, 'error');
            return 0;
        }
    },

    // ── USDC Deposit (on-chain SPL transfer via Phantom) ─────────────────────

    async sendUsdcDeposit(amount) {
        if (!this.provider || !this.isConnected) {
            throw new Error('Wallet not connected');
        }

        const depositAddress = CONFIG.DEPOSIT_ADDRESS;
        if (!depositAddress) {
            throw new Error('Deposit address not configured');
        }

        Logger.log(`Initiating USDC transfer: ${amount} USDC to ${depositAddress.substring(0,8)}...`, 'info');

        // We need to build a Solana transaction to transfer SPL USDC tokens.
        // Since we don't have @solana/web3.js loaded, we use the raw transaction approach
        // via Phantom's signAndSendTransaction with a versioned transaction.
        // However, the simplest approach: use Phantom's built-in transfer request.

        // Build the SPL token transfer instruction manually using Solana RPC
        const rpcUrl = this._getRpcUrl();

        // 1. Find the sender's USDC token account
        const senderAta = await this._findTokenAccount(rpcUrl, this.walletAddress, CONFIG.USDC_MINT);
        if (!senderAta) {
            throw new Error('No USDC token account found in your wallet');
        }

        // 2. Find or derive the recipient's USDC token account
        const recipientAta = await this._findTokenAccount(rpcUrl, depositAddress, CONFIG.USDC_MINT);
        if (!recipientAta) {
            throw new Error('Deposit address USDC account not found. Please contact admin.');
        }

        // 3. Build the transaction using raw bytes
        // USDC has 6 decimals
        const usdcAmount = Math.round(amount * 1_000_000);

        // Get recent blockhash
        const bhResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getLatestBlockhash',
                params: [{ commitment: 'finalized' }]
            })
        });
        const bhData = await bhResponse.json();
        if (bhData.error) throw new Error('Failed to get blockhash: ' + bhData.error.message);
        const blockhash = bhData.result.value.blockhash;

        // Build a legacy transaction with SPL Token Transfer instruction
        const tx = this._buildSplTransferTx(
            this.walletAddress,
            senderAta,
            recipientAta,
            usdcAmount,
            blockhash
        );

        // 4. Sign and send via Phantom
        const { signature } = await this.provider.signAndSendTransaction(tx);
        Logger.log(`USDC deposit sent! TX: ${signature.substring(0, 16)}...`, 'success');

        return signature;
    },

    async _findTokenAccount(rpcUrl, owner, mint) {
        try {
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [owner, { mint }, { encoding: 'jsonParsed' }]
                })
            });
            const data = await response.json();
            const accounts = data.result?.value || [];
            if (accounts.length === 0) return null;
            return accounts[0].pubkey;
        } catch (e) {
            return null;
        }
    },

    _buildSplTransferTx(feePayer, fromAta, toAta, amount, recentBlockhash) {
        // This builds a minimal Solana legacy transaction with a single
        // SPL Token Program Transfer instruction.
        // We use base58 decode/encode helpers and raw byte assembly.

        const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

        // Decode base58 addresses to byte arrays
        const feePayerBytes = this._base58Decode(feePayer);
        const fromBytes = this._base58Decode(fromAta);
        const toBytes = this._base58Decode(toAta);
        const ownerBytes = feePayerBytes; // The fee payer is the token owner
        const programBytes = this._base58Decode(TOKEN_PROGRAM_ID);
        const blockhashBytes = this._base58Decode(recentBlockhash);

        // SPL Token Transfer instruction (instruction index 3)
        // Data: [3] + little-endian u64 amount
        const data = new Uint8Array(9);
        data[0] = 3; // Transfer instruction
        // Write amount as little-endian u64
        let remaining = amount;
        for (let i = 1; i < 9; i++) {
            data[i] = remaining & 0xff;
            remaining = Math.floor(remaining / 256);
        }

        // Build the transaction message
        // Header: num_required_signatures(1), num_readonly_signed(0), num_readonly_unsigned(1)
        const header = new Uint8Array([1, 0, 1]);

        // Account keys: [feePayer/owner, fromAta, toAta, tokenProgram]
        const numKeys = 4;
        const accountKeys = new Uint8Array(numKeys * 32);
        accountKeys.set(feePayerBytes, 0);
        accountKeys.set(fromBytes, 32);
        accountKeys.set(toBytes, 64);
        accountKeys.set(programBytes, 96);

        // Recent blockhash (32 bytes)
        // Instruction: programIdIndex=3, accounts=[1,2,0], data
        const instruction = new Uint8Array([
            3,              // program ID index (tokenProgram is at index 3)
            3,              // num accounts
            1, 2, 0,        // account indices: from(1), to(2), owner(0)
            data.length,    // data length
            ...data
        ]);

        // Assemble the message
        const message = new Uint8Array([
            ...header,
            numKeys,
            ...accountKeys,
            ...blockhashBytes,
            1, // num instructions
            ...instruction
        ]);

        // Create a transaction object that Phantom can sign
        // Phantom expects a Transaction-like object; we use the serialized message
        const transaction = {
            serialize: () => {
                // Prepend signature placeholder (1 signature, 64 zero bytes)
                const sigCount = new Uint8Array([1]);
                const sigPlaceholder = new Uint8Array(64);
                const full = new Uint8Array(sigCount.length + sigPlaceholder.length + message.length);
                full.set(sigCount, 0);
                full.set(sigPlaceholder, sigCount.length);
                full.set(message, sigCount.length + sigPlaceholder.length);
                return full;
            },
            message: { serialize: () => message }
        };

        return transaction;
    },

    _base58Decode(str) {
        const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const bytes = [0];
        for (let i = 0; i < str.length; i++) {
            const c = ALPHABET.indexOf(str[i]);
            if (c < 0) throw new Error(`Invalid base58 char: ${str[i]}`);
            for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
            bytes[0] += c;
            let carry = 0;
            for (let j = 0; j < bytes.length; j++) {
                bytes[j] += carry;
                carry = (bytes[j] >> 8);
                bytes[j] &= 0xff;
            }
            while (carry > 0) {
                bytes.push(carry & 0xff);
                carry >>= 8;
            }
        }
        // Handle leading zeros
        for (let i = 0; i < str.length && str[i] === '1'; i++) {
            bytes.push(0);
        }
        return new Uint8Array(bytes.reverse());
    },

    // ── Wallet panel ─────────────────────────────────────────────────────────

    toggleWalletPanel() {
        const panel = document.getElementById('walletPanel');
        if (!panel) return;

        if (panel.classList.contains('show')) {
            panel.classList.remove('show');
        } else {
            this.updateWalletPanel();
            panel.classList.add('show');
            // Refresh balances in background (panel shows cached values immediately)
            this.fetchOnChainBalances();
        }
    },

    updateWalletPanel() {
        const addrEl = document.getElementById('walletPanelAddress');
        const roleEl = document.getElementById('walletPanelRole');
        const allocEl = document.getElementById('walletPanelAllocation');
        const depositedEl = document.getElementById('walletPanelDeposited');
        const valueEl = document.getElementById('walletPanelValue');
        const solEl = document.getElementById('walletPanelSol');
        const usdcEl = document.getElementById('walletPanelUsdc');
        const budjuEl = document.getElementById('walletPanelBudju');
        const budjuReqEl = document.getElementById('budjuRequirement');
        const holdingsListEl = document.getElementById('walletPanelHoldingsList');

        if (addrEl && this.walletAddress) {
            const w = this.walletAddress;
            addrEl.textContent = `${w.substring(0, 4)}...${w.substring(w.length - 4)}`;
            addrEl.title = w; // Full address on hover
        } else if (addrEl) {
            addrEl.textContent = '';
        }
        if (roleEl) {
            const role = State.userRole || 'user';
            roleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            roleEl.className = `wallet-panel-role-badge ${role}`;
        }
        if (allocEl) allocEl.textContent = (State.userAllocation || 0).toFixed(2) + '%';
        if (depositedEl) depositedEl.textContent = Assets.formatCurrency(State.userDeposits || 0);

        // Current portfolio value from share-based accounting
        const alloc = State.userAllocation || 0;
        const currentValue = State.userCurrentValue || (State.userDeposits || 0);
        if (valueEl) valueEl.textContent = Assets.formatCurrency(currentValue);

        // On-chain balances
        if (solEl) solEl.textContent = (State.walletBalances.sol || 0).toFixed(4);
        if (usdcEl) usdcEl.textContent = (State.walletBalances.usdc || 0).toFixed(2);
        if (budjuEl) budjuEl.textContent = Math.floor(State.walletBalances.budju || 0).toLocaleString();

        // Show BUDJU requirement notice with shortfall
        if (budjuReqEl) {
            const budju = State.walletBalances.budju || 0;
            const needsMore = budju < CONFIG.BUDJU_REQUIRED;
            budjuReqEl.style.display = needsMore ? 'block' : 'none';
            if (needsMore) {
                const shortfall = Math.ceil(CONFIG.BUDJU_REQUIRED - budju);
                const shortfallEl = document.getElementById('budjuShortfall');
                if (shortfallEl) shortfallEl.textContent = shortfall.toLocaleString();
            }
        }

        // Build user's proportional holdings from pool data
        if (holdingsListEl) {
            const cryptoAssets = State.portfolioData.assets.filter(
                a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
            );
            if (alloc > 0 && cryptoAssets.length > 0) {
                // Update State.userHoldings with proportional values
                State.userHoldings = {};
                cryptoAssets.forEach(a => {
                    State.userHoldings[a.code] = a.balance * (alloc / 100);
                });

                holdingsListEl.innerHTML = cryptoAssets.map(a => {
                    const userBal = a.balance * (alloc / 100);
                    const userVal = a.usd_value * (alloc / 100);
                    return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                        <span style="color:#94a3b8;">${a.code}</span>
                        <span style="color:#e2e8f0;font-weight:600;">${userBal.toFixed(6)} <span style="color:#64748b;font-size:11px;">(${Assets.formatCurrency(userVal)})</span></span>
                    </div>`;
                }).join('');
            } else {
                State.userHoldings = {};
                holdingsListEl.textContent = State.userDeposits > 0 ? 'Awaiting trades...' : 'No holdings yet';
            }
        }
    },

    // ── Copy wallet address ──────────────────────────────────────────────────

    async copyAddress() {
        if (!this.walletAddress) return;
        try {
            await navigator.clipboard.writeText(this.walletAddress);
            const btn = document.getElementById('copyWalletBtn');
            if (btn) {
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
                setTimeout(() => {
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                }, 1500);
            }
        } catch (e) {
            Logger.log('Failed to copy address', 'error');
        }
    },

    // ── Session management ───────────────────────────────────────────────────

    saveUserSession() {
        localStorage.setItem('phantom_wallet', this.walletAddress);
        localStorage.setItem('phantom_connected', 'true');
    },

    clearUserSession() {
        localStorage.removeItem('phantom_wallet');
        localStorage.removeItem('phantom_connected');
        localStorage.removeItem('user_data');
    },

    saveUserData(userData) {
        localStorage.setItem('user_data', JSON.stringify(userData));
    },

    getUserData() {
        const data = localStorage.getItem('user_data');
        return data ? JSON.parse(data) : null;
    },

    showInstallPrompt() {
        const modal = document.getElementById('phantomInstallModal');
        if (modal) {
            modal.classList.add('show');
        } else {
            alert('Phantom wallet not detected. Please install it from https://phantom.app/');
        }
    },

    formatAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
    }
};

// Auto-initialize on page load
if (typeof window !== 'undefined') {
    window.PhantomWallet = PhantomWallet;
}
