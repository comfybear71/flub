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
                    this.saveUserSession();
                } else {
                    this.handleDisconnect();
                }
            });
        } else {
            Logger.log('Phantom wallet not found', 'error');
            this.showInstallPrompt();
        }
    },

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

            // Register or login user in backend
            await this.registerUser();

            // Fetch on-chain balances (SOL + USDC)
            await this.fetchOnChainBalances();

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

    handleConnect() {
        if (this.provider.publicKey) {
            this.walletAddress = this.provider.publicKey.toString();
            this.isConnected = true;
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

    async registerUser() {
        try {
            // Create signature to verify wallet ownership
            const message = `Sign in to Portfolio Trader\nTimestamp: ${Date.now()}`;
            const encodedMessage = new TextEncoder().encode(message);
            const signedMessage = await this.provider.signMessage(encodedMessage, 'utf8');

            // Send to backend for verification and user registration
            const response = await fetch('/api/user/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: this.walletAddress,
                    signature: Array.from(signedMessage.signature),
                    message: message
                })
            });

            if (!response.ok) {
                throw new Error('User registration failed');
            }

            const userData = await response.json();

            // Set role: check frontend config FIRST (instant), then backend
            if (CONFIG.ADMIN_WALLETS.includes(this.walletAddress)) {
                State.userRole = 'admin';
            } else {
                State.userRole = userData.role || 'user';
            }

            this.saveUserData(userData);
            Logger.log(`Authenticated as ${State.userRole}`, 'success');

            // Load user's portfolio data
            await this.loadUserPortfolio();

            // Apply role-based UI
            UI.applyRole(State.userRole);

        } catch (error) {
            Logger.log(`Registration error: ${error.message}`, 'error');
            // Even if backend registration fails, still check admin from config
            if (CONFIG.ADMIN_WALLETS.includes(this.walletAddress)) {
                State.userRole = 'admin';
                UI.applyRole('admin');
                Logger.log('Admin detected from config (backend unavailable)', 'info');
            }
        }
    },

    async loadUserPortfolio() {
        try {
            const response = await fetch(`/api/user/portfolio?wallet=${this.walletAddress}`);
            if (!response.ok) throw new Error('Failed to load portfolio');

            const data = await response.json();

            // Update UI with user's allocation and holdings
            State.userAllocation = data.allocation;
            State.userHoldings = data.holdings;
            State.userDeposits = data.totalDeposited;

            UI.renderUserStats(data);
            Logger.log(`Portfolio loaded: ${data.allocation}% allocation`, 'success');

        } catch (error) {
            Logger.log(`Portfolio load error: ${error.message}`, 'error');
        }
    },

    // ── On-chain balance fetching ────────────────────────────────────────────

    async fetchOnChainBalances() {
        if (!this.walletAddress) return;

        try {
            Logger.log('Fetching on-chain balances...', 'info');

            // Fetch SOL and USDC balances in parallel
            const [solBalance, usdcBalance] = await Promise.all([
                this._getSolBalance(),
                this._getUsdcBalance()
            ]);

            State.walletBalances = {
                sol: solBalance,
                usdc: usdcBalance
            };

            Logger.log(`Wallet: ${solBalance.toFixed(4)} SOL, ${usdcBalance.toFixed(2)} USDC`, 'success');

        } catch (error) {
            Logger.log(`Balance fetch error: ${error.message}`, 'error');
        }
    },

    async _getSolBalance() {
        try {
            const response = await fetch(CONFIG.SOLANA_RPC, {
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
            // Convert lamports to SOL (1 SOL = 1e9 lamports)
            return (data.result?.value || 0) / 1e9;
        } catch (e) {
            Logger.log(`SOL balance error: ${e.message}`, 'error');
            return 0;
        }
    },

    async _getUsdcBalance() {
        try {
            const response = await fetch(CONFIG.SOLANA_RPC, {
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

    // Called when user clicks wallet button while connected
    toggleWalletPanel() {
        const panel = document.getElementById('walletPanel');
        if (!panel) return;

        if (panel.classList.contains('show')) {
            panel.classList.remove('show');
        } else {
            // Refresh on-chain balances when opening panel
            this.fetchOnChainBalances().then(() => this.updateWalletPanel());
            this.updateWalletPanel();
            panel.classList.add('show');
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

    // Format wallet address for display
    formatAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
    }
};

// Auto-initialize on page load
if (typeof window !== 'undefined') {
    window.PhantomWallet = PhantomWallet;
}
