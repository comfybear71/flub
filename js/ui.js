// ==========================================
// UI - User Interface & DOM Manipulation
// ==========================================
const UI = {
    // Track which chart view is showing for users: 'user' (default) or 'pool'
    chartView: 'user',
    // Track which holdings view: 'mine' (default for users) or 'project'
    holdingsView: 'mine',

    init() {
        // Only show PIN for admin (deferred until role is known)
        // Non-admins never see the PIN modal
    },

    // ── Role-based UI ───────────────────────────────────────────────────────

    applyRole(role) {
        const adminEls = document.querySelectorAll('.admin-only');
        const userEls = document.querySelectorAll('.user-only');

        if (role === 'admin') {
            // Show admin sections, hide user-only sections
            adminEls.forEach(el => el.style.display = '');
            userEls.forEach(el => el.style.display = 'none');
            // Hide swipe dots for admin
            const dots = document.getElementById('chartDots');
            if (dots) dots.style.display = 'none';
            // Re-enforce order type visibility (applyRole shows ALL admin-only,
            // so we need to re-hide sections that don't belong to the active tab)
            this.setOrderType(State.orderType || 'instant');
            // Show PIN modal if no PIN set
            this.checkPin();
            Logger.log('Admin mode active', 'success');
        } else if (role === 'user') {
            // Hide admin sections, show user sections
            adminEls.forEach(el => el.style.display = 'none');
            userEls.forEach(el => el.style.display = '');
            // Show swipe dots for user
            const dots = document.getElementById('chartDots');
            if (dots) dots.style.display = 'block';
            // Show insight cards
            const cards = document.getElementById('userInsightCards');
            if (cards) cards.style.display = 'flex';
            this.updateUserInsightCards();
            // Show and populate portfolio info panel
            const portfolioInfo = document.getElementById('userPortfolioInfo');
            if (portfolioInfo) portfolioInfo.style.display = 'block';
            this.updateUserPortfolioInfo();
            // Init swipe gestures
            this._initChartSwipe();
            // Close any open trading panel
            this.closeTradingView();
            Logger.log('User mode active', 'success');
        } else {
            // Not connected — hide BOTH admin and user sections, visitors see chart + holdings only
            adminEls.forEach(el => el.style.display = 'none');
            userEls.forEach(el => el.style.display = 'none');
            const dots = document.getElementById('chartDots');
            if (dots) dots.style.display = 'none';
        }
    },

    // ── Chart swipe for users ────────────────────────────────────────────────

    _swipeInitialized: false,

    _initChartSwipe() {
        if (this._swipeInitialized) return;
        this._swipeInitialized = true;

        const chartArea = document.querySelector('.portfolio-view');
        if (!chartArea) return;

        let startX = 0;
        chartArea.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
        }, { passive: true });

        chartArea.addEventListener('touchend', (e) => {
            const diffX = e.changedTouches[0].clientX - startX;
            if (Math.abs(diffX) > 50) {
                if (diffX < 0) {
                    // Swipe left → project chart
                    this._setChartView('pool');
                } else {
                    // Swipe right → my chart
                    this._setChartView('user');
                }
            }
        }, { passive: true });

        // Also allow tapping the dots
        document.getElementById('dot-pool')?.addEventListener('click', () => this._setChartView('pool'));
        document.getElementById('dot-user')?.addEventListener('click', () => this._setChartView('user'));
    },

    _setChartView(view) {
        this.chartView = view;
        // Update dots
        const dotPool = document.getElementById('dot-pool');
        const dotUser = document.getElementById('dot-user');
        if (dotPool) dotPool.style.background = view === 'pool' ? '#3b82f6' : 'rgba(255,255,255,0.2)';
        if (dotUser) dotUser.style.background = view === 'user' ? '#3b82f6' : 'rgba(255,255,255,0.2)';
        // Re-render the chart
        this.renderPortfolio();
    },

    // ── PIN / Auth (admin only) ──────────────────────────────────────────────

    checkPin() {
        if (State.userRole !== 'admin') return;
        const savedPin = localStorage.getItem('tradePin');
        if (!savedPin) {
            document.getElementById('pinModal')?.classList.add('show');
        } else {
            CONFIG.TRADE_PIN = savedPin;
        }
    },

    unlockTrading() {
        const pinInput = document.getElementById('pinInput');
        const pinError = document.getElementById('pinError');
        const pinBtn   = document.getElementById('pinBtn');
        if (!pinInput || !pinBtn) return;

        pinBtn.disabled    = true;
        pinBtn.textContent = 'Verifying...';

        if (pinInput.value.length >= 4) {
            CONFIG.TRADE_PIN = pinInput.value;
            localStorage.setItem('tradePin', pinInput.value);
            document.getElementById('pinModal')?.classList.remove('show');
            Logger.log('Trading unlocked', 'success');
        } else {
            pinError?.classList.add('show');
            pinBtn.disabled    = false;
            pinBtn.textContent = 'Unlock';
        }
    },

    // ── Status & Header ───────────────────────────────────────────────────────

    updateStatus(status) {
        const el = document.getElementById('api-status');
        if (!el) return;

        const statusMap = {
            connected:    { cls: 'api-status api-connected',    dot: 'bg-green-400',  text: 'Connected' },
            connecting:   { cls: 'api-status api-connecting',   dot: 'bg-yellow-400', text: 'Connecting...' },
            disconnected: { cls: 'api-status api-disconnected', dot: 'bg-red-400',    text: 'Disconnected' }
        };
        const cfg = statusMap[status] ?? statusMap.disconnected;
        el.className = cfg.cls;
        el.innerHTML = `<span class="w-2 h-2 rounded-full ${cfg.dot}"></span> ${cfg.text}`;
        State.isConnected = (status === 'connected');
    },

    updateLastUpdated() {
        const el = document.getElementById('last-updated');
        if (!el) return;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.textContent = `Last updated: ${time}`;
    },

    // ── Portfolio Chart ───────────────────────────────────────────────────────

    renderPortfolio() {
        const ctx = document.getElementById('portfolioChart');
        if (!ctx) return;

        State.portfolioChart?.destroy();

        const usdcAsset   = State.portfolioData.assets.find(a => a.code === 'USDC');
        const audAsset    = State.portfolioData.assets.find(a => a.code === 'AUD');
        const usdcBalance = usdcAsset?.usd_value ?? 0;
        const audBalance  = audAsset?.usd_value  ?? 0;

        const headerUsdc = document.getElementById('headerUsdcBalance');
        const headerAud  = document.getElementById('headerAudBalance');

        // Admin always sees pool totals for USDC/AUD
        if (headerUsdc) headerUsdc.textContent = Assets.formatCurrency(usdcBalance);
        if (headerAud)  headerAud.textContent  = Assets.formatCurrency(audBalance);

        // Update portfolio hint text
        const hintEl = document.getElementById('portfolioHint');
        const labelEl = document.getElementById('chartLabel');

        const cryptoAssets = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.usd_value > 10
        );

        const cryptoTotal = cryptoAssets.reduce((sum, a) => sum + (a.usd_value || 0), 0);
        const totalValue  = cryptoTotal + usdcBalance + audBalance;

        // Recalculate user allocation every time portfolio refreshes
        this.calculateUserAllocation();
        this.updateUserPortfolioInfo();

        const isUser = State.userRole === 'user';
        const deposited = State.userDeposits || 0;
        const hasAllocation = State.userAllocation > 0;

        // Determine chart data and labels
        let chartData, chartColors, chartLabels, centerLabel, centerValue, subtitle;

        if (isUser && this.chartView === 'user') {
            // USER'S OWN CHART — shows their deposit + their share of crypto
            if (hasAllocation) {
                // User has allocation — show their proportional crypto holdings
                const userCrypto = cryptoAssets.map(a => (a.usd_value || 0) * (State.userAllocation / 100));
                chartData = [...userCrypto];
                chartColors = [...cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666')];
                chartLabels = [...cryptoAssets.map(a => a.code)];
                centerLabel = 'My Portfolio';
                centerValue = Assets.formatCurrency(State.userCurrentValue || deposited);
                subtitle = `${State.userAllocation.toFixed(1)}% of pool`;
            } else {
                // User deposited but has NO allocation yet — show USDC only
                chartData = deposited > 0 ? [deposited] : [1];
                chartColors = deposited > 0 ? ['#22c55e'] : ['#1e293b'];
                chartLabels = deposited > 0 ? ['USDC'] : ['Empty'];
                centerLabel = 'My Portfolio';
                centerValue = deposited > 0 ? Assets.formatCurrency(deposited) : '$0.00';
                subtitle = deposited > 0 ? 'USDC deposited' : 'No deposits yet';
            }
            if (hintEl) hintEl.textContent = 'Swipe left for project view';
        } else if (isUser && this.chartView === 'pool') {
            // USER SEES PROJECT CHART
            chartData = cryptoAssets.map(a => a.usd_value || 0);
            chartColors = cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666');
            chartLabels = cryptoAssets.map(a => a.code);
            centerLabel = 'Project Total';
            centerValue = Assets.formatCurrency(totalValue);
            subtitle = `${cryptoAssets.length} assets`;
            if (hintEl) hintEl.textContent = 'Swipe right for your portfolio';
        } else if (State.userRole === 'admin') {
            // Admin view
            chartData = cryptoAssets.map(a => a.usd_value || 0);
            chartColors = cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666');
            chartLabels = cryptoAssets.map(a => a.code);
            centerLabel = 'Total';
            centerValue = Assets.formatCurrency(totalValue);
            subtitle = `${cryptoAssets.length} assets + cash`;
            if (hintEl) hintEl.textContent = 'Tap coin to trade';
        } else {
            // Visitor (not logged in) — project overview
            chartData = cryptoAssets.map(a => a.usd_value || 0);
            chartColors = cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666');
            chartLabels = cryptoAssets.map(a => a.code);
            centerLabel = 'Pool Total';
            centerValue = Assets.formatCurrency(totalValue);
            subtitle = `${cryptoAssets.length} assets`;
            if (hintEl) hintEl.textContent = 'Connect wallet to join';
        }

        if (labelEl) labelEl.textContent = centerLabel;

        State.portfolioChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors,
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                const label = chartLabels[context.dataIndex] || '';
                                return `${label}: ${Assets.formatCurrency(chartData[context.dataIndex])}`;
                            }
                        }
                    }
                },
                maintainAspectRatio: false
            }
        });

        const totalEl = document.getElementById('total-value');
        const countEl = document.getElementById('asset-count');
        if (totalEl) totalEl.textContent = centerValue;
        if (countEl) countEl.textContent = subtitle;

        // Update user deposited banner + low balance warning
        this._updateUserDepositBanner();

        // Fetch admin stats (non-blocking)
        if (State.userRole === 'admin') {
            this._fetchAdminStats(totalValue);
        }
    },

    _updateUserDepositBanner() {
        const bannerEl = document.getElementById('userDepositedBanner');
        const amountEl = document.getElementById('userDepositedAmount');
        const walletEl = document.getElementById('userWalletUsdc');
        const warningEl = document.getElementById('lowWalletWarning');
        if (!bannerEl) return;

        if (State.userRole === 'user') {
            const deposited = State.userDeposits || 0;
            const walletUsdc = State.walletBalances.usdc || 0;
            if (amountEl) amountEl.textContent = Assets.formatCurrency(deposited);
            if (walletEl) walletEl.textContent = Assets.formatCurrency(walletUsdc);
            bannerEl.style.display = 'block';

            // Show deposit prompt when wallet USDC drops below $20
            if (warningEl) {
                warningEl.style.display = walletUsdc < 20 ? 'block' : 'none';
            }
        } else {
            bannerEl.style.display = 'none';
        }
    },

    // ── Admin Stats Panel ──────────────────────────────────────────────────

    _adminStatsCache: null,
    _adminStatsLastFetch: 0,

    async _fetchAdminStats(poolValue) {
        const panel = document.getElementById('adminStatsPanel');
        if (!panel || State.userRole !== 'admin') return;

        // Cache for 60s to avoid hammering the API on every portfolio refresh
        if (this._adminStatsCache && Date.now() - this._adminStatsLastFetch < 60000) {
            this._renderAdminStats(this._adminStatsCache);
            return;
        }

        const wallet = typeof PhantomWallet !== 'undefined' ? PhantomWallet.walletAddress : null;
        if (!wallet || !poolValue) return;

        try {
            const res = await fetch(`/api/admin/stats?wallet=${wallet}&poolValue=${poolValue}`);
            if (!res.ok) {
                console.warn('Admin stats API error:', res.status, await res.text());
                return;
            }
            const stats = await res.json();
            this._adminStatsCache = stats;
            this._adminStatsLastFetch = Date.now();
            this._renderAdminStats(stats);
        } catch (e) {
            console.warn('Admin stats fetch failed:', e);
        }
    },

    _renderAdminStats(stats) {
        const panel = document.getElementById('adminStatsPanel');
        if (!panel) return;
        panel.style.display = '';

        const el = (id) => document.getElementById(id);

        // User count
        const userCountEl = el('statUserCount');
        if (userCountEl) userCountEl.textContent = stats.userCount ?? '--';

        // Total deposited
        const depEl = el('statTotalDeposited');
        if (depEl) depEl.textContent = '$' + this._fmtNum(stats.totalUserDeposited ?? 0);

        // User value
        const valEl = el('statUserValue');
        if (valEl) valEl.textContent = '$' + this._fmtNum(stats.totalUserValue ?? 0);

        // NAV
        const navEl = el('statNav');
        if (navEl) navEl.textContent = '$' + (stats.nav ?? 1).toFixed(4);

        // Trade count
        const tradeEl = el('statTradeCount');
        if (tradeEl) tradeEl.textContent = stats.tradeCount ?? '--';

        // P&L
        const pnlEl = el('statPnl');
        if (pnlEl) {
            const pnl = stats.pnlPercent ?? 0;
            pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%';
            pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444';
        }

        // Last deposit
        const lastDepEl = el('statLastDeposit');
        if (lastDepEl && stats.lastDeposit) {
            const d = new Date(stats.lastDeposit);
            const ago = this._timeAgo(d);
            const who = stats.lastDepositWallet ?? '';
            lastDepEl.textContent = `Last deposit: $${this._fmtNum(stats.lastDepositAmount)} ${who} · ${ago}`;
        } else if (lastDepEl) {
            lastDepEl.textContent = 'Last deposit: --';
        }

        // Last user joined
        const lastJoinEl = el('statLastJoined');
        if (lastJoinEl && stats.lastUserJoined) {
            const d = new Date(stats.lastUserJoined);
            lastJoinEl.textContent = `Last joined: ${this._timeAgo(d)}`;
        } else if (lastJoinEl) {
            lastJoinEl.textContent = 'Last joined: --';
        }

        // Pool value (from Swyftx API)
        const poolValEl = el('statPoolValue');
        if (poolValEl) poolValEl.textContent = '$' + this._fmtNum(stats.poolValue ?? 0);

        // DB diagnostic counts
        const dbCountsEl = el('statDbCounts');
        if (dbCountsEl && stats.dbCounts) {
            const c = stats.dbCounts;
            dbCountsEl.textContent = `DB: ${c.users}u ${c.deposits}d ${c.trades}t ${c.poolState ? 'pool' : 'no-pool'}`;
        }
    },

    _timeAgo(date) {
        const secs = Math.floor((Date.now() - date.getTime()) / 1000);
        if (secs < 60) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        if (days < 7) return days + 'd ago';
        return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    },

    // ── Holdings List ─────────────────────────────────────────────────────────

    // ── Holdings view toggle (user only) ────────────────────────────────────

    setHoldingsView(view) {
        this.holdingsView = view;
        const btnMine = document.getElementById('btnMyHoldings');
        const btnProject = document.getElementById('btnProjectHoldings');
        if (btnMine) btnMine.classList.toggle('active', view === 'mine');
        if (btnProject) btnProject.classList.toggle('active', view === 'project');
        this.renderHoldings();
    },

    renderHoldings() {
        const container = document.getElementById('holdings-list');
        if (!container) return;

        const allHoldings = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC'
        );

        const isAdmin = State.userRole === 'admin';
        const isUser = State.userRole === 'user';
        const showUserHoldings = isUser && this.holdingsView === 'mine';

        // Title always stays as "Holdings" — the toggle pill indicates Mine vs Pool
        const titleEl = document.querySelector('.holdings-title');
        if (titleEl) titleEl.textContent = 'Holdings';

        // For user's "Mine" view: show their proportional holdings or empty state
        if (showUserHoldings) {
            const deposited = State.userDeposits || 0;
            const hasAllocation = State.userAllocation > 0;

            if (!hasAllocation || allHoldings.length === 0) {
                // User has no crypto allocation yet
                container.innerHTML = `
                    <div style="text-align:center;padding:30px 20px;">
                        <div style="width:50px;height:50px;background:rgba(34,197,94,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                                <path d="M12 5v14M5 12h14"/>
                            </svg>
                        </div>
                        ${deposited > 0
                            ? `<div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:6px;">${Assets.formatCurrency(deposited)} USDC Deposited</div>
                               <div style="font-size:12px;color:#94a3b8;line-height:1.5;">Your deposit is in the pool.<br>Crypto holdings will appear here once the pool trades begin.</div>`
                            : `<div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:6px;">No Holdings Yet</div>
                               <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">Deposit USDC to start participating in the pool.</div>
                               <button onclick="UI.showDepositModal()" style="padding:10px 20px;background:#22c55e;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">Deposit USDC</button>`
                        }
                    </div>`;
                return;
            }

            // User has allocation — show their proportional share
            container.innerHTML = allHoldings.map(asset => {
                const style = CONFIG.ASSET_STYLES[asset.code] ?? { color: '#666', icon: asset.code[0] };
                const change = asset.change_24h || 0;
                const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
                const changeSign = change >= 0 ? '+' : '';
                const displayBalance = asset.balance * (State.userAllocation / 100);
                const displayValue = asset.usd_value * (State.userAllocation / 100);

                const borderColor = change >= 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
                return `
                <div class="card" data-code="${asset.code}" style="cursor:default;border-color:${borderColor};">
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <div class="coin-icon-wrapper" style="background:${style.color}20;color:${style.color};">
                                <span class="coin-icon-letter">${style.icon}</span>
                            </div>
                            <div>
                                <div class="font-bold text-sm">${asset.code}</div>
                                <div class="text-xs text-slate-400" data-code="${asset.code}" data-field="balance">${Assets.formatNumber(displayBalance)} ${asset.code}</div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="font-bold text-sm price-value" data-code="${asset.code}" data-field="value">${Assets.formatCurrency(displayValue)}</div>
                            <div class="text-xs text-slate-400 price-unit" data-code="${asset.code}" data-field="price">${Assets.formatCurrency(asset.usd_price)} USD</div>
                            <div class="text-xs font-semibold" style="color:${changeColor};">${changeSign}${change.toFixed(2)}%</div>
                        </div>
                    </div>
                </div>`;
            }).join('');
            return;
        }

        // Project view (for users) or default (admin/visitor)
        if (allHoldings.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#64748b;padding:40px;">No crypto holdings found</div>';
            return;
        }

        container.innerHTML = allHoldings.map(asset => {
            const style      = CONFIG.ASSET_STYLES[asset.code] ?? { color: '#666', icon: asset.code[0] };
            const change     = asset.change_24h || 0;
            const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
            const changeSign  = change >= 0 ? '+' : '';

            // Only admin can click to trade
            const clickAction = isAdmin
                ? `onclick="UI.openTrade('${asset.code}')"`
                : '';
            const cursorStyle = isAdmin ? '' : 'cursor:default;';

            const borderColor = change >= 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
            return `
            <div class="card" data-code="${asset.code}" ${clickAction} style="${cursorStyle}border-color:${borderColor};">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-3">
                        <div class="coin-icon-wrapper" style="background:${style.color}20;color:${style.color};">
                            <span class="coin-icon-letter">${style.icon}</span>
                        </div>
                        <div>
                            <div class="font-bold text-sm">${asset.code}</div>
                            <div class="text-xs text-slate-400">${Assets.formatNumber(asset.balance)} ${asset.code}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-sm price-value" data-code="${asset.code}" data-field="value">${Assets.formatCurrency(asset.usd_value)}</div>
                        <div class="text-xs text-slate-400 price-unit" data-code="${asset.code}" data-field="price">${Assets.formatCurrency(asset.usd_price)} USD</div>
                        <div class="text-xs font-semibold" style="color:${changeColor};">${changeSign}${change.toFixed(2)}%</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Update auto-trader tier badges (admin only)
        if (isAdmin && typeof AutoTrader !== 'undefined') {
            AutoTrader.renderTierBadges();
        }
    },

    // ── Animated Price Updates ──────────────────────────────────────────────

    /**
     * Called after each CoinGecko price tick.
     * Animates holdings card prices, doughnut centre, and header balances.
     * Display-only — never touches State.liveRates or trading logic.
     */
    animatePriceUpdate() {
        if (typeof PriceAnimator === 'undefined') return;

        const isUser = State.userRole === 'user';
        const allocation = State.userAllocation / 100;
        const showUserHoldings = isUser && this.holdingsView === 'mine';

        // ── Holdings card values ──
        document.querySelectorAll('.price-value[data-code]').forEach(el => {
            const code = el.dataset.code;
            const asset = State.portfolioData.assets.find(a => a.code === code);
            if (!asset) return;
            const val = showUserHoldings ? (asset.usd_value * allocation) : asset.usd_value;
            PriceAnimator.animateEl(el, val, v => Assets.formatCurrency(v));
        });

        // ── Holdings card per-unit prices ──
        document.querySelectorAll('.price-unit[data-code]').forEach(el => {
            const code = el.dataset.code;
            const asset = State.portfolioData.assets.find(a => a.code === code);
            if (!asset) return;
            PriceAnimator.animateEl(el, asset.usd_price, v => Assets.formatCurrency(v) + ' USD');
        });

        // ── Doughnut centre total ──
        const totalEl = document.getElementById('total-value');
        if (totalEl) {
            const cryptoAssets = State.portfolioData.assets.filter(
                a => a.code !== 'AUD' && a.code !== 'USDC' && a.usd_value > 10
            );
            const usdcVal = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
            const audVal = State.portfolioData.assets.find(a => a.code === 'AUD')?.usd_value ?? 0;
            const cryptoTotal = cryptoAssets.reduce((s, a) => s + (a.usd_value || 0), 0);

            let displayTotal;
            if (isUser && this.chartView === 'user') {
                displayTotal = State.userCurrentValue || State.userDeposits || 0;
            } else {
                displayTotal = cryptoTotal + usdcVal + audVal;
            }
            PriceAnimator.animateEl(totalEl, displayTotal, v => Assets.formatCurrency(v));
        }

        // ── Header cash balances (admin) ──
        const headerUsdc = document.getElementById('headerUsdcBalance');
        const headerAud = document.getElementById('headerAudBalance');
        if (headerUsdc) {
            const usdcVal = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
            PriceAnimator.animateEl(headerUsdc, usdcVal, v => Assets.formatCurrency(v));
        }
        if (headerAud) {
            const audVal = State.portfolioData.assets.find(a => a.code === 'AUD')?.usd_value ?? 0;
            PriceAnimator.animateEl(headerAud, audVal, v => Assets.formatCurrency(v));
        }

        // ── Update doughnut chart data (silent, no rebuild) ──
        if (State.portfolioChart) {
            const cryptoAssets = State.portfolioData.assets.filter(
                a => a.code !== 'AUD' && a.code !== 'USDC' && a.usd_value > 10
            );
            if (isUser && this.chartView === 'user' && allocation > 0) {
                State.portfolioChart.data.datasets[0].data = cryptoAssets.map(a => (a.usd_value || 0) * allocation);
            } else {
                State.portfolioChart.data.datasets[0].data = cryptoAssets.map(a => a.usd_value || 0);
            }
            State.portfolioChart.update('none');  // 'none' = no animation, instant
        }

        // ── AutoTrader monitoring panel prices ──
        if (typeof AutoTrader !== 'undefined' && AutoTrader.isActive) {
            document.querySelectorAll('.at-price[data-code]').forEach(el => {
                const code = el.dataset.code;
                const price = API.getRealtimePrice(code);
                if (!price) return;
                PriceAnimator.animateEl(el, price, v => '$' + v.toFixed(2));
            });

            // Update progress bars and change % in-place
            document.querySelectorAll('.at-bar[data-code]').forEach(bar => {
                const code = bar.dataset.code;
                const tgt = AutoTrader.targets[code];
                const price = API.getRealtimePrice(code);
                if (!tgt || !price) return;

                const midPrice = (tgt.buy + tgt.sell) / 2;
                const halfRange = (tgt.sell - tgt.buy) / 2;
                let progress;
                if (price <= tgt.buy) progress = 1;
                else if (price >= tgt.sell) progress = 1;
                else if (price < midPrice) progress = (midPrice - price) / halfRange;
                else progress = (price - midPrice) / halfRange;
                progress = Math.max(0, Math.min(1, progress));

                let barColor;
                if (progress < 0.5)      barColor = '#3b82f6';
                else if (progress < 0.75) barColor = '#eab308';
                else if (progress < 0.95) barColor = '#f97316';
                else                      barColor = '#ef4444';

                bar.style.width = (progress * 100).toFixed(0) + '%';
                bar.style.background = barColor;

                // Update corresponding change % text
                const changeEl = document.querySelector(`.at-change[data-code="${code}"]`);
                if (changeEl) {
                    const change = ((price - midPrice) / midPrice) * 100;
                    const sign = change >= 0 ? '+' : '';
                    changeEl.textContent = `${sign}${change.toFixed(2)}%`;
                    changeEl.style.color = barColor;
                }
            });
        }
    },

    /**
     * Initial count-up from zero on first portfolio load.
     */
    animateInitialPrices() {
        if (typeof PriceAnimator === 'undefined') return;

        // Doughnut centre
        const totalEl = document.getElementById('total-value');
        if (totalEl) {
            const val = PriceAnimator._parseDisplayed(totalEl.textContent);
            if (val > 0) PriceAnimator.animateFromZero(totalEl, val, v => Assets.formatCurrency(v));
        }

        // Header balances
        ['headerUsdcBalance', 'headerAudBalance'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const val = PriceAnimator._parseDisplayed(el.textContent);
                if (val > 0) PriceAnimator.animateFromZero(el, val, v => Assets.formatCurrency(v));
            }
        });

        // Holdings card values
        document.querySelectorAll('.price-value[data-code]').forEach(el => {
            const val = PriceAnimator._parseDisplayed(el.textContent);
            if (val > 0) PriceAnimator.animateFromZero(el, val, v => Assets.formatCurrency(v));
        });

        // Holdings card per-unit prices
        document.querySelectorAll('.price-unit[data-code]').forEach(el => {
            const val = PriceAnimator._parseDisplayed(el.textContent);
            if (val > 0) PriceAnimator.animateFromZero(el, val, v => Assets.formatCurrency(v) + ' USD');
        });
    },

    // ── Pending Orders ──────────────────────────────────────────────────────

    renderPendingOrders() {
        const container = document.getElementById('pendingOrdersList');
        const countEl   = document.getElementById('pendingOrdersCount');
        if (!container) return;

        const orders = State.pendingOrders || [];
        if (countEl) countEl.textContent = orders.length;

        if (orders.length === 0) {
            container.innerHTML = '<div class="pending-orders-empty">No pending trigger orders</div>';
            return;
        }

        const ORDER_TYPE_LABELS = {
            1: 'Market Buy',
            2: 'Market Sell',
            3: 'Limit Buy',
            4: 'Limit Sell',
            5: 'Stop Buy',
            6: 'Stop Sell'
        };

        const STATUS_LABELS = {
            1: 'Open',
            2: 'Partial',
            3: 'Cancelled',
            4: 'Filled'
        };

        // Also update user insight cards
        this.updateUserInsightCards();

        container.innerHTML = orders.map(order => {
            const side       = order.isBuy ? 'buy' : 'sell';
            const style      = CONFIG.ASSET_STYLES[order.assetCode] ?? { color: '#666', icon: order.assetCode?.[0] ?? '?' };
            const typeLabel  = ORDER_TYPE_LABELS[order.orderType] ?? 'Trigger';
            const statusLabel = STATUS_LABELS[order.status] ?? '';
            const currSymbol = order.priCode === 'AUD' ? 'A$' : '$';

            // Proximity: how full the bar is (closer = fuller)
            // Cap at 30% max distance for the visual
            const maxDist    = 30;
            const clampedDist = Math.min(order.distance, maxDist);
            const proximity  = Math.max(0, ((maxDist - clampedDist) / maxDist) * 100);

            // Classify distance for label styling
            let distClass = 'far';
            if (order.distance < 2)       distClass = 'very-close';
            else if (order.distance < 5)  distClass = 'close';

            const triggerFormatted = currSymbol + Assets.formatNumber(order.trigger);
            const currentFormatted = currSymbol + Assets.formatNumber(order.currentPrice);
            const qtyDisplay = currSymbol + Assets.formatNumber(order.quantity);

            // Dismiss button only for locally-tracked orders
            const dismissBtn = order.local
                ? `<button onclick="Trading.removeLocalPendingOrder('${order.id}')" class="pending-order-dismiss" title="Remove">&times;</button>`
                : '';

            return `
            <div class="pending-order-card ${side}">
                <div class="pending-order-top">
                    <div class="pending-order-left">
                        <div class="coin-icon-wrapper" style="width:28px;height:28px;background:${style.color}20;color:${style.color};font-size:12px;">
                            <span class="coin-icon-letter" style="font-size:12px;">${style.icon}</span>
                        </div>
                        <span class="pending-order-asset">${order.assetCode}</span>
                        <span class="pending-order-badge ${side}">${typeLabel}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div class="pending-order-right">
                            <div class="pending-order-trigger">${triggerFormatted}</div>
                            <div class="pending-order-qty">${qtyDisplay} ${order.priCode}</div>
                        </div>
                        ${dismissBtn}
                    </div>
                </div>
                <div class="pending-order-proximity">
                    <div class="proximity-bar-track">
                        <div class="proximity-bar-fill ${side}" style="width:${proximity}%;"></div>
                    </div>
                    <span class="proximity-label ${distClass}">${order.distance.toFixed(1)}% away</span>
                </div>
                <div class="pending-order-current">
                    <span>Now: ${currentFormatted}</span>
                    <span>Trigger: ${triggerFormatted}</span>
                </div>
            </div>`;
        }).join('');
    },

    // ── Coin Selector Modal (TradingView-style) ────────────────────────────

    openCoinSelector() {
        const overlay = document.getElementById('coinSelectorOverlay');
        const list    = document.getElementById('coinSelectorList');
        const input   = document.getElementById('coinSearchInput');
        if (!overlay || !list) return;

        // Build list from portfolio assets (exclude AUD & USDC)
        const assets = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC'
        );
        const currentCode = State.selectedAsset?.code || '';

        list.innerHTML = assets.map(asset => {
            const style = CONFIG.ASSET_STYLES[asset.code] ?? { color: '#666', icon: asset.code[0], name: asset.code };
            const change = asset.change_24h || 0;
            const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
            const changeSign  = change >= 0 ? '+' : '';
            const isActive = asset.code === currentCode ? ' active' : '';
            return `<div class="coin-selector-item${isActive}" data-code="${asset.code}" onclick="UI.selectCoin('${asset.code}')">
                <div class="coin-selector-icon" style="background:${style.color}20;color:${style.color};">${style.icon}</div>
                <div class="coin-selector-info">
                    <div class="coin-selector-code">${asset.code}</div>
                    <div class="coin-selector-name">${style.name}</div>
                </div>
                <div class="coin-selector-right">
                    <div class="coin-selector-price">${Assets.formatCurrency(asset.usd_price)}</div>
                    <div class="coin-selector-change" style="color:${changeColor};">${changeSign}${change.toFixed(2)}%</div>
                </div>
            </div>`;
        }).join('');

        if (input) input.value = '';
        overlay.classList.add('show');
        setTimeout(() => input?.focus(), 200);
    },

    closeCoinSelector() {
        document.getElementById('coinSelectorOverlay')?.classList.remove('show');
    },

    filterCoinSelector(query) {
        const q = query.toLowerCase();
        document.querySelectorAll('.coin-selector-item').forEach(item => {
            const code = item.dataset.code.toLowerCase();
            const name = (CONFIG.ASSET_STYLES[item.dataset.code]?.name || '').toLowerCase();
            item.style.display = (code.includes(q) || name.includes(q)) ? '' : 'none';
        });
    },

    selectCoin(code) {
        this.closeCoinSelector();
        // Switch the trading panel to the selected coin without closing/reopening
        State.selectedAsset = State.portfolioData.assets.find(a => a.code === code);
        if (!State.selectedAsset) return;
        const style  = CONFIG.ASSET_STYLES[code];
        const iconEl = document.getElementById('tradeIcon');
        const nameEl = document.getElementById('tradeName');
        if (iconEl) {
            iconEl.textContent      = style.icon;
            iconEl.style.background = style.color + '33';
            iconEl.style.color      = style.color;
        }
        if (nameEl) nameEl.textContent = code;
        // Reset sliders and state
        State.amountSliderValue = 0;
        State.triggerOffset     = 0;
        const amountSlider  = document.getElementById('amountSlider');
        const triggerSlider  = document.getElementById('triggerSlider');
        if (amountSlider)  amountSlider.value  = 0;
        if (triggerSlider) triggerSlider.value = 0;
        this.setInstantSide('buy');
        Trading.updateTriggerButtonBalances();
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        // Update selected card highlight in holdings
        document.querySelectorAll('.card').forEach(c => {
            c.classList.toggle('selected', c.dataset.code === code);
        });
    },

    // ── Trading Panel (Admin Only) ───────────────────────────────────────────

    openTrade(code) {
        // Only admin can trade
        if (State.userRole !== 'admin') return;

        // Scroll to top when opening trade view
        window.scrollTo({ top: 0, behavior: 'smooth' });

        State.selectedAsset = State.portfolioData.assets.find(a => a.code === code);
        if (!State.selectedAsset) return;
        const style  = CONFIG.ASSET_STYLES[code];
        const iconEl = document.getElementById('tradeIcon');
        const nameEl = document.getElementById('tradeName');
        if (iconEl) {
            iconEl.textContent      = style.icon;
            iconEl.style.background = style.color + '33';
            iconEl.style.color      = style.color;
        }
        if (nameEl) nameEl.textContent = code;
        // Reset all state and sliders
        State.amountSliderValue  = 0;
        State.triggerOffset      = 0;
        State.isMiniChartVisible = false;
        State.pendingTradeSide   = 'buy';
        State.autoTradeConfig    = { deviation: 0, allocation: 0 };
        const amountSlider = document.getElementById('amountSlider');
        const triggerSlider = document.getElementById('triggerSlider');
        if (amountSlider)   amountSlider.value   = 0;
        if (triggerSlider)  triggerSlider.value  = 0;
        document.getElementById('miniChartContainer')?.classList.remove('show');
        document.getElementById('chartToggleBtn')?.classList.remove('active');
        // Reset instant toggle to Buy
        this.setInstantSide('buy');
        Trading.updateTriggerButtonBalances();
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();

        document.getElementById('chartSection')?.classList.add('trading-open');
        document.getElementById('chartSlider')?.classList.add('slide-left');
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        if (event?.currentTarget) event.currentTarget.classList.add('selected');
    },

    closeTradingView() {
        document.getElementById('chartSection')?.classList.remove('trading-open');
        document.getElementById('chartSlider')?.classList.remove('slide-left');
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));

        State.isMiniChartVisible = false;
        document.getElementById('miniChartContainer')?.classList.remove('show');
        document.getElementById('chartToggleBtn')?.classList.remove('active');
    },

    /** Quick-nav: open trading view with the top asset and switch to the given order type */
    quickNav(type) {
        if (State.userRole !== 'admin') return;
        const assets = (State.portfolioData?.assets || []).filter(
            a => a.code !== 'AUD' && a.code !== 'USDC'
        );
        if (!assets.length) return;
        // Pick the top asset (first in list)
        this.openTrade(assets[0].code);
        this.setOrderType(type);
    },

    // ── Mini Chart ────────────────────────────────────────────────────────────

    toggleMiniChart() {
        State.isMiniChartVisible = !State.isMiniChartVisible;
        const container = document.getElementById('miniChartContainer');
        const btn       = document.getElementById('chartToggleBtn');

        if (State.isMiniChartVisible) {
            container?.classList.add('show');
            btn?.classList.add('active');
            if (State.selectedAsset) {
                this.renderMiniChart(CONFIG.ASSET_STYLES[State.selectedAsset.code].color);
            }
        } else {
            container?.classList.remove('show');
            btn?.classList.remove('active');
        }
    },

    renderMiniChart(color) {
        const ctx = document.getElementById('miniChart');
        if (!ctx) return;

        State.miniChart?.destroy();

        const change     = State.selectedAsset.change_24h || 0;
        const volatility = Math.abs(change) / 20 || 0.01;
        let price = State.selectedAsset.usd_price * (1 - change / 100);

        const data = Array.from({ length: 20 }, () => {
            price = price * (1 + (Math.random() - 0.5) * volatility);
            return price;
        });
        data[data.length - 1] = State.selectedAsset.usd_price;

        const context  = ctx.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 0, 70);
        gradient.addColorStop(0, color + '50');
        gradient.addColorStop(1, color + '00');

        State.miniChart = new Chart(context, {
            type: 'line',
            data: {
                labels: data.map((_, i) => i),
                datasets: [{
                    data,
                    borderColor: color,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: false }, y: { display: false } }
            }
        });
    },

    // ── Order Type Selector ───────────────────────────────────────────────────

    setOrderType(type) {
        State.orderType = type;

        document.getElementById('btnInstant')?.classList.toggle('active', type === 'instant');
        document.getElementById('btnTrigger')?.classList.toggle('active', type === 'trigger');
        document.getElementById('btnAuto')?.classList.toggle('active',   type === 'auto');

        const amountSection  = document.getElementById('amountSection');
        const triggerSection = document.getElementById('triggerSection');
        const autoSection    = document.getElementById('autoSection');
        const pendingSection = document.getElementById('pendingOrdersSection');

        if (type === 'instant') {
            if (amountSection)  amountSection.style.display = '';
            if (triggerSection) triggerSection.style.display = 'none';
            if (pendingSection) pendingSection.style.display = 'none';
            if (autoSection)    autoSection.style.display = 'none';
        } else if (type === 'trigger') {
            if (amountSection)  amountSection.style.display = 'none';
            if (triggerSection) triggerSection.style.display = 'block';
            if (pendingSection) pendingSection.style.display = '';
            if (autoSection)    autoSection.style.display = 'none';
            Trading.resetTrigger();
        } else if (type === 'auto') {
            if (amountSection)  amountSection.style.display = 'none';
            if (triggerSection) triggerSection.style.display = 'none';
            if (pendingSection) pendingSection.style.display = 'none';
            if (autoSection)    autoSection.style.display = 'block';
        }

        State.triggerOffset = 0;
        State.autoTradeConfig.deviation = 0;

        const triggerSlider = document.getElementById('triggerSlider');
        const autoDevSlider = document.getElementById('autoDevSlider');
        if (triggerSlider) triggerSlider.value = 0;
        if (autoDevSlider) autoDevSlider.value = 0;

        document.getElementById('triggerError')?.removeAttribute('style');
        document.getElementById('autoError')?.removeAttribute('style');

        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        this.updateAmountDisplay();
    },

    // ── Instant Buy/Sell Toggle ──────────────────────────────────────────────

    setInstantSide(side) {
        State.pendingTradeSide = side;

        const buyBtn  = document.getElementById('instantBuyBtn');
        const sellBtn = document.getElementById('instantSellBtn');
        buyBtn?.classList.toggle('active', side === 'buy');
        sellBtn?.classList.toggle('active', side === 'sell');

        // Update slider fill colour
        const fill = document.getElementById('amountFill');
        if (fill) fill.style.background = side === 'buy' ? '#22c55e' : '#ef4444';

        // Update confirm button
        const confirmBtn  = document.getElementById('instantConfirmBtn');
        const confirmText = document.getElementById('instantConfirmText');
        if (confirmBtn) {
            confirmBtn.className = `instant-confirm-btn ${side}`;
        }
        if (confirmText) {
            confirmText.textContent = side === 'buy' ? 'Confirm Buy' : 'Confirm Sell';
        }

        // Reset slider when switching
        State.amountSliderValue = 0;
        const slider = document.getElementById('amountSlider');
        if (slider) slider.value = 0;
        const amountFill = document.getElementById('amountFill');
        if (amountFill) amountFill.style.width = '0%';
        const amountPercent = document.getElementById('amountPercent');
        if (amountPercent) amountPercent.textContent = '0%';

        this.updateInstantBalance();
        this.updateAmountDisplay();
    },

    updateInstantBalance() {
        const infoEl = document.getElementById('instantAvailable');
        if (!infoEl) return;

        const side = State.pendingTradeSide || 'buy';
        if (side === 'buy') {
            const usdcBal = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
            infoEl.textContent = `${Assets.formatCurrency(usdcBal)} USDC`;
        } else {
            const bal  = State.selectedAsset?.balance ?? 0;
            const code = State.selectedAsset?.code ?? '';
            infoEl.textContent = `${Assets.formatNumber(bal)} ${code}`;
        }
    },

    // ── Amount Display ────────────────────────────────────────────────────────

    updateAmountSlider(value) {
        State.amountSliderValue = parseInt(value);
        const amountFill    = document.getElementById('amountFill');
        const amountPercent = document.getElementById('amountPercent');
        if (amountFill)    amountFill.style.width      = State.amountSliderValue + '%';
        if (amountPercent) amountPercent.textContent   = State.amountSliderValue + '%';
        this.updateAmountDisplay();
    },

    updateAmountDisplay() {
        const cashBalance  = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.usd_value ?? 0;
        const assetBalance = State.selectedAsset?.balance   ?? 0;
        const currentPrice = State.selectedAsset?.usd_price ?? 0;
        const side         = State.pendingTradeSide || 'buy';

        let displayAmount, conversionText;

        if (side === 'sell') {
            const sellQty  = (State.amountSliderValue / 100) * assetBalance;
            displayAmount  = sellQty * currentPrice;
            conversionText = `${Assets.formatNumber(sellQty)} ${State.selectedAsset?.code ?? ''} → USDC`;
        } else {
            const cashAmount  = (State.amountSliderValue / 100) * cashBalance;
            displayAmount     = cashAmount;
            const receiveAmt  = currentPrice > 0 ? cashAmount / currentPrice : 0;
            conversionText    = `USDC → ${receiveAmt.toFixed(8)} ${State.selectedAsset?.code ?? ''}`;
        }

        const amountValueEl    = document.getElementById('amountValue');
        const conversionTextEl = document.getElementById('conversionText');
        if (amountValueEl)    amountValueEl.textContent    = Assets.formatCurrency(displayAmount);
        if (conversionTextEl) conversionTextEl.textContent = conversionText;
    },

    // ── Sort Modal ────────────────────────────────────────────────────────────

    toggleSort() {
        document.getElementById('sortModal')?.classList.add('show');
        document.getElementById('modalOverlay')?.classList.add('show');
    },

    closeSort() {
        document.getElementById('sortModal')?.classList.remove('show');
        document.getElementById('modalOverlay')?.classList.remove('show');
    },

    selectSort(type) {
        Assets.sort(type);
        this.renderHoldings();
        this.closeSort();
    },

    // ── Phantom Wallet Status ────────────────────────────────────────────────

    updateWalletStatus(status, address) {
        const btn     = document.getElementById('phantomBtn');
        const btnText = document.getElementById('phantomBtnText');
        if (!btn || !btnText) return;

        if (status === 'connected' && address) {
            const short = `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
            btn.classList.add('phantom-connected');
            btnText.textContent = short;
        } else {
            btn.classList.remove('phantom-connected');
            btnText.textContent = 'Connect';
        }
    },

    // ── Deposit Modal ────────────────────────────────────────────────────────

    showDepositModal() {
        // Close wallet panel first
        document.getElementById('walletPanel')?.classList.remove('show');
        // Show available USDC balance
        const availEl = document.getElementById('depositAvailableUsdc');
        if (availEl) availEl.textContent = (State.walletBalances.usdc || 0).toFixed(2);
        // Reset loading state
        const loadingEl = document.getElementById('depositLoading');
        const buttonsEl = document.getElementById('depositButtons');
        if (loadingEl) loadingEl.style.display = 'none';
        if (buttonsEl) buttonsEl.style.display = '';
        document.getElementById('depositModal')?.classList.add('show');
    },

    closeDepositModal() {
        document.getElementById('depositModal')?.classList.remove('show');
        document.getElementById('depositAmount').value = '';
        // Reset loading state
        const loadingEl = document.getElementById('depositLoading');
        const buttonsEl = document.getElementById('depositButtons');
        if (loadingEl) loadingEl.style.display = 'none';
        if (buttonsEl) buttonsEl.style.display = '';
    },

    async submitDeposit() {
        const amountInput = document.getElementById('depositAmount');
        const amount = parseFloat(amountInput?.value);

        if (!amount || amount < 1) {
            alert('Please enter a valid amount (minimum $1 USDC)');
            return;
        }

        if (!PhantomWallet.walletAddress) {
            alert('Please connect your wallet first');
            return;
        }

        // Check available USDC balance
        if (amount > (State.walletBalances.usdc || 0)) {
            alert(`Insufficient USDC balance. You have ${(State.walletBalances.usdc || 0).toFixed(2)} USDC`);
            return;
        }

        // Show loading spinner, hide buttons
        const loadingEl = document.getElementById('depositLoading');
        const buttonsEl = document.getElementById('depositButtons');
        if (loadingEl) loadingEl.style.display = 'block';
        if (buttonsEl) buttonsEl.style.display = 'none';

        try {
            // Send USDC on-chain via Phantom to the deposit address
            const txSignature = await PhantomWallet.sendUsdcDeposit(amount);

            // Record deposit and issue shares (API → MongoDB)
            await this._recordDeposit(PhantomWallet.walletAddress, amount, txSignature);

            this.closeDepositModal();
            Logger.log(`Deposit of ${amount} USDC sent! TX: ${txSignature.substring(0, 16)}...`, 'success');
            alert(`Deposit successful!\n\n${amount} USDC sent to Flub pool.\nTX: ${txSignature.substring(0, 24)}...`);

            // Refresh balances after deposit
            await PhantomWallet.fetchOnChainBalances();
            // Re-render to reflect new deposit
            this.renderPortfolio();

        } catch (error) {
            // Restore buttons on error
            if (loadingEl) loadingEl.style.display = 'none';
            if (buttonsEl) buttonsEl.style.display = '';

            Logger.log(`Deposit error: ${error.message}`, 'error');
            if (error.message.includes('User rejected')) {
                alert('Transaction cancelled by user');
            } else {
                alert('Deposit failed: ' + error.message);
            }
        }
    },

    // ── User allocation calculation ──────────────────────────────────────────

    calculateUserAllocation() {
        // Only calculate for users who have deposited
        if (State.userRole !== 'user' || !State.userDeposits) {
            State.userAllocation = 0;
            State.userShares = 0;
            State.userCurrentValue = 0;
            return;
        }

        const totalPoolValue = State.portfolioData.assets.reduce(
            (sum, a) => sum + (a.usd_value || 0), 0
        );

        if (totalPoolValue <= 0) {
            State.userAllocation = 0;
            State.userShares = 0;
            State.userCurrentValue = 0;
            return;
        }

        // Initialize pool shares if needed
        ShareLedger.initializePool(totalPoolValue);

        // Get wallet and migrate legacy deposits if needed
        const wallet = typeof PhantomWallet !== 'undefined' ? PhantomWallet.walletAddress : null;
        if (wallet) {
            ShareLedger.migrateIfNeeded(wallet, State.userDeposits, totalPoolValue);
        }

        // Share-based allocation: user value = userShares × NAV
        const position = ShareLedger.getUserPosition(wallet, totalPoolValue);
        State.userShares = position.shares;
        State.userAllocation = position.allocation;
        State.userCurrentValue = position.currentValue;

        Logger.log(
            `User allocation: ${State.userAllocation.toFixed(2)}% ` +
            `(${State.userShares.toFixed(2)} shares, NAV $${position.nav.toFixed(4)}, ` +
            `value $${State.userCurrentValue.toFixed(2)})`, 'info'
        );
    },

    // ── Deposit tracking (localStorage until backend) ────────────────────────

    async _recordDeposit(wallet, amount, txHash) {
        // Get current pool value for NAV calculation
        const totalPoolValue = State.portfolioData.assets.reduce(
            (sum, a) => sum + (a.usd_value || 0), 0
        );

        // Issue shares via ShareLedger (API → MongoDB, falls back to localStorage)
        const { shares, nav } = await ShareLedger.recordDeposit(wallet, amount, txHash, totalPoolValue);

        // Also record in localStorage for offline access / audit trail
        const key = `flub_deposits_${wallet}`;
        const deposits = JSON.parse(localStorage.getItem(key) || '[]');
        deposits.push({ amount, shares, nav, txHash, timestamp: Date.now() });
        localStorage.setItem(key, JSON.stringify(deposits));

        // Update state
        const total = deposits.reduce((sum, d) => sum + d.amount, 0);
        State.userDeposits = total;

        // Recalculate allocation from shares
        this.calculateUserAllocation();

        Logger.log(`Deposited $${amount.toFixed(2)} USDC → ${shares.toFixed(4)} shares @ NAV $${nav.toFixed(4)}`, 'success');
    },

    // ── User Insight Cards (read-only views) ───────────────────────────────

    updateUserInsightCards() {
        if (State.userRole !== 'user') return;

        // Pending orders count
        const count = (State.pendingOrders || []).length;
        const countEl = document.getElementById('userPendingCount');
        if (countEl) countEl.textContent = count === 0 ? 'None' : `${count} order${count !== 1 ? 's' : ''}`;

        // Auto trader status — fetch from server since state is in admin's memory
        this._fetchUserBotStatus();
    },

    async _fetchUserBotStatus() {
        const statusEl = document.getElementById('userBotStatus');
        if (!statusEl) return;

        try {
            const adminWallet = CONFIG.ADMIN_WALLETS[0];
            if (!adminWallet) return;

            const res = await fetch(`/api/state?admin_wallet=${encodeURIComponent(adminWallet)}`);
            if (!res.ok) return;

            const data = await res.json();
            if (data.error) return;

            const isActive = data.autoActive?.isActive || false;
            const targets = data.autoActive?.targets || data.autoActive?.basePrices || {};
            const cooldowns = data.autoCooldowns || {};
            const now = Date.now();

            if (isActive) {
                statusEl.textContent = 'Active';
                statusEl.style.color = '#22c55e';
            } else {
                statusEl.textContent = 'Inactive';
                statusEl.style.color = '#64748b';
            }
        } catch (err) {
            // Fallback to local state
            if (typeof AutoTrader !== 'undefined' && AutoTrader.isActive) {
                statusEl.textContent = 'Active';
                statusEl.style.color = '#22c55e';
            } else {
                statusEl.textContent = 'Inactive';
                statusEl.style.color = '#64748b';
            }
        }
    },

    showUserPendingOrders() {
        const modal = document.getElementById('userPendingModal');
        const list = document.getElementById('userPendingList');
        if (!modal || !list) return;

        const orders = State.pendingOrders || [];

        if (orders.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#64748b;font-size:12px;padding:30px;">No pending orders right now.</div>';
        } else {
            const ORDER_TYPE_LABELS = { 1:'Market Buy', 2:'Market Sell', 3:'Limit Buy', 4:'Limit Sell', 5:'Stop Buy', 6:'Stop Sell' };

            list.innerHTML = orders.map(order => {
                const side = order.isBuy ? 'buy' : 'sell';
                const style = CONFIG.ASSET_STYLES[order.assetCode] ?? { color:'#666', icon: order.assetCode?.[0] ?? '?' };
                const typeLabel = ORDER_TYPE_LABELS[order.orderType] ?? 'Trigger';
                const currSymbol = order.priCode === 'AUD' ? 'A$' : '$';
                const maxDist = 30;
                const clampedDist = Math.min(order.distance, maxDist);
                const proximity = Math.max(0, ((maxDist - clampedDist) / maxDist) * 100);

                let distClass = 'far';
                if (order.distance < 2) distClass = 'very-close';
                else if (order.distance < 5) distClass = 'close';

                const triggerFormatted = currSymbol + Assets.formatNumber(order.trigger);
                const currentFormatted = currSymbol + Assets.formatNumber(order.currentPrice);
                const qtyDisplay = currSymbol + Assets.formatNumber(order.quantity);

                return `
                <div class="pending-order-card ${side}">
                    <div class="pending-order-top">
                        <div class="pending-order-left">
                            <div class="coin-icon-wrapper" style="width:28px;height:28px;background:${style.color}20;color:${style.color};font-size:12px;">
                                <span class="coin-icon-letter" style="font-size:12px;">${style.icon}</span>
                            </div>
                            <span class="pending-order-asset">${order.assetCode}</span>
                            <span class="pending-order-badge ${side}">${typeLabel}</span>
                        </div>
                        <div class="pending-order-right">
                            <div class="pending-order-trigger">${triggerFormatted}</div>
                            <div class="pending-order-qty">${qtyDisplay} ${order.priCode}</div>
                        </div>
                    </div>
                    <div class="pending-order-proximity">
                        <div class="proximity-bar-track">
                            <div class="proximity-bar-fill ${side}" style="width:${proximity}%;"></div>
                        </div>
                        <span class="proximity-label ${distClass}">${order.distance.toFixed(1)}% away</span>
                    </div>
                    <div class="pending-order-current">
                        <span>Now: ${currentFormatted}</span>
                        <span>Trigger: ${triggerFormatted}</span>
                    </div>
                </div>`;
            }).join('');
        }

        modal.classList.add('show');
    },

    showUserAutoTrader() {
        const modal = document.getElementById('userAutoTraderModal');
        if (!modal) return;

        // Fetch state from server then render
        this._fetchAndRenderUserAutoTrader();

        // Fetch fresh state from server every 10 seconds
        this._userAutoTraderInterval = setInterval(() => this._fetchAndRenderUserAutoTrader(), 10000);

        // 1-second countdown ticker (matches admin monitoring)
        this._userCountdownInterval = setInterval(() => this._updateUserCountdown(), 1000);

        modal.classList.add('show');
    },

    closeUserAutoTrader() {
        const modal = document.getElementById('userAutoTraderModal');
        if (modal) modal.classList.remove('show');
        if (this._userAutoTraderInterval) {
            clearInterval(this._userAutoTraderInterval);
            this._userAutoTraderInterval = null;
        }
        if (this._userCountdownInterval) {
            clearInterval(this._userCountdownInterval);
            this._userCountdownInterval = null;
        }
    },

    _updateUserCountdown() {
        const el = document.getElementById('userPriceCountdown');
        if (!el || !State.lastPriceTick) return;
        const elapsed = Math.floor((Date.now() - State.lastPriceTick) / 1000);
        const remaining = Math.max(0, (API.PRICE_TICK_INTERVAL || 60) - elapsed);
        el.textContent = `${remaining}s`;
    },

    async _fetchAndRenderUserAutoTrader() {
        // Fetch auto-trader state from server (users don't have local state)
        try {
            const adminWallet = CONFIG.ADMIN_WALLETS[0];
            if (!adminWallet) throw new Error('No admin wallet configured');

            const res = await fetch(`/api/state?admin_wallet=${encodeURIComponent(adminWallet)}`);
            if (res.ok) {
                const data = await res.json();
                if (!data.error) {
                    // Apply active state (new per-tier format)
                    if (data.autoActive) {
                        if (data.autoActive.tierActive) {
                            AutoTrader.tierActive = {
                                1: !!data.autoActive.tierActive[1],
                                2: !!data.autoActive.tierActive[2],
                                3: !!data.autoActive.tierActive[3]
                            };
                        } else {
                            AutoTrader.isActive = data.autoActive.isActive || false;
                        }
                        AutoTrader.targets = data.autoActive.targets || data.autoActive.basePrices || {};
                    } else {
                        AutoTrader.isActive = false;
                    }

                    // Apply tier settings
                    if (data.autoTiers) {
                        if (data.autoTiers.tier1) AutoTrader.tier1 = data.autoTiers.tier1;
                        if (data.autoTiers.tier2) AutoTrader.tier2 = data.autoTiers.tier2;
                        if (data.autoTiers.tier3) AutoTrader.tier3 = data.autoTiers.tier3;
                    }

                    // Apply tier assignments
                    if (data.autoTierAssignments && typeof data.autoTierAssignments === 'object') {
                        AutoTrader.tierAssignments = data.autoTierAssignments;
                    }

                    // Apply cooldowns (remove expired)
                    if (data.autoCooldowns && typeof data.autoCooldowns === 'object') {
                        const now = Date.now();
                        AutoTrader.cooldowns = {};
                        for (const [coin, ts] of Object.entries(data.autoCooldowns)) {
                            if (ts > now) AutoTrader.cooldowns[coin] = ts;
                        }
                    }

                    // Apply trade log
                    if (Array.isArray(data.autoTradeLog)) {
                        AutoTrader.tradeLog = data.autoTradeLog;
                    }
                }
            }
        } catch (err) {
            console.warn('Failed to fetch auto-trader state:', err.message);
        }

        // Now render with the synced state
        this._renderUserAutoTrader();
    },

    _renderUserAutoTrader() {
        const badge = document.getElementById('userBotBadge');
        const settingsEl = document.getElementById('userBotSettings');
        const monitorEl = document.getElementById('userBotMonitor');
        const logEl = document.getElementById('userBotTradeLog');

        const isActive = typeof AutoTrader !== 'undefined' && AutoTrader.isActive;

        // Badge
        if (badge) {
            if (isActive) {
                badge.style.display = 'inline-block';
                badge.textContent = 'ACTIVE';
                badge.style.background = 'rgba(34,197,94,0.2)';
                badge.style.color = '#22c55e';
            } else {
                badge.style.display = 'inline-block';
                badge.textContent = 'INACTIVE';
                badge.style.background = 'rgba(100,116,139,0.2)';
                badge.style.color = '#64748b';
            }
        }

        // Settings summary (3 tiers)
        if (settingsEl && typeof AutoTrader !== 'undefined') {
            let tierHtml = '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;">';
            for (let t = 1; t <= 3; t++) {
                const cfg = AutoTrader.TIER_CONFIG[t];
                const settings = AutoTrader['tier' + t];
                const coins = AutoTrader._getCoinsForTier(t);
                const active = AutoTrader.tierActive[t];
                const statusBadge = active
                    ? `<span style="font-size:7px;font-weight:700;padding:1px 4px;border-radius:4px;background:${cfg.color}20;color:${cfg.color};">ON</span>`
                    : '';
                tierHtml += `<div style="min-width:120px;flex:0 0 auto;padding:8px;border-radius:8px;background:${cfg.color}0a;border:1px solid ${cfg.color}25;">`;
                tierHtml += `<div style="display:flex;align-items:center;gap:4px;font-size:9px;font-weight:700;color:${cfg.color};margin-bottom:4px;">T${t} – ${cfg.name} ${statusBadge}</div>`;
                tierHtml += `<div style="font-size:9px;color:#94a3b8;">Dev: <span style="color:#e2e8f0;font-weight:600;">${settings.deviation}%</span></div>`;
                tierHtml += `<div style="font-size:9px;color:#94a3b8;">Alloc: <span style="color:#e2e8f0;font-weight:600;">${settings.allocation}%</span></div>`;
                tierHtml += `<div style="font-size:8px;color:#64748b;margin-top:3px;">${coins.length > 0 ? coins.join(', ') : 'No coins'}</div>`;
                tierHtml += `</div>`;
            }
            tierHtml += '</div>';
            tierHtml += `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">`;
            tierHtml += `<span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Cooldown: ${AutoTrader.COOLDOWN_HOURS}h</span>`;
            tierHtml += `<span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Reserve: $${AutoTrader.MIN_USDC_RESERVE}</span>`;
            tierHtml += `<span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Prices: 30s</span>`;
            tierHtml += `</div>`;
            settingsEl.innerHTML = tierHtml;
        }

        // Monitoring status
        if (monitorEl && typeof AutoTrader !== 'undefined') {
            if (!isActive) {
                monitorEl.innerHTML = '<div style="text-align:center;color:#64748b;font-size:11px;padding:12px;background:rgba(0,0,0,0.15);border-radius:8px;">Bot is not currently running.</div>';
            } else {
                const coins = Object.keys(AutoTrader.targets);
                const activeCoins = coins.filter(c => !AutoTrader._isOnCooldown(c));
                const cdCoins = coins.filter(c => AutoTrader._isOnCooldown(c));

                let html = '<div style="display:flex;flex-direction:column;gap:4px;">';
                html += `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;color:#e2e8f0;margin-bottom:4px;">`;
                html += `<span>Monitoring ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
                if (cdCoins.length > 0) html += ` <span style="color:#94a3b8;font-weight:400;">(${cdCoins.length} on cooldown)</span>`;
                html += `</span>`;
                html += `<span id="userPriceCountdown" style="font-size:9px;font-weight:600;color:#94a3b8;"></span>`;
                html += `</div>`;

                for (const code of activeCoins) {
                    const currentPrice = typeof API !== 'undefined' ? API.getRealtimePrice(code) : 0;
                    const tgt = AutoTrader.targets[code];
                    if (!tgt || !currentPrice) continue;

                    const tier = AutoTrader.getTier(code);
                    const midPrice = (tgt.buy + tgt.sell) / 2;
                    const halfRange = (tgt.sell - tgt.buy) / 2;
                    let progress;
                    if (currentPrice <= tgt.buy || currentPrice >= tgt.sell) {
                        progress = 1;
                    } else if (currentPrice < midPrice) {
                        progress = (midPrice - currentPrice) / halfRange;
                    } else {
                        progress = (currentPrice - midPrice) / halfRange;
                    }
                    progress = Math.max(0, Math.min(1, progress));
                    const change = ((currentPrice - midPrice) / midPrice) * 100;

                    let barColor;
                    if (progress < 0.5) barColor = '#3b82f6';
                    else if (progress < 0.75) barColor = '#eab308';
                    else if (progress < 0.95) barColor = '#f97316';
                    else barColor = '#ef4444';

                    const sign = change >= 0 ? '+' : '';
                    const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };

                    html += `<div style="padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">`;
                    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">`;
                    html += `<span style="font-size:11px;font-weight:700;color:${style.color};min-width:42px;">${code}</span>`;
                    html += `<span style="font-size:10px;color:#64748b;">T${tier}</span>`;
                    html += `<div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">`;
                    html += `<div style="width:${(progress * 100).toFixed(0)}%;height:100%;background:${barColor};border-radius:2px;"></div></div>`;
                    html += `<span style="font-size:11px;font-weight:600;color:${barColor};min-width:50px;text-align:right;">${sign}${change.toFixed(2)}%</span>`;
                    html += `</div>`;
                    html += `<div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;">`;
                    html += `<span>Buy &lt; $${tgt.buy.toFixed(2)}</span>`;
                    html += `<span style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
                    html += `<span>Sell &gt; $${tgt.sell.toFixed(2)}</span></div></div>`;
                }

                if (cdCoins.length > 0) {
                    for (const code of cdCoins) {
                        const tgt = AutoTrader.targets[code];
                        const currentPrice = typeof API !== 'undefined' ? API.getRealtimePrice(code) : 0;
                        const style = CONFIG.ASSET_STYLES[code] || { color: '#666' };
                        const remaining = AutoTrader._getCooldownRemaining(code);
                        html += `<div style="padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);opacity:0.5;">`;
                        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">`;
                        html += `<span style="font-size:11px;font-weight:700;color:${style.color};min-width:42px;">${code}</span>`;
                        html += `<span style="font-size:10px;color:#64748b;">cooldown ${remaining}</span></div>`;
                        if (tgt && currentPrice) {
                            html += `<div style="display:flex;justify-content:space-between;font-size:9px;color:#64748b;">`;
                            html += `<span>Buy &lt; $${tgt.buy.toFixed(2)}</span>`;
                            html += `<span style="color:#94a3b8;">$${currentPrice.toFixed(2)}</span>`;
                            html += `<span>Sell &gt; $${tgt.sell.toFixed(2)}</span></div>`;
                        }
                        html += `</div>`;
                    }
                }
                html += '</div>';
                monitorEl.innerHTML = html;
            }
        }

        // Trade log
        if (logEl && typeof AutoTrader !== 'undefined') {
            const log = AutoTrader.tradeLog || [];
            if (log.length === 0) {
                logEl.innerHTML = '<div style="font-size:10px;color:#64748b;text-align:center;padding:12px;">No auto-trades yet.</div>';
            } else {
                let html = '';
                for (const entry of log.slice(0, 20)) {
                    const time = new Date(entry.time);
                    const timeStr = time.toLocaleDateString('en-AU', { day:'2-digit', month:'short' }) + ' ' +
                                    time.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', hour12:false });
                    const isBuy = entry.side === 'BUY';
                    const sideColor = isBuy ? '#22c55e' : '#ef4444';
                    const sideIcon = isBuy ? '&#9650;' : '&#9660;';
                    const style = CONFIG.ASSET_STYLES[entry.coin] || { color:'#666' };

                    html += `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:10px;">`;
                    html += `<span style="color:${sideColor};font-weight:700;font-size:11px;">${sideIcon}</span>`;
                    html += `<span style="color:${style.color};font-weight:600;min-width:36px;">${entry.coin}</span>`;
                    html += `<span style="color:${sideColor};font-weight:600;">${entry.side}</span>`;
                    html += `<span style="color:#94a3b8;flex:1;">${entry.quantity} @ $${entry.price.toFixed(2)}</span>`;
                    html += `<span style="color:#c4b5fd;font-weight:600;">$${entry.amount.toFixed(2)}</span>`;
                    html += `<span style="color:#64748b;font-size:9px;min-width:75px;text-align:right;">${timeStr}</span>`;
                    html += `</div>`;
                }
                logEl.innerHTML = html;
            }
        }
    },

    loadDeposits(wallet) {
        const key = `flub_deposits_${wallet}`;
        const deposits = JSON.parse(localStorage.getItem(key) || '[]');
        const total = deposits.reduce((sum, d) => sum + d.amount, 0);
        State.userDeposits = total;

        // Update wallet panel
        const depositedEl = document.getElementById('walletPanelDeposited');
        if (depositedEl) depositedEl.textContent = Assets.formatCurrency(total);

        // Calculate allocation from shares (sync — uses cache/localStorage)
        this.calculateUserAllocation();

        // Fetch fresh position from API in background
        const totalPoolValue = State.portfolioData.assets.reduce(
            (sum, a) => sum + (a.usd_value || 0), 0
        );
        if (totalPoolValue > 0) {
            ShareLedger.fetchUserPosition(wallet, totalPoolValue).then(position => {
                State.userShares = position.shares;
                State.userAllocation = position.allocation;
                State.userCurrentValue = position.currentValue;
                if (position.totalDeposited > 0) {
                    State.userDeposits = position.totalDeposited;
                }
                this.updateUserPortfolioInfo();
                this.renderPortfolio();
            });
        }

        // Update portfolio info panel
        this.updateUserPortfolioInfo();

        return total;
    },

    // ── User Portfolio Info Panel ────────────────────────────────────────────

    updateUserPortfolioInfo() {
        if (State.userRole !== 'user') return;

        const panel = document.getElementById('userPortfolioInfo');
        if (!panel) return;

        const wallet = typeof PhantomWallet !== 'undefined' ? PhantomWallet.walletAddress : null;
        const deposits = wallet ? JSON.parse(localStorage.getItem(`flub_deposits_${wallet}`) || '[]') : [];
        const totalDeposited = State.userDeposits || 0;
        const alloc = State.userAllocation || 0;

        // Current value from share-based accounting
        const currentValue = State.userCurrentValue || totalDeposited;

        // P&L calculation
        const pnl = currentValue - totalDeposited;
        const pnlPercent = totalDeposited > 0 ? (pnl / totalDeposited) * 100 : 0;

        // Current Value
        const valueEl = document.getElementById('userInfoValue');
        if (valueEl) valueEl.textContent = Assets.formatCurrency(currentValue);

        // P&L box
        const pnlBox = document.getElementById('userInfoPnlBox');
        const pnlArrow = document.getElementById('userInfoPnlArrow');
        const pnlAmountEl = document.getElementById('userInfoPnlAmount');
        const pnlPercentEl = document.getElementById('userInfoPnlPercent');

        if (pnlBox) {
            pnlBox.classList.remove('positive', 'negative', 'neutral');
            if (totalDeposited === 0) {
                pnlBox.classList.add('neutral');
            } else if (pnl >= 0) {
                pnlBox.classList.add('positive');
            } else {
                pnlBox.classList.add('negative');
            }
        }
        if (pnlArrow) pnlArrow.textContent = pnl > 0 ? '\u25B2' : pnl < 0 ? '\u25BC' : '\u25C6';
        if (pnlAmountEl) pnlAmountEl.textContent = (pnl >= 0 ? '+' : '') + Assets.formatCurrency(pnl);
        if (pnlPercentEl) pnlPercentEl.textContent = `(${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`;

        // Total Deposited
        const depositedEl = document.getElementById('userInfoDeposited');
        if (depositedEl) depositedEl.textContent = Assets.formatCurrency(totalDeposited);

        // Pool Share
        const allocEl = document.getElementById('userInfoAllocation');
        if (allocEl) allocEl.textContent = alloc.toFixed(2) + '%';

        // Last Deposit date
        const lastDepositEl = document.getElementById('userInfoLastDeposit');
        if (lastDepositEl) {
            if (deposits.length > 0) {
                const sorted = [...deposits].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const lastTs = sorted[0].timestamp;
                if (lastTs) {
                    const d = new Date(lastTs);
                    lastDepositEl.textContent = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
                } else {
                    lastDepositEl.textContent = '--';
                }
            } else {
                lastDepositEl.textContent = '--';
            }
        }

        // Deposit count
        const countEl = document.getElementById('userInfoDepositCount');
        if (countEl) countEl.textContent = deposits.length;

        // Member since (from first deposit or fallback)
        const joinedEl = document.getElementById('userInfoJoined');
        if (joinedEl) {
            if (deposits.length > 0) {
                const sorted = [...deposits].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                const firstTs = sorted[0].timestamp;
                if (firstTs) {
                    const d = new Date(firstTs);
                    joinedEl.textContent = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
                } else {
                    joinedEl.textContent = '--';
                }
            } else {
                joinedEl.textContent = '--';
            }
        }

        // Coins held count and holdings breakdown
        const cryptoAssets = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.balance > 0
        );

        const coinCountEl = document.getElementById('userInfoCoinCount');
        if (coinCountEl) coinCountEl.textContent = alloc > 0 ? cryptoAssets.length : 0;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // NAVIGATION — Bottom Nav Switching
    // ══════════════════════════════════════════════════════════════════════════

    _activeNav: 'home',  // 'home' | 'leaderboard' | 'transactions'

    _setActiveNav(id) {
        this._activeNav = id;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const btn = document.getElementById(id === 'home' ? 'navHome' : id === 'leaderboard' ? 'navLeaderboard' : 'navTransactions');
        if (btn) btn.classList.add('active');
    },

    showHome() {
        this._setActiveNav('home');
        document.getElementById('leaderboardOverlay')?.classList.remove('show');
        document.getElementById('transactionsOverlay')?.classList.remove('show');
    },

    showLeaderboard() {
        this._setActiveNav('leaderboard');
        document.getElementById('transactionsOverlay')?.classList.remove('show');
        document.getElementById('leaderboardOverlay')?.classList.add('show');
        this._fetchLeaderboard();
    },

    showTransactions() {
        this._setActiveNav('transactions');
        document.getElementById('leaderboardOverlay')?.classList.remove('show');
        document.getElementById('transactionsOverlay')?.classList.add('show');
        this._setupTransactionFilters();
        this._fetchTransactions();
    },

    // ══════════════════════════════════════════════════════════════════════════
    // LEADERBOARD
    // ══════════════════════════════════════════════════════════════════════════

    _leaderboardCache: null,
    _leaderboardLastFetch: 0,

    async _fetchLeaderboard() {
        const container = document.getElementById('leaderboardContent');
        if (!container) return;

        // Use cache if fresh (< 30s)
        if (this._leaderboardCache && Date.now() - this._leaderboardLastFetch < 30000) {
            this._renderLeaderboard(this._leaderboardCache);
            return;
        }

        // Calculate current pool value from portfolio data
        const poolValue = this._getPoolValue();
        if (!poolValue) {
            container.innerHTML = '<div class="lb-empty">Connect and load portfolio first to view leaderboard.</div>';
            return;
        }

        container.innerHTML = `<div class="page-loading">
            <div class="spinner" style="width:24px;height:24px;border:2px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;"></div>
            <span style="font-size:12px;color:#64748b;">Loading leaderboard...</span>
        </div>`;

        try {
            const res = await fetch(`/api/leaderboard?poolValue=${poolValue}`);
            if (!res.ok) {
                const errText = await res.text();
                console.error('Leaderboard API error:', res.status, errText);
                container.innerHTML = `<div class="lb-empty">Leaderboard error (${res.status}). Check console for details.</div>`;
                return;
            }
            const data = await res.json();
            if (data.leaderboard) {
                this._leaderboardCache = data.leaderboard;
                this._leaderboardLastFetch = Date.now();
                this._renderLeaderboard(data.leaderboard);
            } else if (data.error) {
                container.innerHTML = `<div class="lb-empty">${data.error}</div>`;
            } else {
                container.innerHTML = '<div class="lb-empty">No users with deposits yet.</div>';
            }
        } catch (err) {
            console.error('Leaderboard fetch error:', err);
            container.innerHTML = `<div class="lb-empty">Failed to load leaderboard: ${err.message}</div>`;
        }
    },

    _renderLeaderboard(board) {
        const container = document.getElementById('leaderboardContent');
        if (!container) return;

        if (!board || board.length === 0) {
            container.innerHTML = `<div class="lb-empty">
                <div style="font-size:32px;margin-bottom:8px;">🏆</div>
                No holders yet. Be the first to deposit!
            </div>`;
            return;
        }

        let html = '';

        // Podium for top 3
        const podium = board.slice(0, 3);
        if (podium.length > 0) {
            html += '<div class="lb-podium">';
            const trophies = [
                { cls: 'gold', emoji: '🥇', label: '1st' },
                { cls: 'silver', emoji: '🥈', label: '2nd' },
                { cls: 'bronze', emoji: '🥉', label: '3rd' }
            ];
            for (let i = 0; i < podium.length; i++) {
                const u = podium[i];
                const t = trophies[i];
                const joined = u.joinedDate ? new Date(u.joinedDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '--';
                html += `<div class="lb-podium-item ${t.cls}">
                    <div class="lb-trophy">${t.emoji}</div>
                    <div class="lb-wallet">${u.walletShort}</div>
                    <div class="lb-value">$${this._fmtNum(u.currentValue)}</div>
                    <div class="lb-pct">${u.allocation.toFixed(1)}% of pool</div>
                    <div class="lb-pct">Joined ${joined}</div>
                </div>`;
            }
            html += '</div>';
        }

        // Summary bar
        const totalHolders = board.length;
        const totalValue = board.reduce((s, u) => s + u.currentValue, 0);
        html += `<div style="display:flex;justify-content:space-between;padding:8px 4px 12px;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:10px;">
            <span style="font-size:10px;color:#64748b;font-weight:600;">${totalHolders} Holder${totalHolders !== 1 ? 's' : ''}</span>
            <span style="font-size:10px;color:#64748b;font-weight:600;">Combined: $${this._fmtNum(totalValue)}</span>
        </div>`;

        // Rest of list (rank 4+)
        for (let i = 3; i < board.length; i++) {
            const u = board[i];
            const joined = u.joinedDate ? new Date(u.joinedDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';
            const lastDep = u.lastDeposit ? new Date(u.lastDeposit).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '--';
            html += `<div class="lb-list-item">
                <div class="lb-rank">${u.rank}</div>
                <div class="lb-list-info">
                    <div class="lb-list-wallet">${u.walletShort}</div>
                    <div class="lb-list-meta">Joined ${joined} · Last deposit ${lastDep}</div>
                </div>
                <div class="lb-list-right">
                    <div class="lb-list-value">$${this._fmtNum(u.currentValue)}</div>
                    <div class="lb-list-pct">${u.allocation.toFixed(1)}%</div>
                </div>
            </div>`;
        }

        container.innerHTML = html;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // TRANSACTIONS
    // ══════════════════════════════════════════════════════════════════════════

    _txCache: null,
    _txLastFetch: 0,
    _txFilter: 'all',

    _setupTransactionFilters() {
        const isAdmin = State.userRole === 'admin';
        const badge = document.getElementById('txRoleBadge');
        if (badge) badge.style.display = isAdmin ? 'inline-block' : 'none';

        // Show/hide admin-only filters
        document.querySelectorAll('#txFilterBar .admin-only').forEach(el => {
            el.style.display = isAdmin ? 'inline-block' : 'none';
        });
    },

    filterTransactions(filter) {
        this._txFilter = filter;
        // Update active tab
        document.querySelectorAll('.tx-filter').forEach(el => {
            el.classList.toggle('active', el.dataset.filter === filter);
        });
        // Re-render with filter
        if (this._txCache) {
            this._renderTransactions(this._txCache);
        }
    },

    async _fetchTransactions() {
        const container = document.getElementById('transactionsContent');
        if (!container) return;

        const wallet = typeof PhantomWallet !== 'undefined' ? PhantomWallet.walletAddress : null;
        if (!wallet) {
            container.innerHTML = '<div class="tx-empty">Connect your wallet to view transaction history.</div>';
            return;
        }

        // Use cache if fresh (< 30s)
        if (this._txCache && Date.now() - this._txLastFetch < 30000) {
            this._renderTransactions(this._txCache);
            return;
        }

        container.innerHTML = `<div class="page-loading">
            <div class="spinner" style="width:24px;height:24px;border:2px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;"></div>
            <span style="font-size:12px;color:#64748b;">Loading transactions...</span>
        </div>`;

        try {
            // Fetch our DB transactions
            const res = await fetch(`/api/transactions?wallet=${wallet}`);
            if (!res.ok) {
                const errText = await res.text();
                console.error('Transactions API error:', res.status, errText);
                container.innerHTML = `<div class="tx-empty">Transactions error (${res.status}). Check console for details.</div>`;
                return;
            }
            const data = await res.json();
            let txns = data.transactions || [];

            // For admin: also fetch Swyftx order history and flag external trades
            if (State.userRole === 'admin' && typeof API !== 'undefined') {
                try {
                    const swyftxOrders = await API.fetchSwyftxOrderHistory(100);
                    if (swyftxOrders.length > 0) {
                        txns = this._mergeExternalTrades(txns, swyftxOrders);
                    }
                } catch (e) {
                    console.warn('Swyftx history merge skipped:', e);
                }
            }

            this._txCache = txns;
            this._txLastFetch = Date.now();
            this._renderTransactions(txns);
        } catch (err) {
            console.error('Transactions fetch error:', err);
            container.innerHTML = `<div class="tx-empty">Failed to load transactions: ${err.message}</div>`;
        }
    },

    /**
     * Compare Swyftx filled orders with our trades_collection.
     * Any Swyftx order that doesn't match a DB trade (by coin + type + ~timestamp)
     * is flagged as "external" — i.e. done directly on Swyftx outside this app.
     */
    _mergeExternalTrades(dbTxns, swyftxOrders) {
        // Build a set of "fingerprints" from our DB trades for fast lookup
        // Match by: coin + type + timestamp within 60 seconds
        const dbTradeKeys = new Set();
        for (const tx of dbTxns) {
            if (tx.type === 'buy' || tx.type === 'sell') {
                const ts = tx.timestamp ? new Date(tx.timestamp).getTime() : 0;
                // Create keys for a +-60s window
                const coin = (tx.coin || '').toUpperCase();
                const type = tx.type;
                for (let offset = -60000; offset <= 60000; offset += 10000) {
                    const bucket = Math.round((ts + offset) / 10000);
                    dbTradeKeys.add(`${coin}_${type}_${bucket}`);
                }
            }
        }

        // Check each Swyftx order against our DB
        const external = [];
        for (const order of swyftxOrders) {
            const coin = (order.coin || '').toUpperCase();
            const type = order.type; // 'buy' or 'sell'
            const ts = order.timestamp ? new Date(order.timestamp).getTime() : 0;
            const bucket = Math.round(ts / 10000);

            // Check if this order matches any DB trade
            const key = `${coin}_${type}_${bucket}`;
            if (!dbTradeKeys.has(key)) {
                // Not found in our DB — this is an external Swyftx trade
                external.push({
                    type: 'external',
                    externalType: type, // original buy/sell
                    coin,
                    amount: order.quantity,
                    price: order.trigger || 0,
                    timestamp: order.timestamp,
                    swyftxId: order.swyftxId,
                    walletShort: 'Swyftx Direct'
                });
            }
        }

        if (external.length > 0) {
            // Merge external trades into the list and re-sort
            const merged = [...dbTxns, ...external];
            merged.sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            });
            return merged;
        }

        return dbTxns;
    },

    _renderTransactions(txns) {
        const container = document.getElementById('transactionsContent');
        if (!container) return;

        // Apply filter
        let filtered = txns;
        if (this._txFilter === 'deposits') {
            filtered = txns.filter(t => t.type === 'deposit');
        } else if (this._txFilter === 'withdrawals') {
            filtered = txns.filter(t => t.type === 'withdrawal');
        } else if (this._txFilter === 'buys') {
            filtered = txns.filter(t => t.type === 'buy');
        } else if (this._txFilter === 'sells') {
            filtered = txns.filter(t => t.type === 'sell');
        } else if (this._txFilter === 'external') {
            filtered = txns.filter(t => t.type === 'external');
        }

        if (filtered.length === 0) {
            const filterLabel = this._txFilter === 'all' ? '' : ` matching "${this._txFilter}"`;
            container.innerHTML = `<div class="tx-empty">
                <div style="font-size:28px;margin-bottom:8px;">📋</div>
                No transactions${filterLabel} found.
            </div>`;
            return;
        }

        // Count externals for the summary
        const externalCount = txns.filter(t => t.type === 'external').length;
        let html = `<div style="font-size:10px;color:#475569;font-weight:600;padding:4px 0 8px;">${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}${externalCount > 0 && this._txFilter === 'all' ? ` · ${externalCount} external` : ''}</div>`;

        for (const tx of filtered) {
            const date = tx.timestamp ? new Date(tx.timestamp).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '--';
            const time = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';

            if (tx.type === 'deposit') {
                const isAdmin = State.userRole === 'admin';
                const walletInfo = tx.walletShort ? `<span style="font-size:9px;color:#475569;margin-left:4px;">${tx.walletShort}</span>` : '';
                const adminBadge = (isAdmin && tx.isAdmin) ? '<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:6px;background:rgba(234,179,8,0.15);color:#eab308;margin-left:4px;">ADMIN</span>' : '';
                const sharesInfo = tx.shares ? ` · ${parseFloat(tx.shares).toFixed(2)} shares` : '';
                const navInfo = (isAdmin && tx.nav) ? ` @ NAV $${parseFloat(tx.nav).toFixed(4)}` : '';
                html += `<div class="tx-item">
                    <div class="tx-icon-box deposit">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 12l7 7 7-7"/></svg>
                    </div>
                    <div class="tx-info">
                        <div class="tx-title">Deposit${walletInfo}${adminBadge}</div>
                        <div class="tx-subtitle">${tx.currency || 'USDC'}${sharesInfo}${navInfo}</div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount positive">+$${this._fmtNum(tx.amount)}</div>
                        <div class="tx-date">${date} ${time}</div>
                    </div>
                </div>`;
            } else if (tx.type === 'withdrawal') {
                const isAdmin = State.userRole === 'admin';
                const walletInfo = tx.walletShort ? `<span style="font-size:9px;color:#475569;margin-left:4px;">${tx.walletShort}</span>` : '';
                const adminBadge = (isAdmin && tx.isAdmin) ? '<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:6px;background:rgba(234,179,8,0.15);color:#eab308;margin-left:4px;">ADMIN</span>' : '';
                html += `<div class="tx-item">
                    <div class="tx-icon-box withdraw">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V3M5 12l7-7 7 7"/></svg>
                    </div>
                    <div class="tx-info">
                        <div class="tx-title">Withdrawal${walletInfo}${adminBadge}</div>
                        <div class="tx-subtitle">${tx.currency || 'USDC'}</div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount negative">-$${this._fmtNum(tx.amount)}</div>
                        <div class="tx-date">${date} ${time}</div>
                    </div>
                </div>`;
            } else if (tx.type === 'buy') {
                html += `<div class="tx-item">
                    <div class="tx-icon-box buy">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 12l7 7 7-7"/></svg>
                    </div>
                    <div class="tx-info">
                        <div class="tx-title">Buy ${tx.coin || ''}</div>
                        <div class="tx-subtitle">${tx.walletShort || 'Pool Trade'} · @ $${this._fmtNum(tx.price)}</div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount neutral">${typeof tx.amount === 'number' ? tx.amount.toFixed(6) : tx.amount}</div>
                        <div class="tx-date">${date} ${time}</div>
                    </div>
                </div>`;
            } else if (tx.type === 'sell') {
                html += `<div class="tx-item">
                    <div class="tx-icon-box sell">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V3M5 12l7-7 7 7"/></svg>
                    </div>
                    <div class="tx-info">
                        <div class="tx-title">Sell ${tx.coin || ''}</div>
                        <div class="tx-subtitle">${tx.walletShort || 'Pool Trade'} · @ $${this._fmtNum(tx.price)}</div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount neutral">${typeof tx.amount === 'number' ? tx.amount.toFixed(6) : tx.amount}</div>
                        <div class="tx-date">${date} ${time}</div>
                    </div>
                </div>`;
            } else if (tx.type === 'external') {
                const isBuy = tx.externalType === 'buy';
                html += `<div class="tx-item" style="border-color:rgba(139,92,246,0.12);">
                    <div class="tx-icon-box external">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </div>
                    <div class="tx-info">
                        <div class="tx-title">${isBuy ? 'Buy' : 'Sell'} ${tx.coin || ''} <span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:6px;background:rgba(139,92,246,0.15);color:#a78bfa;margin-left:4px;">EXTERNAL</span></div>
                        <div class="tx-subtitle">Swyftx Direct${tx.price ? ' · @ $' + this._fmtNum(tx.price) : ''}</div>
                    </div>
                    <div class="tx-right">
                        <div class="tx-amount" style="color:#a78bfa;">${typeof tx.amount === 'number' ? tx.amount.toFixed(6) : tx.amount}</div>
                        <div class="tx-date">${date} ${time}</div>
                    </div>
                </div>`;
            }
        }

        container.innerHTML = html;
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    _getPoolValue() {
        if (!State.portfolioData || !State.portfolioData.assets) return 0;
        return State.portfolioData.assets.reduce((sum, a) => sum + (a.usd_value || 0), 0);
    },

    _fmtNum(n) {
        if (n == null || isNaN(n)) return '0.00';
        if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return Number(n).toFixed(2);
    }
};
