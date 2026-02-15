// ==========================================
// AutoTrader - Automated Trading Logic
// ==========================================

const AutoTrader = {
isActive: false,
monitorInterval: null,
basePrice: 0,
deviation: 3,        // Default 3%
allocation: 3,       // Default 3%
cooldowns: {},       // Track cooldown per coin { ‘BTC’: timestamp }
checkCount: 0,       // Track number of checks for refresh timing
COOLDOWN_HOURS: 24,
MIN_USDC_RESERVE: 100,
SELL_RATIO: 0.833,   // Sell 2.5% when buying 3% (2.5/3 = 0.833)

```
updateDeviation(value) {
    this.deviation = parseInt(value);
    const fill = document.getElementById('autoDevFill');
    const percent = document.getElementById('autoDevPercent');
    const buyAt = document.getElementById('autoBuyAt');
    const sellAt = document.getElementById('autoSellAt');
    
    if (fill) fill.style.width = ((value - 1) / 9 * 100) + '%';
    if (percent) percent.textContent = value + '%';
    if (buyAt) buyAt.textContent = value;
    if (sellAt) sellAt.textContent = value;
    
    this.updateUsdcAmount();
},

updateAllocation(value) {
    this.allocation = parseInt(value);
    const fill = document.getElementById('autoAllocFill');
    const percent = document.getElementById('autoAllocPercent');
    
    if (fill) fill.style.width = ((value - 1) / 9 * 100) + '%';
    if (percent) percent.textContent = value + '%';
    
    this.updateUsdcAmount();
},

updateUsdcAmount() {
    const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
    const usdcBalance = usdcAsset?.usd_value ?? 0;
    const amount = (this.allocation / 100) * usdcBalance;
    
    const el = document.getElementById('autoUsdcAmount');
    if (el) el.textContent = Assets.formatCurrency(amount);
},

reset() {
    this.deviation = 3;
    this.allocation = 3;
    
    const devSlider = document.getElementById('autoDevSlider');
    const allocSlider = document.getElementById('autoAllocSlider');
    
    if (devSlider) devSlider.value = 3;
    if (allocSlider) allocSlider.value = 3;
    
    this.updateDeviation(3);
    this.updateAllocation(3);
    
    if (this.isActive) this.stop();
},

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

    // Check USDC balance
    const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
    const usdcBalance = usdcAsset?.usd_value ?? 0;
    
    if (usdcBalance < this.MIN_USDC_RESERVE + 10) {
        this._showError(`Need at least $${this.MIN_USDC_RESERVE + 10} USDC (keeping $${this.MIN_USDC_RESERVE} reserve)`);
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
    
    Logger.log(`Auto-trading started for ${State.selectedAsset.code} at $${this.basePrice}`, 'success');
    Logger.log(`Watching for ±${this.deviation}% price movement`, 'info');
    
    // Update UI
    const btn = document.getElementById('autoToggleBtn');
    const btnText = document.getElementById('autoToggleBtnText');
    const status = document.getElementById('autoStatus');
    
    if (btn) btn.style.background = '#ef4444';
    if (btnText) btnText.textContent = 'Stop Auto Trading';
    if (status) {
        status.style.display = 'block';
        status.style.background = 'rgba(168,85,247,0.2)';
        status.style.color = '#a855f7';
    }

    // Start monitoring every 60 seconds
    this.monitorInterval = setInterval(() => this._checkPrice(), 60000);
    this._checkPrice(); // Check immediately
},

stop() {
    this.isActive = false;
    this.checkCount = 0;
    
    if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
    }

    Logger.log('Auto-trading stopped', 'info');
    
    // Update UI
    const btn = document.getElementById('autoToggleBtn');
    const btnText = document.getElementById('autoToggleBtnText');
    const status = document.getElementById('autoStatus');
    
    if (btn) btn.style.background = '#a855f7';
    if (btnText) btnText.textContent = 'Start Auto Trading';
    if (status) status.style.display = 'none';
},

async _checkPrice() {
    if (!this.isActive || !State.selectedAsset) {
        this.stop();
        return;
    }

    this.checkCount++;

    // Refresh portfolio data every 2 minutes to get fresh prices
    if (this.checkCount % 2 === 0) {
        Logger.log('Refreshing portfolio data for latest prices...', 'info');
        await API.refreshData();
    }

    const currentPrice = API.getRealtimePrice(State.selectedAsset.code);
    const changePercent = ((currentPrice - this.basePrice) / this.basePrice) * 100;
    
    Logger.log(`Auto check: ${State.selectedAsset.code} at $${currentPrice} (${changePercent.toFixed(2)}% from $${this.basePrice})`, 'info');

    // Check if deviation threshold hit
    if (Math.abs(changePercent) >= this.deviation) {
        if (changePercent <= -this.deviation) {
            // Price dropped - BUY
            await this._executeBuy(currentPrice);
        } else if (changePercent >= this.deviation) {
            // Price rose - SELL
            await this._executeSell(currentPrice);
        }
    }
},

async _executeBuy(currentPrice) {
    const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
    const usdcBalance = usdcAsset?.usd_value ?? 0;
    
    // Check reserve
    const tradeAmount = (this.allocation / 100) * usdcBalance;
    if (usdcBalance - tradeAmount < this.MIN_USDC_RESERVE) {
        Logger.log(`Skipping buy - would break $${this.MIN_USDC_RESERVE} USDC reserve`, 'error');
        this.stop();
        return;
    }

    const quantity = parseFloat((tradeAmount / currentPrice).toFixed(8));
    
    Logger.log(`🤖 AUTO BUY: ${quantity} ${State.selectedAsset.code} at $${currentPrice}`, 'success');
    
    const orderData = {
        primary: State.selectedAsset.code,
        secondary: 'USDC',
        quantity,
        assetQuantity: State.selectedAsset.code,
        orderType: 'MARKET_BUY'
    };

    try {
        const response = await API.placeOrder(orderData);
        if (response.ok) {
            Logger.log('✅ Auto buy executed successfully', 'success');
            this._setCooldown(State.selectedAsset.code);
            this.stop();
            await API.refreshData();
        } else {
            const error = await response.text();
            Logger.log(`❌ Auto buy failed: ${error}`, 'error');
        }
    } catch (error) {
        Logger.log(`❌ Auto buy error: ${error.message}`, 'error');
    }
},

async _executeSell(currentPrice) {
    const assetBalance = State.selectedAsset.balance ?? 0;
    
    // Sell less than we buy (accumulation mode)
    const sellPercent = this.allocation * this.SELL_RATIO;
    const quantity = parseFloat(((sellPercent / 100) * assetBalance).toFixed(8));
    
    if (quantity <= 0) {
        Logger.log('Skipping sell - insufficient balance', 'error');
        this.stop();
        return;
    }

    Logger.log(`🤖 AUTO SELL: ${quantity} ${State.selectedAsset.code} at $${currentPrice} (${sellPercent.toFixed(1)}% of holdings)`, 'success');
    
    const orderData = {
        primary: State.selectedAsset.code,
        secondary: 'USDC',
        quantity,
        assetQuantity: 'USDC',
        orderType: 'MARKET_SELL'
    };

    try {
        const response = await API.placeOrder(orderData);
        if (response.ok) {
            Logger.log('✅ Auto sell executed successfully', 'success');
            this._setCooldown(State.selectedAsset.code);
            this.stop();
            await API.refreshData();
        } else {
            const error = await response.text();
            Logger.log(`❌ Auto sell failed: ${error}`, 'error');
        }
    } catch (error) {
        Logger.log(`❌ Auto sell error: ${error.message}`, 'error');
    }
},

_setCooldown(coin) {
    const expiresAt = Date.now() + (this.COOLDOWN_HOURS * 60 * 60 * 1000);
    this.cooldowns[coin] = expiresAt;
    localStorage.setItem('auto_cooldowns', JSON.stringify(this.cooldowns));
    Logger.log(`${coin} on cooldown for ${this.COOLDOWN_HOURS} hours`, 'info');
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
                if (this.cooldowns[coin] < now) {
                    delete this.cooldowns[coin];
                }
            });
        } catch (e) {
            this.cooldowns = {};
        }
    }
}
```

};

// Initialize on load
AutoTrader.init();