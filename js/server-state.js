// ==========================================
// ServerState - Cross-Device State Persistence
// ==========================================
// Syncs auto-trader config, cooldowns, trade log, and pending orders
// to MongoDB via /api/state so state survives device switches.
//
// All writes are debounced (500ms) to avoid hammering the API.

const ServerState = {
    _saveTimer: null,
    _loaded: false,

    // ── Load full state from server ──────────────────────────────────────────

    async load() {
        const wallet = PhantomWallet.walletAddress;
        if (!wallet || State.userRole !== 'admin') return;

        try {
            const res = await fetch(`/api/state?admin_wallet=${encodeURIComponent(wallet)}`);
            if (!res.ok) {
                const errBody = await res.text();
                Logger.log(`ServerState load: HTTP ${res.status} — ${errBody}`, 'error');
                return;
            }

            const data = await res.json();
            if (data.error) {
                Logger.log(`ServerState load: ${data.error}`, 'error');
                return;
            }
            this._loaded = true;

            // ── Apply to AutoTrader ──
            if (data.autoTiers) {
                if (data.autoTiers.tier1) AutoTrader.tier1 = data.autoTiers.tier1;
                if (data.autoTiers.tier2) AutoTrader.tier2 = data.autoTiers.tier2;
                AutoTrader._syncSlidersToSettings();
            }

            if (data.autoCooldowns && typeof data.autoCooldowns === 'object') {
                // Remove expired cooldowns
                const now = Date.now();
                AutoTrader.cooldowns = {};
                for (const [coin, ts] of Object.entries(data.autoCooldowns)) {
                    if (ts > now) AutoTrader.cooldowns[coin] = ts;
                }
            }

            if (Array.isArray(data.autoTradeLog)) {
                AutoTrader.tradeLog = data.autoTradeLog;
                AutoTrader._renderTradeLog();
            }

            // ── Apply pending orders ──
            if (Array.isArray(data.pendingOrders)) {
                // Store in Trading's local key format for fetchPendingOrders to pick up
                localStorage.setItem(Trading._LOCAL_KEY, JSON.stringify(data.pendingOrders));
                API.fetchPendingOrders();
            }

            Logger.log(`ServerState: loaded (${data.pendingOrders?.length ?? 0} orders, ${data.autoTradeLog?.length ?? 0} trades)`, 'info');

        } catch (err) {
            Logger.log(`ServerState load error: ${err.message}`, 'error');
        }
    },

    // ── Save specific keys to server (debounced) ─────────────────────────────

    save(keys) {
        // keys: object with one or more of: pendingOrders, autoTiers, autoCooldowns, autoTradeLog
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._doSave(keys), 500);
    },

    // Immediate save (for critical operations like placing orders)
    async saveNow(keys) {
        clearTimeout(this._saveTimer);
        await this._doSave(keys);
    },

    async _doSave(keys) {
        const wallet = PhantomWallet.walletAddress;
        if (!wallet || State.userRole !== 'admin') return;

        try {
            const body = { adminWallet: wallet, ...keys };
            const res = await fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errBody = await res.text();
                Logger.log(`ServerState save: HTTP ${res.status} — ${errBody}`, 'error');
            } else {
                Logger.log('ServerState: saved to server', 'info');
            }
        } catch (err) {
            Logger.log(`ServerState save error: ${err.message}`, 'error');
        }
    },

    // ── Convenience methods ──────────────────────────────────────────────────

    savePendingOrders() {
        const orders = Trading.getLocalPendingOrders();
        this.save({ pendingOrders: orders });
    },

    savePendingOrdersNow() {
        const orders = Trading.getLocalPendingOrders();
        return this.saveNow({ pendingOrders: orders });
    },

    saveTiers() {
        this.save({ autoTiers: { tier1: AutoTrader.tier1, tier2: AutoTrader.tier2 } });
    },

    saveCooldowns() {
        this.save({ autoCooldowns: AutoTrader.cooldowns });
    },

    saveTradeLog() {
        this.save({ autoTradeLog: AutoTrader.tradeLog });
    }
};
