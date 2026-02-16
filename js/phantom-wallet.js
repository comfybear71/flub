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

            // Fetch on-chain balances (SOL + USDC)
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

            // Fetch on-chain balances
            await this.fetchOnChainBalances();

            this.saveUserSession();
            UI.updateWalletStatus('connected', this.walletAddress);
        }
    },

    handleDisconnect() {
        this.walletAddress = null;
        this.isConnected = false;
        State.userRole = null;
        State.walletBalances = { sol: 0, usdc: 0 };
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

            // Fetch SOL and USDC balances in parallel
            const [solBalance, usdcBalance] = await Promise.all([
                this._getSolBalance(rpcUrl),
                this._getUsdcBalance(rpcUrl)
            ]);

            State.walletBalances = {
                sol: solBalance,
                usdc: usdcBalance
            };

            Logger.log(`Wallet: ${solBalance.toFixed(4)} SOL, ${usdcBalance.toFixed(2)} USDC`, 'success');

            // Update panel if it's open
            this.updateWalletPanel();

        } catch (error) {
            Logger.log(`Balance fetch error: ${error.message}`, 'error');
        }
    },

    _getRpcUrl() {
        // Use Helius if API key is configured, otherwise fall back to public RPC
        if (CONFIG.HELIUS_API_KEY) {
            return `https://mainnet.helius-rpc.com/?api-key=${CONFIG.HELIUS_API_KEY}`;
        }
        return CONFIG.SOLANA_RPC;
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

    async _getUsdcBalance(rpcUrl) {
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
                        { mint: CONFIG.USDC_MINT },
                        { encoding: 'jsonParsed' }
                    ]
                })
            });
            const data = await response.json();
            if (data.error) {
                Logger.log(`USDC RPC error: ${data.error.message}`, 'error');
                return 0;
            }
            const accounts = data.result?.value || [];
            if (accounts.length === 0) return 0;

            // Sum all USDC token accounts (usually just one)
            let total = 0;
            for (const account of accounts) {
                const info = account.account?.data?.parsed?.info;
                if (info) {
                    total += parseFloat(info.tokenAmount?.uiAmount || 0);
                }
            }
            return total;
        } catch (e) {
            Logger.log(`USDC balance error: ${e.message}`, 'error');
            return 0;
        }
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
        const holdingsListEl = document.getElementById('walletPanelHoldingsList');

        if (addrEl) addrEl.textContent = this.walletAddress || '';
        if (roleEl) {
            const role = State.userRole || 'user';
            roleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            roleEl.className = `wallet-panel-role-badge ${role}`;
        }
        if (allocEl) allocEl.textContent = (State.userAllocation || 0).toFixed(2) + '%';
        if (depositedEl) depositedEl.textContent = Assets.formatCurrency(State.userDeposits || 0);
        if (valueEl) valueEl.textContent = Assets.formatCurrency(State.userDeposits || 0);

        // On-chain balances
        if (solEl) solEl.textContent = (State.walletBalances.sol || 0).toFixed(4) + ' SOL';
        if (usdcEl) usdcEl.textContent = (State.walletBalances.usdc || 0).toFixed(2) + ' USDC';

        // Show user's pool holdings
        if (holdingsListEl) {
            const holdings = State.userHoldings || {};
            const entries = Object.entries(holdings).filter(([_, amt]) => amt > 0);
            if (entries.length > 0) {
                holdingsListEl.innerHTML = entries.map(([coin, amt]) => {
                    return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                        <span style="color:#94a3b8;">${coin}</span>
                        <span style="color:#e2e8f0;font-weight:600;">${parseFloat(amt).toFixed(6)}</span>
                    </div>`;
                }).join('');
            } else {
                holdingsListEl.textContent = 'No holdings yet';
            }
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
