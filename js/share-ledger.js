// ==========================================
// SHARE LEDGER — NAV-based pool accounting
// ==========================================
// Fair share-based accounting for multi-user pools.
// Works like mutual fund / LP token math:
//   - Pool has total shares outstanding
//   - NAV (Net Asset Value) per share = totalPoolValue / totalShares
//   - On deposit: sharesIssued = depositAmount / currentNAV
//   - User value = userShares × currentNAV
//   - P&L = currentValue − totalDeposited
//
// TODO: Migrate from localStorage to server-side database for production.
//       localStorage is per-browser, so share data must be centralized
//       for multi-user access across devices.

const ShareLedger = {

    POOL_KEY: 'flub_pool_shares',

    // ── Pool initialization ──────────────────────────────────────────────

    /**
     * Ensure pool share data exists. Called on app startup once pool value
     * is known. If no share data exists, bootstraps with NAV = $1.00/share
     * so the project owns all initial shares.
     */
    initializePool(totalPoolValue) {
        if (totalPoolValue <= 0) return;

        const existing = localStorage.getItem(this.POOL_KEY);
        if (existing) return; // Already initialized

        const data = {
            totalShares: totalPoolValue, // NAV = $1.00/share
            initialized: Date.now()
        };
        localStorage.setItem(this.POOL_KEY, JSON.stringify(data));
        Logger.log(`ShareLedger: Pool initialized — ${totalPoolValue.toFixed(2)} shares (NAV $1.00)`, 'info');
    },

    // ── Pool state ───────────────────────────────────────────────────────

    getPoolData() {
        const raw = localStorage.getItem(this.POOL_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    },

    getTotalShares() {
        const data = this.getPoolData();
        return data ? data.totalShares : 0;
    },

    /**
     * Current NAV per share.
     * NAV = totalPoolValue / totalSharesOutstanding
     */
    getNAV(totalPoolValue) {
        const totalShares = this.getTotalShares();
        if (totalShares <= 0 || totalPoolValue <= 0) return 1; // Default $1
        return totalPoolValue / totalShares;
    },

    // ── Share issuance (on deposit) ──────────────────────────────────────

    /**
     * Issue new shares to a user for their deposit.
     * Returns { shares, nav } — the number of shares issued and the NAV
     * at which they were issued.
     */
    issueShares(wallet, depositAmount, totalPoolValue) {
        // Ensure pool is initialized
        this.initializePool(totalPoolValue);

        const poolData = this.getPoolData();
        if (!poolData) {
            Logger.log('ShareLedger: Cannot issue shares — pool not initialized', 'error');
            return { shares: 0, nav: 1 };
        }

        // NAV before this deposit (pool value BEFORE deposit is added)
        // The deposit amount is already included in pool value on-chain,
        // but for NAV calculation we use the pre-deposit pool value
        const preDepositPoolValue = totalPoolValue - depositAmount;
        const nav = preDepositPoolValue > 0
            ? preDepositPoolValue / poolData.totalShares
            : 1; // First deposit ever — NAV = $1

        const newShares = depositAmount / nav;

        // Update global total shares
        poolData.totalShares += newShares;
        localStorage.setItem(this.POOL_KEY, JSON.stringify(poolData));

        // Update user's share balance
        const userKey = `flub_shares_${wallet}`;
        const userData = JSON.parse(localStorage.getItem(userKey) || '{"shares":0}');
        userData.shares += newShares;
        localStorage.setItem(userKey, JSON.stringify(userData));

        Logger.log(
            `ShareLedger: Issued ${newShares.toFixed(4)} shares @ NAV $${nav.toFixed(4)} ` +
            `(total shares: ${poolData.totalShares.toFixed(2)})`, 'success'
        );

        return { shares: newShares, nav };
    },

    // ── User queries ─────────────────────────────────────────────────────

    getUserShares(wallet) {
        if (!wallet) return 0;
        const userKey = `flub_shares_${wallet}`;
        const userData = JSON.parse(localStorage.getItem(userKey) || '{"shares":0}');
        return userData.shares;
    },

    /**
     * Returns complete user position data.
     * { shares, nav, currentValue, allocation }
     */
    getUserPosition(wallet, totalPoolValue) {
        const totalShares = this.getTotalShares();
        const userShares = this.getUserShares(wallet);
        const nav = this.getNAV(totalPoolValue);

        return {
            shares: userShares,
            nav: nav,
            currentValue: userShares * nav,
            allocation: totalShares > 0 ? (userShares / totalShares) * 100 : 0
        };
    },

    // ── Migration ────────────────────────────────────────────────────────

    /**
     * Migrate legacy deposits that don't have share data.
     * For existing deposits made before share-based accounting,
     * we assign shares at NAV = $1 (fair if pool hasn't changed much).
     * Called once when user connects wallet after the upgrade.
     */
    migrateIfNeeded(wallet, totalDeposited, totalPoolValue) {
        if (!wallet || totalDeposited <= 0) return;

        // If pool share data doesn't exist, initialize it
        this.initializePool(totalPoolValue);

        // If user already has shares, skip migration
        const existing = this.getUserShares(wallet);
        if (existing > 0) return;

        // Assign shares for legacy deposits at current NAV
        const poolData = this.getPoolData();
        if (!poolData) return;

        const nav = this.getNAV(totalPoolValue);
        const shares = totalDeposited / nav;

        // Update global total
        poolData.totalShares += shares;
        localStorage.setItem(this.POOL_KEY, JSON.stringify(poolData));

        // Set user shares
        const userKey = `flub_shares_${wallet}`;
        localStorage.setItem(userKey, JSON.stringify({ shares }));

        Logger.log(
            `ShareLedger: Migrated legacy deposits — ${shares.toFixed(4)} shares ` +
            `@ NAV $${nav.toFixed(4)} for $${totalDeposited.toFixed(2)} deposited`, 'info'
        );
    }
};
