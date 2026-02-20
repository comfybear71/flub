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
//   - Records buy/sell targets for every coin when started
//   - Buy target = startPrice - deviation%, Sell target = startPrice + deviation%
//   - When a BUY triggers: new buy target moves down, sell target stays
//   - When a SELL triggers: new sell target moves up, buy target stays
//   - 24h cooldown per coin after each trade (one trade per day max)
//   - Bot keeps running even when all coins on cooldown
//   - Always keeps $100 USDC minimum reserve

const AutoTrader = {
    isActive: false,
    monitorInterval: null,
    targets: {},          // { BTC: { buy: 65660, sell: 68340 }, ... }
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

        // Record buy/sell targets for all non-cooldown coins
        this.targets = {};
        cryptoHoldings.forEach(asset => {
            if (!this._isOnCooldown(asset.code)) {
                const price = asset.usd_price;
                const dev = this.getSettings(asset.code).deviation;
                this.targets[asset.code] = {
                    buy:  price * (1 - dev / 100),
                    sell: price * (1 + dev / 100)
                };
            }
        });

        const activeCoins = Object.keys(this.targets);
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
            const tgt = this.targets[code];
            Logger.log(`  ${code} (Tier ${t}): buy < $${tgt.buy.toFixed(2)}, sell > $${tgt.sell.toFixed(2)} (±${s.deviation}%, ${s.allocation}% alloc)`, 'info');
        });

        this._updateUI();
        this._saveActiveState();

        // Monitor every 180 seconds (3 minutes)
        this.monitorInterval = setInterval(() => this._checkPrices(), 180000);
        this._checkPrices();
    },

    // Resume auto-trading from saved state (called on page load)
    resume(savedTargets) {
        if (this.isActive) return; // Already running

        // Handle backward compat: old format was { BTC: 67000 }, new is { BTC: { buy, sell } }
        this.targets = {};
        for (const [code, val] of Object.entries(savedTargets)) {
            if (typeof val === 'object' && val.buy && val.sell) {
                this.targets[code] = val;
            } else if (typeof val === 'number') {
                // Old basePrices format — convert using current tier deviation
                const dev = this.getSettings(code).deviation;
                this.targets[code] = {
                    buy:  val * (1 - dev / 100),
                    sell: val * (1 + dev / 100)
                };
            }
        }

        // Remove any coins that are now on cooldown
        for (const code of Object.keys(this.targets)) {
            if (this._isOnCooldown(code)) {
                delete this.targets[code];
            }
        }

        const activeCoins = Object.keys(this.targets);
        if (activeCoins.length === 0) {
            Logger.log('Auto-trade resume: all coins on cooldown — waiting...', 'info');
            // Still mark as active so bot keeps running and resumes when cooldowns expire
            this.isActive = true;
            this.checkCount = 0;
            this._updateUI();
            this.monitorInterval = setInterval(() => this._checkPrices(), 180000);
            return;
        }

        this.isActive = true;
        this.checkCount = 0;

        Logger.log(`Auto-trading resumed: monitoring ${activeCoins.length} coins`, 'success');
        activeCoins.forEach(code => {
            const s = this.getSettings(code);
            const t = this.getTier(code);
            const tgt = this.targets[code];
            Logger.log(`  ${code} (Tier ${t}): buy < $${tgt.buy.toFixed(2)}, sell > $${tgt.sell.toFixed(2)}`, 'info');
        });

        this._updateUI();

        // Monitor every 180 seconds (3 minutes)
        this.monitorInterval = setInterval(() => this._checkPrices(), 180000);
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
        this._saveActiveState();
        this.renderTierBadges();
    },

    // ── Price Monitoring (all coins) ─────────────────────────────────────────

    async _checkPrices() {
        if (!this.isActive) {
            this.stop();
            return;
        }

        this.checkCount++;

        // Refresh portfolio data every 2 checks for fresh prices
        if (this.checkCount % 2 === 0) {
            Logger.log('Refreshing prices...', 'info');
            await API.refreshData();
        }

        let tradeExecuted = false;

        for (const code of Object.keys(this.targets)) {
            if (this._isOnCooldown(code)) continue;

            const settings = this.getSettings(code);
            const currentPrice = API.getRealtimePrice(code);
            const tgt = this.targets[code];

            if (!tgt || !currentPrice) continue;

            // Check buy target (price dropped below)
            if (currentPrice <= tgt.buy) {
                Logger.log(`${code} hit buy target $${tgt.buy.toFixed(2)} (price: $${currentPrice.toFixed(2)}) — BUY`, 'success');
                await this._executeBuy(code, currentPrice, settings);
                tradeExecuted = true;
            }
            // Check sell target (price rose above)
            else if (currentPrice >= tgt.sell) {
                Logger.log(`${code} hit sell target $${tgt.sell.toFixed(2)} (price: $${currentPrice.toFixed(2)}) — SELL`, 'success');
                await this._executeSell(code, currentPrice, settings);
                tradeExecuted = true;
            }
        }

        // Refresh after any trades
        if (tradeExecuted) {
            await API.refreshData();
            this.renderTierBadges();
            this._saveActiveState();
        }

        // Update status display with visual indicators + thresholds
        this._updateStatus();

        // Log cooldown status (bot keeps running — coins resume when cooldowns expire)
        const remaining = Object.keys(this.targets).filter(c => !this._isOnCooldown(c));
        const onCooldown = Object.keys(this.targets).length - remaining.length;
        if (remaining.length === 0 && onCooldown > 0) {
            Logger.log(`All ${onCooldown} coins on cooldown — waiting for cooldowns to expire...`, 'info');
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
                // Move buy target down — sell target stays where it is
                const oldBuy = this.targets[code].buy;
                this.targets[code].buy = currentPrice * (1 - settings.deviation / 100);
                Logger.log(`${code} buy target: $${oldBuy.toFixed(2)} → $${this.targets[code].buy.toFixed(2)} (sell stays $${this.targets[code].sell.toFixed(2)})`, 'info');
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
                // Move sell target up — buy target stays where it is
                const oldSell = this.targets[code].sell;
                this.targets[code].sell = currentPrice * (1 + settings.deviation / 100);
                Logger.log(`${code} sell target: $${oldSell.toFixed(2)} → $${this.targets[code].sell.toFixed(2)} (buy stays $${this.targets[code].buy.toFixed(2)})`, 'info');
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
                const count = Object.keys(this.targets).filter(c => !this._isOnCooldown(c)).length;
                status.textContent = `Monitoring ${count} coins every 3 min...`;
            }
        } else {
            if (btn) btn.style.background = '#a855f7';
            if (btnText) btnText.textContent = 'Start Auto Trading (All Coins)';
            if (badge) badge.style.display = 'none';
            if (status) status.style.display = 'none';
        }

        // Keep user insight cards in sync
        if (typeof UI !== 'undefined') UI.updateUserInsightCards();

        // Show/hide override button
        this._updateOverrideButton();
    },

    _updateStatus() {
        const status = document.getElementById('autoStatus');
        if (!status) return;

        const coins = Object.keys(this.targets);
        const activeCoins = coins.filter(c => !this._isOnCooldown(c));
        const cdCoins     = coins.filter(c => this._isOnCooldown(c));

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:6px;">`;
        html += `<span>Monitoring ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
        if (cdCoins.length > 0) html += ` <span style="color:#94a3b8; font-weight:400;">(${cdCoins.length} on cooldown)</span>`;
        html += `</span>`;
        html += `<span id="priceCountdown" style="font-size:9px; font-weight:400; color:#64748b;"></span>`;
        html += '</div>';

        // ── Per-coin threshold table ──
        html += '<div style="display:flex; flex-direction:column; gap:4px;">';
        for (const code of activeCoins) {
            const currentPrice = API.getRealtimePrice(code);
            const tgt = this.targets[code];
            if (!tgt || !currentPrice) continue;

            const tier = this.getTier(code);

            // Progress: how close to the nearest target (0 = midpoint, 1 = at target)
            const midPrice = (tgt.buy + tgt.sell) / 2;
            const halfRange = (tgt.sell - tgt.buy) / 2;
            let progress, direction;
            if (currentPrice <= tgt.buy) {
                progress = 1; direction = 'buy';
            } else if (currentPrice >= tgt.sell) {
                progress = 1; direction = 'sell';
            } else if (currentPrice < midPrice) {
                progress = (midPrice - currentPrice) / halfRange;
                direction = 'buy';
            } else {
                progress = (currentPrice - midPrice) / halfRange;
                direction = 'sell';
            }
            progress = Math.max(0, Math.min(1, progress));

            // Change % from midpoint
            const change = ((currentPrice - midPrice) / midPrice) * 100;

            // Color gradient based on proximity
            let barColor;
            if (progress < 0.5)      barColor = '#3b82f6';  // blue — calm
            else if (progress < 0.75) barColor = '#eab308';  // yellow — warming up
            else if (progress < 0.95) barColor = '#f97316';  // orange — close
            else                      barColor = '#ef4444';  // red — about to trigger

            const sign = change >= 0 ? '+' : '';
            const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };

            html += `<div style="padding:6px 8px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);">`;
            // Row 1: Coin name, change %, progress bar
            html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">`;
            html += `<span style="font-size:11px; font-weight:700; color:${style.color}; min-width:42px;">${code}</span>`;
            html += `<span style="font-size:10px; color:#64748b;">T${tier}</span>`;
            html += `<div style="flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">`;
            html += `<div class="at-bar" data-code="${code}" style="width:${(progress * 100).toFixed(0)}%; height:100%; background:${barColor}; border-radius:2px; transition:width 0.8s, background 0.8s;"></div>`;
            html += `</div>`;
            html += `<span class="at-change" data-code="${code}" style="font-size:11px; font-weight:600; color:${barColor}; min-width:50px; text-align:right;">${sign}${change.toFixed(2)}%</span>`;
            html += `</div>`;
            // Row 2: Price thresholds
            html += `<div style="display:flex; justify-content:space-between; font-size:9px; color:#64748b;">`;
            html += `<span>Buy &lt; $${tgt.buy.toFixed(2)}</span>`;
            html += `<span class="at-price" data-code="${code}" data-field="at-current" style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
            html += `<span>Sell &gt; $${tgt.sell.toFixed(2)}</span>`;
            html += `</div>`;
            html += `</div>`;
        }

        // Cooldown coins (show their targets too)
        if (cdCoins.length > 0) {
            for (const code of cdCoins) {
                const tgt = this.targets[code];
                const currentPrice = API.getRealtimePrice(code);
                const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };
                const remaining = this._getCooldownRemaining(code);

                html += `<div style="padding:6px 8px; border-radius:6px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.04); opacity:0.5;">`;
                html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">`;
                html += `<span style="font-size:11px; font-weight:700; color:${style.color}; min-width:42px;">${code}</span>`;
                html += `<span style="font-size:10px; color:#64748b;">cooldown ${remaining}</span>`;
                html += `</div>`;
                if (tgt && currentPrice) {
                    html += `<div style="display:flex; justify-content:space-between; font-size:9px; color:#64748b;">`;
                    html += `<span>Buy &lt; $${tgt.buy.toFixed(2)}</span>`;
                    html += `<span class="at-price" data-code="${code}" data-field="at-current" style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
                    html += `<span>Sell &gt; $${tgt.sell.toFixed(2)}</span>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        }
        html += '</div>';

        status.innerHTML = html;

        // Show/hide override button based on cooldown state
        this._updateOverrideButton();

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

        // Persist locally + server
        localStorage.setItem('auto_trade_log', JSON.stringify(this.tradeLog));
        if (typeof ServerState !== 'undefined') ServerState.saveTradeLog();

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
        if (typeof ServerState !== 'undefined') ServerState.saveCooldowns();
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
        if (typeof ServerState !== 'undefined') ServerState.saveTiers();
    },

    _saveActiveState() {
        const state = { isActive: this.isActive, targets: this.targets };
        localStorage.setItem('auto_active', JSON.stringify(state));
        if (typeof ServerState !== 'undefined') ServerState.saveAutoActive();
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
        if (typeof ServerState !== 'undefined') ServerState.saveTradeLog();
        this._renderTradeLog();
    },

    // One-shot override: clear all cooldowns and add any missing coins
    overrideCooldowns() {
        const cdCount = Object.keys(this.cooldowns).length;
        if (cdCount === 0) {
            Logger.log('No cooldowns to override', 'info');
            return;
        }

        this.cooldowns = {};
        localStorage.setItem('auto_cooldowns', JSON.stringify(this.cooldowns));
        if (typeof ServerState !== 'undefined') ServerState.saveCooldowns();

        // Add any portfolio coins that weren't in targets (they were skipped at start due to cooldown)
        const cryptoHoldings = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );
        let added = 0;
        for (const asset of cryptoHoldings) {
            if (!this.targets[asset.code]) {
                const price = API.getRealtimePrice(asset.code) || asset.usd_price;
                const dev = this.getSettings(asset.code).deviation;
                this.targets[asset.code] = {
                    buy:  price * (1 - dev / 100),
                    sell: price * (1 + dev / 100)
                };
                added++;
                Logger.log(`  Added ${asset.code}: buy < $${this.targets[asset.code].buy.toFixed(2)}, sell > $${this.targets[asset.code].sell.toFixed(2)}`, 'info');
            }
        }

        Logger.log(`Cooldowns overridden — ${cdCount} cleared, ${added} coin(s) added`, 'success');

        // Save updated targets
        this._saveActiveState();

        // Update displays
        this._updateStatus();
        this._updateOverrideButton();
        this.renderTierBadges();

        // Run a price check right away so trades can trigger
        if (this.isActive) {
            this._checkPrices();
        }
    },

    _updateOverrideButton() {
        const btn = document.getElementById('autoCooldownOverride');
        if (!btn) return;

        const hasCooldowns = Object.keys(this.cooldowns).some(c => this._isOnCooldown(c));
        btn.style.display = (this.isActive && hasCooldowns) ? 'block' : 'none';
    }
};

AutoTrader.init();
