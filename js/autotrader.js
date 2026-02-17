// ==========================================
// AutoTrader - Multi-Coin Tier-Based Trading
// ==========================================
//
// Monitors ALL holdings simultaneously with tier-based settings:
//   Tier 1 (Blue Chips): BTC, ETH, SOL, BNB, XRP
//     - Lower deviation (e.g., 2%), higher allocation (e.g., 10%)
//   Tier 2 (Alts): Everything else
//     - Higher deviation (e.g., 5%), lower allocation (e.g., 5%)
//
// Logic:
//   - Records base price for every coin when started
//   - Checks every 60s if any coin moved ± its tier's deviation%
//   - Price drops → BUY (allocation% of USDC)
//   - Price rises → SELL (83% of allocation — accumulation bias)
//   - 24h cooldown per coin after each trade
//   - Always keeps $100 USDC minimum reserve

const AutoTrader = {
    isActive: false,
    monitorInterval: null,
    basePrices: {},       // { BTC: 98000, ETH: 3500, ... }
    cooldowns: {},
    checkCount: 0,
    tradeLog: [],         // { time, coin, side, qty, price, amount }

    // Tier 1 defaults (blue chips)
    TIER1_COINS: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],
    tier1: { deviation: 2, allocation: 10 },

    // Tier 2 defaults (everything else)
    tier2: { deviation: 5, allocation: 5 },

    // Safety
    COOLDOWN_HOURS: 24,
    MIN_USDC_RESERVE: 100,
    SELL_RATIO: 0.833,    // Sell 83% of buy amount (accumulate)

    // ── Tier helpers ─────────────────────────────────────────────────────────

    getTier(code) {
        return this.TIER1_COINS.includes(code) ? 1 : 2;
    },

    getSettings(code) {
        return this.getTier(code) === 1 ? this.tier1 : this.tier2;
    },

    // ── UI sync ──────────────────────────────────────────────────────────────

    updateTierUI() {
        const t1Dev   = document.getElementById('t1DevSlider');
        const t1Alloc = document.getElementById('t1AllocSlider');
        const t2Dev   = document.getElementById('t2DevSlider');
        const t2Alloc = document.getElementById('t2AllocSlider');

        if (t1Dev)   this.tier1.deviation   = parseInt(t1Dev.value);
        if (t1Alloc) this.tier1.allocation  = parseInt(t1Alloc.value);
        if (t2Dev)   this.tier2.deviation   = parseInt(t2Dev.value);
        if (t2Alloc) this.tier2.allocation  = parseInt(t2Alloc.value);

        // Update labels
        this._setText('t1DevValue',   this.tier1.deviation + '%');
        this._setText('t1AllocValue', this.tier1.allocation + '%');
        this._setText('t2DevValue',   this.tier2.deviation + '%');
        this._setText('t2AllocValue', this.tier2.allocation + '%');

        // Update slider fills
        this._setFill('t1DevFill',   (this.tier1.deviation - 1) / 14 * 100);
        this._setFill('t1AllocFill', (this.tier1.allocation - 1) / 24 * 100);
        this._setFill('t2DevFill',   (this.tier2.deviation - 2) / 18 * 100);
        this._setFill('t2AllocFill', (this.tier2.allocation - 1) / 19 * 100);

        // Save to localStorage
        this._saveTierSettings();
    },

    renderTierBadges() {
        const holdings = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );

        const t1Container = document.getElementById('tier1Coins');
        const t2Container = document.getElementById('tier2Coins');
        if (!t1Container || !t2Container) return;

        const t1 = holdings.filter(a => this.getTier(a.code) === 1);
        const t2 = holdings.filter(a => this.getTier(a.code) === 2);

        const makeBadge = (a) => {
            const style = CONFIG.ASSET_STYLES[a.code] || { color: '#666' };
            const cd = this._isOnCooldown(a.code);
            const opacity = cd ? 'opacity:0.4;' : '';
            const cdLabel = cd ? ' (cd)' : '';
            return `<span style="font-size:11px; font-weight:600; padding:3px 8px; border-radius:12px; background:${style.color}20; color:${style.color}; border:1px solid ${style.color}40; ${opacity}">${a.code}${cdLabel}</span>`;
        };

        t1Container.innerHTML = t1.map(makeBadge).join('') ||
            '<span style="font-size:11px; color:#64748b;">No Tier 1 holdings</span>';
        t2Container.innerHTML = t2.map(makeBadge).join('') ||
            '<span style="font-size:11px; color:#64748b;">No Tier 2 holdings</span>';
    },

    // ── Start / Stop / Toggle ────────────────────────────────────────────────

    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    },

    start() {
        // Check USDC balance
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        const usdcBalance = usdcAsset?.usd_value ?? 0;

        if (usdcBalance < this.MIN_USDC_RESERVE + 10) {
            this._showError(`Need $${this.MIN_USDC_RESERVE + 10}+ USDC (keeping $${this.MIN_USDC_RESERVE} reserve)`);
            return;
        }

        // Get all crypto holdings
        const cryptoHoldings = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );

        if (cryptoHoldings.length === 0) {
            this._showError('No crypto holdings to monitor');
            return;
        }

        // Record base prices for all non-cooldown coins
        this.basePrices = {};
        cryptoHoldings.forEach(asset => {
            if (!this._isOnCooldown(asset.code)) {
                this.basePrices[asset.code] = asset.usd_price;
            }
        });

        const activeCoins = Object.keys(this.basePrices);
        if (activeCoins.length === 0) {
            this._showError('All coins on cooldown — try again later');
            return;
        }

        this.isActive = true;
        this.checkCount = 0;

        Logger.log(`Auto-trading started: monitoring ${activeCoins.length} coins`, 'success');
        activeCoins.forEach(code => {
            const s = this.getSettings(code);
            const t = this.getTier(code);
            Logger.log(`  ${code} (Tier ${t}): ±${s.deviation}% dev, ${s.allocation}% alloc, base $${this.basePrices[code].toFixed(2)}`, 'info');
        });

        this._updateUI();

        // Monitor every 60 seconds
        this.monitorInterval = setInterval(() => this._checkPrices(), 60000);
        this._checkPrices();
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
        this.renderTierBadges();
    },

    // ── Price Monitoring (all coins) ─────────────────────────────────────────

    async _checkPrices() {
        if (!this.isActive) {
            this.stop();
            return;
        }

        this.checkCount++;

        // Refresh portfolio data every 2 minutes for fresh prices
        if (this.checkCount % 2 === 0) {
            Logger.log('Refreshing prices...', 'info');
            await API.refreshData();
        }

        let tradeExecuted = false;

        for (const code of Object.keys(this.basePrices)) {
            if (this._isOnCooldown(code)) continue;

            const settings = this.getSettings(code);
            const currentPrice = API.getRealtimePrice(code);
            const basePrice = this.basePrices[code];

            if (!basePrice || !currentPrice) continue;

            const change = ((currentPrice - basePrice) / basePrice) * 100;
            const tier = this.getTier(code);

            // Check if deviation threshold hit
            if (Math.abs(change) >= settings.deviation) {
                if (change <= -settings.deviation) {
                    Logger.log(`${code} dropped ${change.toFixed(2)}% (Tier ${tier}, target ±${settings.deviation}%) — BUY`, 'success');
                    await this._executeBuy(code, currentPrice, settings);
                    tradeExecuted = true;
                } else {
                    Logger.log(`${code} rose +${change.toFixed(2)}% (Tier ${tier}, target ±${settings.deviation}%) — SELL`, 'success');
                    await this._executeSell(code, currentPrice, settings);
                    tradeExecuted = true;
                }
            }
        }

        // Refresh after any trades
        if (tradeExecuted) {
            await API.refreshData();
            this.renderTierBadges();
        }

        // Update status display with visual indicators + thresholds
        this._updateStatus();

        // Check if all coins are now on cooldown
        const remaining = Object.keys(this.basePrices).filter(c => !this._isOnCooldown(c));
        if (remaining.length === 0) {
            Logger.log('All coins on cooldown — auto-trading complete', 'info');
            this.stop();
        }
    },

    // ── Trade Execution ──────────────────────────────────────────────────────

    async _executeBuy(code, currentPrice, settings) {
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        const usdcBalance = usdcAsset?.usd_value ?? 0;

        const tradeAmount = (settings.allocation / 100) * usdcBalance;
        if (usdcBalance - tradeAmount < this.MIN_USDC_RESERVE) {
            Logger.log(`Skipping ${code} buy — would break $${this.MIN_USDC_RESERVE} USDC reserve`, 'error');
            return;
        }

        const quantity = parseFloat((tradeAmount / currentPrice).toFixed(8));
        Logger.log(`AUTO BUY: ${quantity} ${code} at $${currentPrice.toFixed(2)} ($${tradeAmount.toFixed(2)} USDC)`, 'success');

        try {
            const response = await API.placeOrder({
                primary: 'USDC',
                secondary: code,
                quantity,
                assetQuantity: code,
                orderType: 'MARKET_BUY'
            });

            if (response.ok) {
                Logger.log(`${code} buy executed!`, 'success');
                this._addTradeLog(code, 'BUY', quantity, currentPrice, tradeAmount);
                this._setCooldown(code);
                delete this.basePrices[code];
            } else {
                const error = await response.text();
                Logger.log(`${code} buy failed: ${error}`, 'error');
            }
        } catch (error) {
            Logger.log(`${code} buy error: ${error.message}`, 'error');
        }
    },

    async _executeSell(code, currentPrice, settings) {
        const asset = State.portfolioData.assets.find(a => a.code === code);
        const assetBalance = asset?.balance ?? 0;

        // Sell less than we buy (accumulation mode)
        const sellPercent = settings.allocation * this.SELL_RATIO;
        const quantity = parseFloat(((sellPercent / 100) * assetBalance).toFixed(8));

        if (quantity <= 0) {
            Logger.log(`Skipping ${code} sell — insufficient balance`, 'error');
            return;
        }

        Logger.log(
            `AUTO SELL: ${quantity} ${code} at $${currentPrice.toFixed(2)} (${sellPercent.toFixed(1)}% of holdings)`,
            'success'
        );

        try {
            const response = await API.placeOrder({
                primary: 'USDC',
                secondary: code,
                quantity,
                assetQuantity: code,
                orderType: 'MARKET_SELL'
            });

            if (response.ok) {
                const sellValue = quantity * currentPrice;
                Logger.log(`${code} sell executed!`, 'success');
                this._addTradeLog(code, 'SELL', quantity, currentPrice, sellValue);
                this._setCooldown(code);
                delete this.basePrices[code];
            } else {
                const error = await response.text();
                Logger.log(`${code} sell failed: ${error}`, 'error');
            }
        } catch (error) {
            Logger.log(`${code} sell error: ${error.message}`, 'error');
        }
    },

    // ── UI Updates ───────────────────────────────────────────────────────────

    _updateUI() {
        const btn = document.getElementById('autoToggleBtn');
        const btnText = document.getElementById('autoToggleBtnText');
        const badge = document.getElementById('autoStatusBadge');
        const status = document.getElementById('autoStatus');

        if (this.isActive) {
            if (btn) btn.style.background = '#ef4444';
            if (btnText) btnText.textContent = 'Stop Auto Trading';
            if (badge) { badge.style.display = 'inline-block'; badge.textContent = 'ACTIVE'; }
            if (status) {
                status.style.display = 'block';
                const count = Object.keys(this.basePrices).filter(c => !this._isOnCooldown(c)).length;
                status.textContent = `Monitoring ${count} coins every 60s...`;
            }
        } else {
            if (btn) btn.style.background = '#a855f7';
            if (btnText) btnText.textContent = 'Start Auto Trading (All Coins)';
            if (badge) badge.style.display = 'none';
            if (status) status.style.display = 'none';
        }
    },

    _updateStatus() {
        const status = document.getElementById('autoStatus');
        if (!status) return;

        const coins = Object.keys(this.basePrices);
        const activeCoins = coins.filter(c => !this._isOnCooldown(c));
        const cdCoins     = coins.filter(c => this._isOnCooldown(c));

        let html = `<div style="font-weight:600; margin-bottom:6px;">Monitoring ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
        if (cdCoins.length > 0) html += ` <span style="color:#94a3b8;">(${cdCoins.length} on cooldown)</span>`;
        html += '</div>';

        // ── Per-coin threshold table ──
        html += '<div style="display:flex; flex-direction:column; gap:4px;">';
        for (const code of activeCoins) {
            const settings     = this.getSettings(code);
            const currentPrice = API.getRealtimePrice(code);
            const basePrice    = this.basePrices[code];
            if (!basePrice || !currentPrice) continue;

            const change    = ((currentPrice - basePrice) / basePrice) * 100;
            const deviation = settings.deviation;
            const progress  = Math.min(Math.abs(change) / deviation, 1); // 0..1 how close to trigger
            const tier      = this.getTier(code);

            // Buy trigger (price drops) / Sell trigger (price rises)
            const buyTrigger  = basePrice * (1 - deviation / 100);
            const sellTrigger = basePrice * (1 + deviation / 100);

            // Color gradient: grey → yellow → orange → red based on proximity
            let barColor, textColor;
            if (progress < 0.5) {
                barColor  = '#3b82f6';  // blue — calm
                textColor = '#94a3b8';
            } else if (progress < 0.75) {
                barColor  = '#eab308';  // yellow — warming up
                textColor = '#eab308';
            } else if (progress < 0.95) {
                barColor  = '#f97316';  // orange — close
                textColor = '#f97316';
            } else {
                barColor  = '#ef4444';  // red — about to trigger
                textColor = '#ef4444';
            }

            const sign = change >= 0 ? '+' : '';
            const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };

            html += `<div style="padding:6px 8px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);">`;
            // Row 1: Coin name, change %, progress bar
            html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">`;
            html += `<span style="font-size:11px; font-weight:700; color:${style.color}; min-width:42px;">${code}</span>`;
            html += `<span style="font-size:10px; color:#64748b;">T${tier}</span>`;
            html += `<div style="flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">`;
            html += `<div style="width:${(progress * 100).toFixed(0)}%; height:100%; background:${barColor}; border-radius:2px; transition:width 0.5s;"></div>`;
            html += `</div>`;
            html += `<span style="font-size:11px; font-weight:600; color:${textColor}; min-width:50px; text-align:right;">${sign}${change.toFixed(2)}%</span>`;
            html += `</div>`;
            // Row 2: Price thresholds
            html += `<div style="display:flex; justify-content:space-between; font-size:9px; color:#64748b;">`;
            html += `<span>Buy &lt; $${buyTrigger.toFixed(2)}</span>`;
            html += `<span style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
            html += `<span>Sell &gt; $${sellTrigger.toFixed(2)}</span>`;
            html += `</div>`;
            html += `</div>`;
        }

        // Cooldown coins (compact)
        if (cdCoins.length > 0) {
            html += `<div style="padding:4px 8px; font-size:9px; color:#64748b;">`;
            html += cdCoins.map(c => `${c} (cd: ${this._getCooldownRemaining(c)})`).join(' &bull; ');
            html += `</div>`;
        }
        html += '</div>';

        status.innerHTML = html;

        // ── Update trade log panel ──
        this._renderTradeLog();
    },

    // ── Trade Log ─────────────────────────────────────────────────────────────

    _addTradeLog(coin, side, quantity, price, amount) {
        const entry = {
            time: new Date(),
            coin,
            side,          // 'BUY' or 'SELL'
            quantity,
            price,
            amount         // USDC value
        };
        this.tradeLog.unshift(entry); // newest first
        if (this.tradeLog.length > 50) this.tradeLog.pop();

        // Persist
        localStorage.setItem('auto_trade_log', JSON.stringify(this.tradeLog));

        this._renderTradeLog();
    },

    _renderTradeLog() {
        const container = document.getElementById('autoTradeLog');
        if (!container) return;

        if (this.tradeLog.length === 0) {
            container.innerHTML = '<div style="font-size:10px; color:#64748b; text-align:center; padding:12px;">No auto-trades yet. Trades will appear here when triggered.</div>';
            return;
        }

        let html = '';
        for (const entry of this.tradeLog.slice(0, 20)) {
            const time = new Date(entry.time);
            const timeStr = time.toLocaleDateString('en-AU', { day:'2-digit', month:'short' }) + ' ' +
                            time.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', hour12:false });
            const isBuy = entry.side === 'BUY';
            const sideColor = isBuy ? '#22c55e' : '#ef4444';
            const sideIcon  = isBuy ? '&#9650;' : '&#9660;';
            const style = CONFIG.ASSET_STYLES[entry.coin] || { color: '#666' };

            html += `<div style="display:flex; align-items:center; gap:6px; padding:5px 8px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:10px;">`;
            html += `<span style="color:${sideColor}; font-weight:700; font-size:11px;">${sideIcon}</span>`;
            html += `<span style="color:${style.color}; font-weight:600; min-width:36px;">${entry.coin}</span>`;
            html += `<span style="color:${sideColor}; font-weight:600;">${entry.side}</span>`;
            html += `<span style="color:#94a3b8; flex:1;">${entry.quantity} @ $${entry.price.toFixed(2)}</span>`;
            html += `<span style="color:#c4b5fd; font-weight:600;">$${entry.amount.toFixed(2)}</span>`;
            html += `<span style="color:#64748b; font-size:9px; min-width:75px; text-align:right;">${timeStr}</span>`;
            html += `</div>`;
        }

        container.innerHTML = html;
    },

    // ── Cooldown Management ──────────────────────────────────────────────────

    _setCooldown(coin) {
        const expiresAt = Date.now() + (this.COOLDOWN_HOURS * 60 * 60 * 1000);
        this.cooldowns[coin] = expiresAt;
        localStorage.setItem('auto_cooldowns', JSON.stringify(this.cooldowns));
        Logger.log(`${coin} on cooldown for ${this.COOLDOWN_HOURS}h`, 'info');
    },

    _isOnCooldown(coin) {
        const cooldown = this.cooldowns[coin];
        if (!cooldown) return false;
        if (Date.now() >= cooldown) {
            delete this.cooldowns[coin];
            return false;
        }
        return true;
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

    // ── Persistence ──────────────────────────────────────────────────────────

    _saveTierSettings() {
        localStorage.setItem('auto_tiers', JSON.stringify({
            tier1: this.tier1,
            tier2: this.tier2
        }));
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    },

    _setFill(id, percent) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, percent)) + '%';
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

    // ── Init ─────────────────────────────────────────────────────────────────

    init() {
        // Load cooldowns
        const cooldownData = localStorage.getItem('auto_cooldowns');
        if (cooldownData) {
            try {
                this.cooldowns = JSON.parse(cooldownData);
                const now = Date.now();
                Object.keys(this.cooldowns).forEach(coin => {
                    if (this.cooldowns[coin] < now) delete this.cooldowns[coin];
                });
            } catch (e) {
                this.cooldowns = {};
            }
        }

        // Load trade log
        const logData = localStorage.getItem('auto_trade_log');
        if (logData) {
            try { this.tradeLog = JSON.parse(logData); } catch (e) { this.tradeLog = []; }
        }

        // Load saved tier settings
        const tierData = localStorage.getItem('auto_tiers');
        if (tierData) {
            try {
                const parsed = JSON.parse(tierData);
                if (parsed.tier1) this.tier1 = parsed.tier1;
                if (parsed.tier2) this.tier2 = parsed.tier2;
            } catch (e) {}
        }

        // Sync sliders to loaded settings
        this._syncSlidersToSettings();
    },

    _syncSlidersToSettings() {
        const t1Dev   = document.getElementById('t1DevSlider');
        const t1Alloc = document.getElementById('t1AllocSlider');
        const t2Dev   = document.getElementById('t2DevSlider');
        const t2Alloc = document.getElementById('t2AllocSlider');

        if (t1Dev)   t1Dev.value   = this.tier1.deviation;
        if (t1Alloc) t1Alloc.value = this.tier1.allocation;
        if (t2Dev)   t2Dev.value   = this.tier2.deviation;
        if (t2Alloc) t2Alloc.value = this.tier2.allocation;

        this.updateTierUI();
        this._renderTradeLog();
    },

    clearTradeLog() {
        this.tradeLog = [];
        localStorage.removeItem('auto_trade_log');
        this._renderTradeLog();
    }
};

AutoTrader.init();
