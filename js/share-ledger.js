// ==========================================
// SHARE LEDGER — NAV-based pool accounting
// ==========================================
// Calls MongoDB-backed API for share data.
// Falls back to localStorage if API is unreachable (offline mode).
//
// API endpoints:
//   GET  /api/user/position?wallet=...&poolValue=...
//   GET  /api/pool/state
//   POST /api/deposit        { walletAddress, amount, txHash, totalPoolValue }
//   POST /api/pool/initialize { adminWallet, totalPoolValue }

const ShareLedger = {

    // Cache to avoid hammering the API every tick
    _cache: { position: null, poolState: null, lastFetch: 0 },
    CACHE_TTL: 5000, // 5 seconds

    // ── Pool initialization ──────────────────────────────────────────────

    async initializePool(totalPoolValue) {
        if (totalPoolValue <= 0) return;

        try {
            const res = await fetch('/api/pool/state');
            if (res.ok) {
                const data = await res.json();
                if (data.totalShares > 0) return; // Already initialized
            }
        } catch (e) {
            // API unavailable — check localStorage fallback
            if (localStorage.getItem('flub_pool_shares')) return;
        }

        // Try to initialize via API (admin only)
        const adminWallet = CONFIG.ADMIN_WALLETS?.[0];
        if (adminWallet) {
            try {
                await fetch('/api/pool/initialize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adminWallet: adminWallet,
                        totalPoolValue: totalPoolValue
                    })
                });
                Logger.log(`ShareLedger: Pool initialized via API — NAV $1.00`, 'info');
                return;
            } catch (e) {
                // Fall through to localStorage
            }
        }

        // Fallback: localStorage
        const data = { totalShares: totalPoolValue, initialized: Date.now() };
        localStorage.setItem('flub_pool_shares', JSON.stringify(data));
        Logger.log(`ShareLedger: Pool initialized (localStorage fallback) — ${totalPoolValue.toFixed(2)} shares`, 'info');
    },

    // ── User position (shares, NAV, value, allocation) ───────────────────

    async fetchUserPosition(wallet, totalPoolValue) {
        if (!wallet || totalPoolValue <= 0) {
            return { shares: 0, nav: 1, currentValue: 0, allocation: 0, totalDeposited: 0 };
        }

        // Return cached if fresh
        const now = Date.now();
        if (this._cache.position && (now - this._cache.lastFetch) < this.CACHE_TTL) {
            return this._cache.position;
        }

        try {
            const res = await fetch(
                `/api/user/position?wallet=${encodeURIComponent(wallet)}&poolValue=${totalPoolValue}`
            );
            if (res.ok) {
                const position = await res.json();
                this._cache.position = position;
                this._cache.lastFetch = now;
                return position;
            }
        } catch (e) {
            Logger.log('ShareLedger: API unreachable, using localStorage fallback', 'warn');
        }

        // Fallback: compute from localStorage
        return this._getPositionFromLocalStorage(wallet, totalPoolValue);
    },

    /**
     * Synchronous position getter using cached API data or localStorage.
     * Used by calculateUserAllocation() which runs on every price tick.
     */
    getUserPosition(wallet, totalPoolValue) {
        // If we have a recent API cache, use it
        if (this._cache.position && (Date.now() - this._cache.lastFetch) < this.CACHE_TTL) {
            return this._cache.position;
        }

        // Fallback: localStorage
        return this._getPositionFromLocalStorage(wallet, totalPoolValue);
    },

    // ── Deposit with share issuance ──────────────────────────────────────

    async recordDeposit(wallet, amount, txHash, totalPoolValue) {
        // Try API first
        try {
            let res = await fetch('/api/deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: wallet,
                    amount: amount,
                    txHash: txHash,
                    totalPoolValue: totalPoolValue
                })
            });

            // If user not found, auto-register and retry
            if (!res.ok) {
                const err = await res.json();
                if (err.error && err.error.includes('not found')) {
                    Logger.log('ShareLedger: Auto-registering user before deposit...', 'info');
                    await fetch('/api/user/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ walletAddress: wallet })
                    });

                    // Retry deposit
                    res = await fetch('/api/deposit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            walletAddress: wallet,
                            amount: amount,
                            txHash: txHash,
                            totalPoolValue: totalPoolValue
                        })
                    });
                }
            }

            if (res.ok) {
                const result = await res.json();
                // Invalidate cache so next tick fetches fresh data
                this._cache.position = null;
                this._cache.lastFetch = 0;

                Logger.log(
                    `ShareLedger: Deposit recorded via API — ${result.shares.toFixed(4)} shares ` +
                    `@ NAV $${result.nav.toFixed(4)}`, 'success'
                );
                return { shares: result.shares, nav: result.nav };
            }

            Logger.log(`ShareLedger: API deposit failed`, 'error');
        } catch (e) {
            Logger.log('ShareLedger: API unreachable for deposit, using localStorage fallback', 'warn');
        }

        // Fallback: localStorage (also always store locally for offline access)
        return this._issueSharesLocalStorage(wallet, amount, totalPoolValue);
    },

    // ── localStorage fallbacks ───────────────────────────────────────────

    _getPositionFromLocalStorage(wallet, totalPoolValue) {
        const poolRaw = localStorage.getItem('flub_pool_shares');
        if (!poolRaw) {
            return { shares: 0, nav: 1, currentValue: 0, allocation: 0, totalDeposited: 0 };
        }

        const pool = JSON.parse(poolRaw);
        const totalShares = pool.totalShares || 0;

        const userRaw = localStorage.getItem(`flub_shares_${wallet}`);
        const userShares = userRaw ? JSON.parse(userRaw).shares || 0 : 0;

        const nav = totalShares > 0 ? totalPoolValue / totalShares : 1;

        // Get totalDeposited from deposit records
        const depositsRaw = localStorage.getItem(`flub_deposits_${wallet}`);
        const deposits = depositsRaw ? JSON.parse(depositsRaw) : [];
        const totalDeposited = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);

        return {
            shares: userShares,
            nav: nav,
            currentValue: userShares * nav,
            allocation: totalShares > 0 ? (userShares / totalShares) * 100 : 0,
            totalDeposited: totalDeposited
        };
    },

    _issueSharesLocalStorage(wallet, depositAmount, totalPoolValue) {
        // Ensure pool initialized
        let poolRaw = localStorage.getItem('flub_pool_shares');
        if (!poolRaw) {
            const data = { totalShares: totalPoolValue, initialized: Date.now() };
            localStorage.setItem('flub_pool_shares', JSON.stringify(data));
            poolRaw = JSON.stringify(data);
        }

        const pool = JSON.parse(poolRaw);
        const preDepositValue = totalPoolValue - depositAmount;
        const nav = preDepositValue > 0 ? preDepositValue / pool.totalShares : 1;
        const newShares = depositAmount / nav;

        // Update pool
        pool.totalShares += newShares;
        localStorage.setItem('flub_pool_shares', JSON.stringify(pool));

        // Update user
        const userKey = `flub_shares_${wallet}`;
        const userData = JSON.parse(localStorage.getItem(userKey) || '{"shares":0}');
        userData.shares += newShares;
        localStorage.setItem(userKey, JSON.stringify(userData));

        Logger.log(
            `ShareLedger: Issued ${newShares.toFixed(4)} shares @ NAV $${nav.toFixed(4)} (localStorage)`, 'success'
        );

        return { shares: newShares, nav };
    },

    // ── Migration ────────────────────────────────────────────────────────

    migrateIfNeeded(wallet, totalDeposited, totalPoolValue) {
        if (!wallet || totalDeposited <= 0) return;

        // Check localStorage — if user already has shares, skip
        const userRaw = localStorage.getItem(`flub_shares_${wallet}`);
        if (userRaw) {
            const userData = JSON.parse(userRaw);
            if (userData.shares > 0) return;
        }

        // Initialize pool if needed
        let poolRaw = localStorage.getItem('flub_pool_shares');
        if (!poolRaw) {
            const data = { totalShares: totalPoolValue, initialized: Date.now() };
            localStorage.setItem('flub_pool_shares', JSON.stringify(data));
            poolRaw = JSON.stringify(data);
        }

        const pool = JSON.parse(poolRaw);
        const nav = pool.totalShares > 0 ? totalPoolValue / pool.totalShares : 1;
        const shares = totalDeposited / nav;

        pool.totalShares += shares;
        localStorage.setItem('flub_pool_shares', JSON.stringify(pool));
        localStorage.setItem(`flub_shares_${wallet}`, JSON.stringify({ shares }));

        Logger.log(
            `ShareLedger: Migrated legacy deposits — ${shares.toFixed(4)} shares @ NAV $${nav.toFixed(4)}`, 'info'
        );
    }
};
