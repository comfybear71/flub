// ==========================================
// AutoTrader - Multi-Coin Tier-Based Trading
// ==========================================
//
// Monitors ALL holdings simultaneously with tier-based settings:
//   Tier 1 (Blue Chips): BTC, ETH, SOL, BNB, XRP (default)
//   Tier 2 (Alts): User-assigned
//   Tier 3 (Speculative): User-assigned
//
// Each tier has independent Start/Stop and Override controls.
// Coins can be added/removed from any tier.
//
// Logic:
//   - Records buy/sell targets for every coin when its tier starts
//   - Buy target = startPrice - deviation%, Sell target = startPrice + deviation%
//   - When a BUY triggers: new buy target moves down, sell target stays
//   - When a SELL triggers: new sell target moves up, buy target stays
//   - 24h cooldown per coin after each trade (one trade per day max)
//   - Always keeps $100 USDC minimum reserve

const AutoTrader = {
    tierActive: { 1: false, 2: false, 3: false },
    monitorInterval: null,
    targets: {},          // { BTC: { buy: 65660, sell: 68340 }, ... }
    cooldowns: {},
    checkCount: 0,
    tradeLog: [],

    // Device ownership — prevents double-monitoring across devices
    _deviceId: Math.random().toString(36).substring(2, 10),
    _isOwner: false,       // true if THIS device runs the monitoring loop
    HEARTBEAT_STALE: 5 * 60 * 1000,  // 5 minutes — heartbeat older than this = stale

    // Tier configuration (static)
    TIER_CONFIG: {
        1: { name: 'Blue Chips', color: '#3b82f6', devMin: 1, devMax: 15, allocMin: 1, allocMax: 25 },
        2: { name: 'Alts',       color: '#eab308', devMin: 2, devMax: 20, allocMin: 1, allocMax: 20 },
        3: { name: 'Speculative', color: '#f97316', devMin: 3, devMax: 30, allocMin: 1, allocMax: 15 }
    },

    // Tier settings (user-adjustable via sliders)
    tier1: { deviation: 2, allocation: 10 },
    tier2: { deviation: 5, allocation: 5 },
    tier3: { deviation: 8, allocation: 3 },

    // Coin-to-tier assignments: { BTC: 1, ETH: 1, SOL: 2, ... }
    tierAssignments: {},
    DEFAULT_T1: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'],

    // Safety
    COOLDOWN_HOURS: 24,
    MIN_USDC_RESERVE: 100,
    SELL_RATIO: 0.833,    // Sell 83% of buy amount (accumulate)

    // Computed: any tier active?
    get isActive() {
        return this.tierActive[1] || this.tierActive[2] || this.tierActive[3];
    },
    set isActive(val) {
        // Backward compat for user modal setting isActive from server
        if (!val) {
            this.tierActive = { 1: false, 2: false, 3: false };
        } else if (val === true) {
            // Mark tiers active based on which have targets
            for (let t = 1; t <= 3; t++) {
                const hasCoins = Object.keys(this.targets).some(c => this.getTier(c) === t);
                if (hasCoins) this.tierActive[t] = true;
            }
        }
    },

    // Backward compat getter
    get TIER1_COINS() {
        return this._getCoinsForTier(1);
    },

    // ── Tier helpers ─────────────────────────────────────────────────────────

    _getCoinsForTier(tierNum) {
        return Object.entries(this.tierAssignments)
            .filter(([_, t]) => t === tierNum)
            .map(([code]) => code);
    },

    getTier(code) {
        return this.tierAssignments[code] || 0;
    },

    getSettings(code) {
        const tier = this.getTier(code);
        if (tier >= 1 && tier <= 3) return this['tier' + tier];
        return this.tier2; // fallback
    },

    getTierSettings(tierNum) {
        return this['tier' + tierNum];
    },

    // ── Coin Assignment ─────────────────────────────────────────────────────

    _ensureDefaultAssignments() {
        if (Object.keys(this.tierAssignments).length > 0) return;
        const holdings = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );
        if (holdings.length === 0) return;
        holdings.forEach(a => {
            this.tierAssignments[a.code] = this.DEFAULT_T1.includes(a.code) ? 1 : 2;
        });
        this._saveTierAssignments();
    },

    assignCoin(code, tierNum) {
        const oldTier = this.tierAssignments[code];
        this.tierAssignments[code] = tierNum;
        this._saveTierAssignments();

        // If old tier was active, remove coin from targets
        if (oldTier && this.tierActive[oldTier] && this.targets[code]) {
            delete this.targets[code];
        }

        // If new tier is active, add coin with fresh targets
        if (this.tierActive[tierNum] && !this._isOnCooldown(code)) {
            const price = API.getRealtimePrice(code);
            if (price) {
                const dev = this.getTierSettings(tierNum).deviation;
                this.targets[code] = {
                    buy:  price * (1 - dev / 100),
                    sell: price * (1 + dev / 100)
                };
            }
        }

        this.renderTierCards();
        this._saveActiveState();
        Logger.log(`${code} → Tier ${tierNum} (${this.TIER_CONFIG[tierNum].name})`, 'info');
    },

    unassignCoin(code, tierNum) {
        if (this.tierAssignments[code] === tierNum) {
            delete this.tierAssignments[code];
        }
        if (this.targets[code]) {
            delete this.targets[code];
        }
        this._saveTierAssignments();
        this.renderTierCards();
        this._saveActiveState();
        Logger.log(`${code} removed from Tier ${tierNum}`, 'info');
    },

    // ── UI sync ──────────────────────────────────────────────────────────────

    updateTierUI() {
        for (let t = 1; t <= 3; t++) {
            const cfg = this.TIER_CONFIG[t];
            const settings = this['tier' + t];
            const devSlider   = document.getElementById(`t${t}DevSlider`);
            const allocSlider = document.getElementById(`t${t}AllocSlider`);

            if (devSlider)   settings.deviation   = parseInt(devSlider.value);
            if (allocSlider) settings.allocation   = parseInt(allocSlider.value);

            this._setText(`t${t}DevValue`,   settings.deviation + '%');
            this._setText(`t${t}AllocValue`, settings.allocation + '%');
            this._setFill(`t${t}DevFill`,   (settings.deviation - cfg.devMin) / (cfg.devMax - cfg.devMin) * 100);
            this._setFill(`t${t}AllocFill`, (settings.allocation - cfg.allocMin) / (cfg.allocMax - cfg.allocMin) * 100);
        }
        this._saveTierSettings();
    },

    // ── Render Tier Cards (horizontal scroll) ────────────────────────────────

    renderTierCards() {
        const container = document.getElementById('tierCardsScroll');
        if (!container) return;

        this._ensureDefaultAssignments();

        const holdings = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );

        let html = '';
        for (let t = 1; t <= 3; t++) {
            const cfg = this.TIER_CONFIG[t];
            const settings = this['tier' + t];
            const active = this.tierActive[t];
            const tierCoins = holdings.filter(a => this.getTier(a.code) === t);

            // Coin badges
            let badges = '';
            tierCoins.forEach(a => {
                const style = CONFIG.ASSET_STYLES[a.code] || { color: '#666' };
                const cd = this._isOnCooldown(a.code);
                const opacity = cd ? 'opacity:0.4;' : '';
                const cdLabel = cd ? ' <span style="font-size:8px;">(cd)</span>' : '';
                badges += `<span style="display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:600;padding:2px 5px 2px 7px;border-radius:10px;background:${style.color}20;color:${style.color};border:1px solid ${style.color}40;${opacity}">`;
                badges += `${a.code}${cdLabel}`;
                badges += `<span onclick="AutoTrader.unassignCoin('${a.code}',${t})" style="cursor:pointer;margin-left:1px;font-size:12px;line-height:1;opacity:0.5;">&times;</span>`;
                badges += `</span>`;
            });
            if (tierCoins.length === 0) {
                badges = `<span style="font-size:9px;color:#64748b;">No coins</span>`;
            }
            // Add button
            badges += `<span onclick="AutoTrader.showAddCoin(${t})" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:11px;background:rgba(255,255,255,0.06);color:#94a3b8;font-size:13px;border:1px dashed rgba(255,255,255,0.15);">+</span>`;

            // Slider fill calculations
            const devFill   = (settings.deviation - cfg.devMin) / (cfg.devMax - cfg.devMin) * 100;
            const allocFill = (settings.allocation - cfg.allocMin) / (cfg.allocMax - cfg.allocMin) * 100;

            // Per-tier cooldowns
            const tierCooldowns = tierCoins.filter(a => this._isOnCooldown(a.code));
            const showOverride = active && tierCooldowns.length > 0;

            // Button: owner sees Stop, non-owner sees Take Over, inactive sees Start
            let btnColor, btnText;
            if (active && this._isOwner) {
                btnColor = '#ef4444'; btnText = 'Stop';
            } else if (active && !this._isOwner) {
                btnColor = cfg.color; btnText = 'Take Over';
            } else {
                btnColor = cfg.color; btnText = 'Start';
            }

            html += `<div class="tier-card" style="border-color:${cfg.color}30;">`;

            // Header
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">`;
            html += `<span style="font-size:11px;font-weight:700;color:${cfg.color};">T${t} – ${cfg.name}</span>`;
            if (active && this._isOwner) {
                html += `<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:8px;background:${cfg.color}20;color:${cfg.color};text-transform:uppercase;">Active</span>`;
            } else if (active && !this._isOwner) {
                html += `<span style="font-size:7px;font-weight:600;padding:2px 5px;border-radius:8px;background:rgba(148,163,184,0.15);color:#94a3b8;">Remote</span>`;
            }
            html += `</div>`;

            // Coin badges
            html += `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:6px;">${badges}</div>`;

            // Coin selector dropdown (hidden)
            html += `<div id="tierCoinSelector${t}" style="display:none;margin-bottom:6px;padding:6px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);"></div>`;

            // Sliders
            html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">`;
            // Dev slider
            html += `<div>`;
            html += `<div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;margin-bottom:2px;">`;
            html += `<span>Dev</span><span id="t${t}DevValue" style="color:${cfg.color};font-weight:600;">${settings.deviation}%</span></div>`;
            html += `<div class="slider-box" style="height:26px;"><div class="slider-track"></div>`;
            html += `<div class="slider-fill" id="t${t}DevFill" style="width:${devFill}%;background:${cfg.color};"></div>`;
            html += `<input type="range" id="t${t}DevSlider" min="${cfg.devMin}" max="${cfg.devMax}" value="${settings.deviation}" step="1" style="height:26px;" oninput="AutoTrader.updateTierUI()">`;
            html += `</div></div>`;
            // Alloc slider
            html += `<div>`;
            html += `<div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;margin-bottom:2px;">`;
            html += `<span>Alloc</span><span id="t${t}AllocValue" style="color:#22c55e;font-weight:600;">${settings.allocation}%</span></div>`;
            html += `<div class="slider-box" style="height:26px;"><div class="slider-track"></div>`;
            html += `<div class="slider-fill" id="t${t}AllocFill" style="width:${allocFill}%;background:#22c55e;"></div>`;
            html += `<input type="range" id="t${t}AllocSlider" min="${cfg.allocMin}" max="${cfg.allocMax}" value="${settings.allocation}" step="1" style="height:26px;" oninput="AutoTrader.updateTierUI()">`;
            html += `</div></div>`;
            html += `</div>`;

            // Buttons row
            html += `<div style="display:flex;gap:4px;">`;
            html += `<button onclick="AutoTrader.toggle(${t})" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:11px;font-weight:700;cursor:pointer;color:white;background:${btnColor};transition:all 0.2s;">${btnText}</button>`;
            if (showOverride) {
                html += `<button onclick="AutoTrader.overrideCooldowns(${t})" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);font-size:9px;font-weight:600;cursor:pointer;color:#ef4444;background:rgba(239,68,68,0.08);transition:all 0.2s;" title="Override cooldowns">Override</button>`;
            }
            html += `</div>`;

            html += `</div>`;
        }
        container.innerHTML = html;
    },

    // Backward compat alias
    renderTierBadges() {
        this.renderTierCards();
    },

    showAddCoin(tierNum) {
        const selector = document.getElementById(`tierCoinSelector${tierNum}`);
        if (!selector) return;

        // Toggle off
        if (selector.style.display !== 'none') {
            selector.style.display = 'none';
            return;
        }

        // Close other selectors
        for (let t = 1; t <= 3; t++) {
            if (t !== tierNum) {
                const other = document.getElementById(`tierCoinSelector${t}`);
                if (other) other.style.display = 'none';
            }
        }

        // Get portfolio coins not in this tier
        const holdings = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );
        const available = holdings.filter(a => this.getTier(a.code) !== tierNum);

        if (available.length === 0) {
            selector.innerHTML = '<div style="font-size:9px;color:#64748b;">All coins in this tier</div>';
            selector.style.display = 'block';
            return;
        }

        let html = '<div style="display:flex;gap:3px;flex-wrap:wrap;">';
        available.forEach(a => {
            const style = CONFIG.ASSET_STYLES[a.code] || { color: '#666' };
            const curTier = this.tierAssignments[a.code];
            const curLabel = curTier ? ` <span style="font-size:7px;opacity:0.6;">T${curTier}</span>` : '';
            html += `<span onclick="AutoTrader.assignCoin('${a.code}',${tierNum})" style="cursor:pointer;font-size:9px;font-weight:600;padding:2px 7px;border-radius:10px;background:${style.color}10;color:${style.color};border:1px dashed ${style.color}40;">`;
            html += `${a.code}${curLabel}</span>`;
        });
        html += '</div>';

        selector.innerHTML = html;
        selector.style.display = 'block';
    },

    // ── Start / Stop / Toggle (per-tier) ─────────────────────────────────────

    toggle(tierNum) {
        if (this.tierActive[tierNum]) {
            this.stopTier(tierNum);
        } else {
            this.startTier(tierNum);
        }
    },

    startTier(tierNum) {
        // Check USDC balance
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        const usdcBalance = usdcAsset?.usd_value ?? 0;

        if (usdcBalance < this.MIN_USDC_RESERVE + 10) {
            this._showError(`Need $${this.MIN_USDC_RESERVE + 10}+ USDC (keeping $${this.MIN_USDC_RESERVE} reserve)`);
            return;
        }

        // Get coins assigned to this tier with holdings
        const tierCoins = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0 && this.getTier(a.code) === tierNum
        );

        if (tierCoins.length === 0) {
            this._showError(`No coins assigned to Tier ${tierNum}`);
            return;
        }

        // Set targets for non-cooldown coins
        let added = 0;
        tierCoins.forEach(asset => {
            if (!this._isOnCooldown(asset.code)) {
                const price = asset.usd_price;
                const dev = this.getTierSettings(tierNum).deviation;
                this.targets[asset.code] = {
                    buy:  price * (1 - dev / 100),
                    sell: price * (1 + dev / 100)
                };
                added++;
            }
        });

        if (added === 0) {
            this._showError(`All Tier ${tierNum} coins on cooldown`);
            return;
        }

        this.tierActive[tierNum] = true;
        this._isOwner = true;   // This device owns the monitoring loop
        this.checkCount = 0;

        const cfg = this.TIER_CONFIG[tierNum];
        Logger.log(`Tier ${tierNum} (${cfg.name}) started: monitoring ${added} coin${added !== 1 ? 's' : ''}`, 'success');
        tierCoins.forEach(asset => {
            const tgt = this.targets[asset.code];
            if (tgt) {
                const s = this.getTierSettings(tierNum);
                Logger.log(`  ${asset.code} (T${tierNum}): buy < $${tgt.buy.toFixed(2)}, sell > $${tgt.sell.toFixed(2)} (±${s.deviation}%, ${s.allocation}% alloc)`, 'info');
            }
        });

        this._updateUI();
        this._saveActiveState();
        this._ensureMonitoring();
    },

    stopTier(tierNum) {
        this.tierActive[tierNum] = false;

        // Remove targets for this tier's coins
        const tierCoins = this._getCoinsForTier(tierNum);
        tierCoins.forEach(code => {
            delete this.targets[code];
        });

        const cfg = this.TIER_CONFIG[tierNum];
        Logger.log(`Tier ${tierNum} (${cfg.name}) stopped`, 'info');

        // Stop monitoring if no tiers active
        if (!this.isActive) {
            this._isOwner = false;
            this._stopMonitoring();
        }

        this._updateUI();
        this._saveActiveState();
    },

    // Backward compat: global start/stop
    start() {
        // Start all tiers that have coins assigned
        for (let t = 1; t <= 3; t++) {
            const coins = this._getCoinsForTier(t);
            if (coins.length > 0 && !this.tierActive[t]) {
                this.startTier(t);
            }
        }
    },

    stop() {
        for (let t = 1; t <= 3; t++) {
            if (this.tierActive[t]) this.stopTier(t);
        }
    },

    // Resume auto-trading from saved state (called on page load)
    resume(savedState) {
        if (this.isActive) return;

        // Handle old format: savedTargets was just targets object
        // New format: { tierActive, targets, botDeviceId, botHeartbeat }
        let savedTargets, savedTierActive;
        if (savedState && savedState.tierActive) {
            savedTierActive = savedState.tierActive;
            savedTargets = savedState.targets || {};
        } else {
            // Old format: savedState IS the targets
            savedTargets = savedState || {};
            savedTierActive = null;
        }

        this.targets = {};
        for (const [code, val] of Object.entries(savedTargets)) {
            if (typeof val === 'object' && val.buy && val.sell) {
                this.targets[code] = val;
            } else if (typeof val === 'number') {
                const dev = this.getSettings(code).deviation;
                this.targets[code] = {
                    buy:  val * (1 - dev / 100),
                    sell: val * (1 + dev / 100)
                };
            }
        }

        // Remove coins on cooldown
        for (const code of Object.keys(this.targets)) {
            if (this._isOnCooldown(code)) {
                delete this.targets[code];
            }
        }

        // Restore per-tier active state
        if (savedTierActive) {
            this.tierActive = { 1: !!savedTierActive[1], 2: !!savedTierActive[2], 3: !!savedTierActive[3] };
        } else {
            // Old format: determine active tiers from targets
            for (let t = 1; t <= 3; t++) {
                const hasCoins = Object.keys(this.targets).some(c => this.getTier(c) === t);
                if (hasCoins) this.tierActive[t] = true;
            }
        }

        // ── Device ownership check ──
        // If another device is actively running (fresh heartbeat), don't start monitoring here
        const otherDevice = savedState.botDeviceId && savedState.botDeviceId !== this._deviceId;
        const freshHeartbeat = savedState.botHeartbeat && (Date.now() - savedState.botHeartbeat < this.HEARTBEAT_STALE);

        if (otherDevice && freshHeartbeat) {
            this._isOwner = false;
            Logger.log('Auto-trading active on another device — viewing only', 'info');
            this._updateUI();
            return;
        }

        // This device takes ownership
        this._isOwner = true;

        const activeCoins = Object.keys(this.targets);
        if (activeCoins.length === 0) {
            Logger.log('Auto-trade resume: all coins on cooldown — waiting...', 'info');
            this._updateUI();
            this._saveActiveState();
            this._ensureMonitoring();
            return;
        }

        Logger.log(`Auto-trading resumed: monitoring ${activeCoins.length} coins`, 'success');
        activeCoins.forEach(code => {
            const s = this.getSettings(code);
            const t = this.getTier(code);
            const tgt = this.targets[code];
            Logger.log(`  ${code} (T${t}): buy < $${tgt.buy.toFixed(2)}, sell > $${tgt.sell.toFixed(2)}`, 'info');
        });

        this._updateUI();
        this._saveActiveState();
        this._ensureMonitoring();
    },

    // ── Monitoring Control ───────────────────────────────────────────────────

    _ensureMonitoring() {
        if (!this.monitorInterval) {
            this.monitorInterval = setInterval(() => this._checkPrices(), 180000);
            this._checkPrices();
        }
    },

    _stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    },

    // ── Price Monitoring (all coins) ─────────────────────────────────────────

    async _checkPrices() {
        if (!this.isActive || !this._isOwner) {
            this._stopMonitoring();
            return;
        }

        this.checkCount++;

        // Refresh heartbeat every check so other devices know we're alive
        this._saveActiveState();

        // Every 3rd check (~9 min): verify no other device took over or stopped us remotely
        if (this.checkCount % 3 === 0) {
            const remoteOk = await this._verifyOwnership();
            if (!remoteOk) return; // Ownership lost, monitoring stopped
        }

        // Refresh portfolio data every 2 checks
        if (this.checkCount % 2 === 0) {
            Logger.log('Refreshing prices...', 'info');
            await API.refreshData();
        }

        let tradeExecuted = false;

        for (const code of Object.keys(this.targets)) {
            if (this._isOnCooldown(code)) continue;

            // Only check coins in active tiers
            const tier = this.getTier(code);
            if (!this.tierActive[tier]) continue;

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

        // Refresh after trades
        if (tradeExecuted) {
            await API.refreshData();
            this.renderTierCards();
            this._saveActiveState();
        }

        // Update status display
        this._updateStatus();

        // Log cooldown status
        const remaining = Object.keys(this.targets).filter(c => !this._isOnCooldown(c));
        const onCooldown = Object.keys(this.targets).length - remaining.length;
        if (remaining.length === 0 && onCooldown > 0) {
            Logger.log(`All ${onCooldown} coins on cooldown — waiting for cooldowns to expire...`, 'info');
        }
    },

    // Verify this device still owns the bot (another device may have taken over or stopped)
    async _verifyOwnership() {
        try {
            const wallet = typeof PhantomWallet !== 'undefined' ? PhantomWallet.walletAddress : null;
            if (!wallet) return true; // Can't check, keep running

            const res = await fetch(`/api/state?admin_wallet=${encodeURIComponent(wallet)}`);
            if (!res.ok) return true; // Network error, keep running

            const data = await res.json();
            if (!data.autoActive) return true;

            // Another device took over
            if (data.autoActive.botDeviceId && data.autoActive.botDeviceId !== this._deviceId) {
                Logger.log('Another device took over auto-trading — stopping local monitoring', 'info');
                this._isOwner = false;
                this._stopMonitoring();
                this._updateUI();
                return false;
            }

            // Stopped remotely
            if (!data.autoActive.isActive) {
                Logger.log('Auto-trading stopped from another device', 'info');
                this.tierActive = { 1: false, 2: false, 3: false };
                this._isOwner = false;
                this._stopMonitoring();
                this._updateUI();
                return false;
            }

            // Sync tier active state from server (another device may have started/stopped a tier)
            if (data.autoActive.tierActive) {
                this.tierActive = {
                    1: !!data.autoActive.tierActive[1],
                    2: !!data.autoActive.tierActive[2],
                    3: !!data.autoActive.tierActive[3]
                };
            }

            return true;
        } catch (e) {
            return true; // Network error, keep running
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
                // Record to MongoDB
                API.recordTradeInDB(code, 'buy', quantity, currentPrice);
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
                // Record to MongoDB
                API.recordTradeInDB(code, 'sell', quantity, currentPrice);
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
        const badge = document.getElementById('autoStatusBadge');
        const status = document.getElementById('autoStatus');

        if (this.isActive) {
            if (badge) { badge.style.display = 'inline-block'; badge.textContent = 'ACTIVE'; }
            if (status) {
                status.style.display = 'block';
                // Render the full monitoring view immediately
                this._updateStatus();
            }
        } else {
            if (badge) badge.style.display = 'none';
            if (status) status.style.display = 'none';
        }

        // Re-render tier cards to update button states
        this.renderTierCards();

        // Keep user insight cards in sync
        if (typeof UI !== 'undefined') UI.updateUserInsightCards();
    },

    _updateStatus() {
        const status = document.getElementById('autoStatus');
        if (!status) return;

        const allCoins = Object.keys(this.targets);
        const activeCoins = allCoins.filter(c => !this._isOnCooldown(c));
        const cdCoins     = allCoins.filter(c => this._isOnCooldown(c));

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:6px;">`;
        html += `<span>Monitoring ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
        if (cdCoins.length > 0) html += ` <span style="color:#94a3b8; font-weight:400;">(${cdCoins.length} on cooldown)</span>`;
        html += `</span>`;
        html += `<span id="priceCountdown" style="font-size:9px; font-weight:600; color:#94a3b8;"></span>`;
        html += '</div>';

        // Group coins by tier
        for (let t = 1; t <= 3; t++) {
            if (!this.tierActive[t]) continue;

            const cfg = this.TIER_CONFIG[t];
            const tierActive = activeCoins.filter(c => this.getTier(c) === t);
            const tierCd     = cdCoins.filter(c => this.getTier(c) === t);

            if (tierActive.length === 0 && tierCd.length === 0) continue;

            // Tier header
            html += `<div style="font-size:9px;font-weight:700;color:${cfg.color};margin:6px 0 3px;text-transform:uppercase;letter-spacing:0.5px;">T${t} – ${cfg.name}</div>`;

            html += '<div style="display:flex; flex-direction:column; gap:4px; margin-bottom:4px;">';

            for (const code of tierActive) {
                const currentPrice = API.getRealtimePrice(code);
                const tgt = this.targets[code];
                if (!tgt || !currentPrice) continue;

                const midPrice  = (tgt.buy + tgt.sell) / 2;
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

                const change = ((currentPrice - midPrice) / midPrice) * 100;

                let barColor;
                if (progress < 0.5)      barColor = '#3b82f6';
                else if (progress < 0.75) barColor = '#eab308';
                else if (progress < 0.95) barColor = '#f97316';
                else                      barColor = '#ef4444';

                const sign = change >= 0 ? '+' : '';
                const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };
                const borderCol = change >= 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';

                const tierBg = this._hexToRgba(cfg.color, 0.06);
                html += `<div style="padding:6px 8px; border-radius:6px; background:${tierBg}; border:1px solid ${borderCol};">`;
                html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">`;
                html += `<span style="font-size:11px; font-weight:700; color:${style.color}; min-width:42px;">${code}</span>`;
                html += `<span style="font-size:10px; color:${cfg.color}; opacity:0.7;">T${t}</span>`;
                html += `<div style="flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">`;
                html += `<div class="at-bar" data-code="${code}" style="width:${(progress * 100).toFixed(0)}%; height:100%; background:${barColor}; border-radius:2px; transition:width 0.8s, background 0.8s;"></div>`;
                html += `</div>`;
                html += `<span class="at-change" data-code="${code}" style="font-size:11px; font-weight:600; color:${barColor}; min-width:50px; text-align:right;">${sign}${change.toFixed(2)}%</span>`;
                html += `</div>`;
                html += `<div style="display:flex; justify-content:space-between; font-size:9px; color:#64748b;">`;
                html += `<span>Buy &lt; $${tgt.buy.toFixed(2)}</span>`;
                html += `<span class="at-price" data-code="${code}" data-field="at-current" style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
                html += `<span>Sell &gt; $${tgt.sell.toFixed(2)}</span>`;
                html += `</div></div>`;
            }

            // Cooldown coins
            for (const code of tierCd) {
                const tgt = this.targets[code];
                const currentPrice = API.getRealtimePrice(code);
                const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };
                const remaining = this._getCooldownRemaining(code);

                const cdMid = tgt ? (tgt.buy + tgt.sell) / 2 : 0;
                const cdChange = cdMid ? ((currentPrice - cdMid) / cdMid) * 100 : 0;
                const cdBorder = cdChange >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';

                const cdTierBg = this._hexToRgba(cfg.color, 0.04);
                html += `<div style="padding:6px 8px; border-radius:6px; background:${cdTierBg}; border:1px solid ${cdBorder}; opacity:0.5;">`;
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

            html += '</div>';
        }

        status.innerHTML = html;

        // Update trade log
        this._renderTradeLog();
    },

    // ── Trade Log ─────────────────────────────────────────────────────────────

    _addTradeLog(coin, side, quantity, price, amount) {
        const entry = {
            time: new Date(),
            coin,
            side,
            quantity,
            price,
            amount
        };
        this.tradeLog.unshift(entry);
        if (this.tradeLog.length > 50) this.tradeLog.pop();

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

    // ── Override Cooldowns (per-tier) ────────────────────────────────────────

    overrideCooldowns(tierNum) {
        const tierCoins = this._getCoinsForTier(tierNum);
        let cleared = 0;

        for (const code of tierCoins) {
            if (this.cooldowns[code]) {
                delete this.cooldowns[code];
                cleared++;
            }
        }

        if (cleared === 0) {
            Logger.log(`No cooldowns to override in Tier ${tierNum}`, 'info');
            return;
        }

        localStorage.setItem('auto_cooldowns', JSON.stringify(this.cooldowns));
        if (typeof ServerState !== 'undefined') ServerState.saveCooldowns();

        // Add coins that weren't in targets
        const holdings = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0 && this.getTier(a.code) === tierNum
        );
        let added = 0;
        for (const asset of holdings) {
            if (!this.targets[asset.code]) {
                const price = API.getRealtimePrice(asset.code) || asset.usd_price;
                const dev = this.getTierSettings(tierNum).deviation;
                this.targets[asset.code] = {
                    buy:  price * (1 - dev / 100),
                    sell: price * (1 + dev / 100)
                };
                added++;
                Logger.log(`  Added ${asset.code}: buy < $${this.targets[asset.code].buy.toFixed(2)}, sell > $${this.targets[asset.code].sell.toFixed(2)}`, 'info');
            }
        }

        Logger.log(`Tier ${tierNum} cooldowns overridden — ${cleared} cleared, ${added} coin(s) added`, 'success');

        this._saveActiveState();
        this._updateStatus();
        this.renderTierCards();

        if (this.tierActive[tierNum]) {
            this._checkPrices();
        }
    },

    // ── Persistence ──────────────────────────────────────────────────────────

    _saveTierSettings() {
        localStorage.setItem('auto_tiers', JSON.stringify({
            tier1: this.tier1,
            tier2: this.tier2,
            tier3: this.tier3
        }));
        if (typeof ServerState !== 'undefined') ServerState.saveTiers();
    },

    _saveTierAssignments() {
        localStorage.setItem('auto_tier_assignments', JSON.stringify(this.tierAssignments));
        if (typeof ServerState !== 'undefined') ServerState.saveTierAssignments();
    },

    _saveActiveState() {
        const state = {
            isActive: this.isActive,
            tierActive: this.tierActive,
            targets: this.targets,
            botDeviceId: this._deviceId,
            botHeartbeat: Date.now()
        };
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

    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
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
                if (parsed.tier3) this.tier3 = parsed.tier3;
            } catch (e) {}
        }

        // Load tier assignments
        const assignData = localStorage.getItem('auto_tier_assignments');
        if (assignData) {
            try {
                this.tierAssignments = JSON.parse(assignData);
            } catch (e) {
                this.tierAssignments = {};
            }
        }

        // Render tier cards (may be empty until portfolio loads)
        this.renderTierCards();
        this._renderTradeLog();
    },

    clearTradeLog() {
        this.tradeLog = [];
        localStorage.removeItem('auto_trade_log');
        if (typeof ServerState !== 'undefined') ServerState.saveTradeLog();
        this._renderTradeLog();
    }
};

AutoTrader.init();
