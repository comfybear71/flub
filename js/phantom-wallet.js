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
        this.clearUserSession();
        UI.updateWalletStatus('disconnected');
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
            this.saveUserData(userData);
            Logger.log('User authenticated', 'success');

            // Load user's portfolio data
            await this.loadUserPortfolio();

        } catch (error) {
            Logger.log(`Registration error: ${error.message}`, 'error');
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
