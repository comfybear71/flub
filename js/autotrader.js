// ==========================================
// AutoTrader - Automated Trading Logic
// ==========================================
//
// How it works:
//   1. User selects a coin, sets deviation % and allocation %
//   2. Hits "Start Auto Trading"
//   3. AutoTrader records the current price as basePrice
//   4. Every 60 seconds it checks if price moved ± deviation%
//   5. Price drops by deviation% → AUTO BUY (allocation% of USDC)
//   6. Price rises by deviation% → AUTO SELL (83% of allocation, to accumulate)
//   7. After any trade: 24h cooldown on that coin, auto-stop
//   8. Always keeps $100 USDC minimum reserve
//
// Safe defaults for testing:
//   - Deviation: 2-3% (how far price must move)
//   - Allocation: 2-3% (how much USDC per trade)

const AutoTrader = {
    isActive: false,
    monitorInterval: null,
    basePrice: 0,
    cooldowns: {},
    checkCount: 0,
    COOLDOWN_HOURS: 24,
    MIN_USDC_RESERVE: 100,
    SELL_RATIO: 0.833,   // Sell 2.5% when buying 3% (accumulation mode)

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    start() {
        if (!State.selectedAsset) {
            this._showError('Please select a coin first');
            return;
        }

        const deviation = State.autoTradeConfig.deviation;
        const allocation = State.autoTradeConfig.allocation;

        if (deviation === 0) {
            this._showError('Set price deviation first (slide left or right)');
            return;
        }
        if (allocation === 0) {
            this._showError('Set portfolio allocation first');
            return;
        }

        // Check USDC balance
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        const usdcBalance = usdcAsset?.usd_value ?? 0;

        if (usdcBalance < this.MIN_USDC_RESERVE + 10) {
            this._showError(`Need $${this.MIN_USDC_RESERVE + 10}+ USDC (keeping $${this.MIN_USDC_RESERVE} reserve)`);
            return;
        }

        // Check cooldown
        if (this._isOnCooldown(State.selectedAsset.code)) {
            const remaining = this._getCooldownRemaining(State.selectedAsset.code);
            this._showError(`${State.selectedAsset.code} on cooldown for ${remaining}`);
            return;
        }

        this.isActive = true;
        this.basePrice = API.getRealtimePrice(State.selectedAsset.code);

        Logger.log(`Auto-trade started: ${State.selectedAsset.code} at $${this.basePrice.toFixed(2)}`, 'success');
        Logger.log(`Watching for ±${Math.abs(deviation)}% move, using ${allocation}% of USDC`, 'info');

        this._updateUI();

        // Monitor every 60 seconds
        this.monitorInterval = setInterval(() => this._checkPrice(), 60000);
        this._checkPrice();
    },

    stop() {
        this.isActive = false;
        this.checkCount = 0;

        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        Logger.log('Auto-trading stopped', 'info');
        this._updateUI();
    },

    _updateUI() {
        const btn = document.getElementById('autoToggleBtn');
        const btnText = document.getElementById('autoToggleBtnText');
        const status = document.getElementById('autoStatus');

        if (this.isActive) {
            if (btn) btn.style.background = '#ef4444';
            if (btnText) btnText.textContent = 'Stop Auto Trading';
            if (status) {
                status.style.display = 'block';
                status.textContent = `Monitoring ${State.selectedAsset?.code} every 60s...`;
            }
        } else {
            if (btn) btn.style.background = '#a855f7';
            if (btnText) btnText.textContent = 'Start Auto Trading';
            if (status) status.style.display = 'none';
        }
    },

    async _checkPrice() {
        if (!this.isActive || !State.selectedAsset) {
            this.stop();
            return;
        }

        this.checkCount++;
        const deviation = Math.abs(State.autoTradeConfig.deviation);

        // Refresh portfolio data every 2 minutes for fresh prices
        if (this.checkCount % 2 === 0) {
            Logger.log('Refreshing prices...', 'info');
            await API.refreshData();
        }

        const currentPrice = API.getRealtimePrice(State.selectedAsset.code);
        const changePercent = ((currentPrice - this.basePrice) / this.basePrice) * 100;

        Logger.log(
            `Auto: ${State.selectedAsset.code} $${currentPrice.toFixed(2)} ` +
            `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% from $${this.basePrice.toFixed(2)})`,
            'info'
        );

        // Update live status
        const status = document.getElementById('autoStatus');
        if (status) {
            status.textContent =
                `${State.selectedAsset.code}: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% | Target: ±${deviation}%`;
        }

        // Check if deviation threshold hit
        if (Math.abs(changePercent) >= deviation) {
            if (changePercent <= -deviation) {
                await this._executeBuy(currentPrice);
            } else {
                await this._executeSell(currentPrice);
            }
        }
    },

    async _executeBuy(currentPrice) {
        const allocation = State.autoTradeConfig.allocation;
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        const usdcBalance = usdcAsset?.usd_value ?? 0;

        const tradeAmount = (allocation / 100) * usdcBalance;
        if (usdcBalance - tradeAmount < this.MIN_USDC_RESERVE) {
            Logger.log(`Skipping buy - would break $${this.MIN_USDC_RESERVE} USDC reserve`, 'error');
            this.stop();
            return;
        }

        const quantity = parseFloat((tradeAmount / currentPrice).toFixed(8));
        Logger.log(`AUTO BUY: ${quantity} ${State.selectedAsset.code} at $${currentPrice} ($${tradeAmount.toFixed(2)})`, 'success');

        try {
            const response = await API.placeOrder({
                primary: State.selectedAsset.code,
                secondary: 'USDC',
                quantity,
                assetQuantity: State.selectedAsset.code,
                orderType: 'MARKET_BUY'
            });

            if (response.ok) {
                Logger.log('Auto buy executed!', 'success');
                this._setCooldown(State.selectedAsset.code);
                this.stop();
                await API.refreshData();
            } else {
                const error = await response.text();
                Logger.log(`Auto buy failed: ${error}`, 'error');
            }
        } catch (error) {
            Logger.log(`Auto buy error: ${error.message}`, 'error');
        }
    },

    async _executeSell(currentPrice) {
        const allocation = State.autoTradeConfig.allocation;
        const assetBalance = State.selectedAsset.balance ?? 0;

        // Sell less than we buy (accumulation mode: 83%)
        const sellPercent = allocation * this.SELL_RATIO;
        const quantity = parseFloat(((sellPercent / 100) * assetBalance).toFixed(8));

        if (quantity <= 0) {
            Logger.log('Skipping sell - insufficient balance', 'error');
            this.stop();
            return;
        }

        Logger.log(
            `AUTO SELL: ${quantity} ${State.selectedAsset.code} at $${currentPrice} (${sellPercent.toFixed(1)}% of holdings)`,
            'success'
        );

        try {
            const response = await API.placeOrder({
                primary: State.selectedAsset.code,
                secondary: 'USDC',
                quantity,
                assetQuantity: 'USDC',
                orderType: 'MARKET_SELL'
            });

            if (response.ok) {
                Logger.log('Auto sell executed!', 'success');
                this._setCooldown(State.selectedAsset.code);
                this.stop();
                await API.refreshData();
            } else {
                const error = await response.text();
                Logger.log(`Auto sell failed: ${error}`, 'error');
            }
        } catch (error) {
            Logger.log(`Auto sell error: ${error.message}`, 'error');
        }
    },

    _setCooldown(coin) {
        const expiresAt = Date.now() + (this.COOLDOWN_HOURS * 60 * 60 * 1000);
        this.cooldowns[coin] = expiresAt;
        localStorage.setItem('auto_cooldowns', JSON.stringify(this.cooldowns));
        Logger.log(`${coin} on cooldown for ${this.COOLDOWN_HOURS}h`, 'info');
    },

    _isOnCooldown(coin) {
        const cooldown = this.cooldowns[coin];
        if (!cooldown) return false;
        return Date.now() < cooldown;
    },

    _getCooldownRemaining(coin) {
        const cooldown = this.cooldowns[coin];
        if (!cooldown) return '0h';

        const remaining = cooldown - Date.now();
        if (remaining <= 0) return '0h';

        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        return `${hours}h ${minutes}m`;
    },

    _showError(message) {
        const errorEl = document.getElementById('autoError');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            setTimeout(() => errorEl.style.display = 'none', 5000);
        }
        Logger.log(message, 'error');
    },

    // Load cooldowns from localStorage on init
    init() {
        const stored = localStorage.getItem('auto_cooldowns');
        if (stored) {
            try {
                this.cooldowns = JSON.parse(stored);
                // Clean up expired cooldowns
                const now = Date.now();
                Object.keys(this.cooldowns).forEach(coin => {
                    if (this.cooldowns[coin] < now) delete this.cooldowns[coin];
                });
            } catch (e) {
                this.cooldowns = {};
            }
        }
    }
};

AutoTrader.init();
