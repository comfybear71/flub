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
                const userCryptoTotal = userCrypto.reduce((s, v) => s + v, 0);
                // Remaining USDC deposit not yet allocated
                const usdcRemaining = Math.max(0, deposited - userCryptoTotal);
                chartData = [...userCrypto];
                chartColors = [...cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666')];
                chartLabels = [...cryptoAssets.map(a => a.code)];
                if (usdcRemaining > 0.01) {
                    chartData.push(usdcRemaining);
                    chartColors.push('#22c55e');
                    chartLabels.push('USDC');
                }
                centerLabel = 'My Portfolio';
                centerValue = Assets.formatCurrency(deposited);
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

                return `
                <div class="card" style="cursor:default;">
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <div class="coin-icon-wrapper" style="background:${style.color}20;color:${style.color};">
                                <span class="coin-icon-letter">${style.icon}</span>
                            </div>
                            <div>
                                <div class="font-bold text-sm">${asset.code}</div>
                                <div class="text-xs text-slate-400">${Assets.formatNumber(displayBalance)} ${asset.code}</div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="font-bold text-sm">${Assets.formatCurrency(displayValue)}</div>
                            <div class="text-xs text-slate-400">${Assets.formatCurrency(asset.usd_price)} USD</div>
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

            return `
            <div class="card" ${clickAction} style="${cursorStyle}">
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
                        <div class="font-bold text-sm">${Assets.formatCurrency(asset.usd_value)}</div>
                        <div class="text-xs text-slate-400">${Assets.formatCurrency(asset.usd_price)} USD</div>
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

            // Track deposit locally (until backend is built)
            this._recordDeposit(PhantomWallet.walletAddress, amount, txSignature);

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
            return;
        }

        // Total pool value = all assets from Swyftx (USDC + AUD + crypto)
        const totalPoolValue = State.portfolioData.assets.reduce(
            (sum, a) => sum + (a.usd_value || 0), 0
        );

        if (totalPoolValue <= 0) {
            State.userAllocation = 0;
            return;
        }

        // User's allocation = their deposits / total pool value * 100
        // Cap at 100% in case deposits exceed pool value (shouldn't happen normally)
        State.userAllocation = Math.min(100, (State.userDeposits / totalPoolValue) * 100);

        Logger.log(`User allocation: ${State.userAllocation.toFixed(2)}% ($${State.userDeposits.toFixed(2)} / $${totalPoolValue.toFixed(2)})`, 'info');
    },

    // ── Deposit tracking (localStorage until backend) ────────────────────────

    _recordDeposit(wallet, amount, txHash) {
        const key = `flub_deposits_${wallet}`;
        const deposits = JSON.parse(localStorage.getItem(key) || '[]');
        deposits.push({ amount, txHash, timestamp: Date.now() });
        localStorage.setItem(key, JSON.stringify(deposits));

        // Update state
        const total = deposits.reduce((sum, d) => sum + d.amount, 0);
        State.userDeposits = total;

        // Recalculate allocation with new deposit
        this.calculateUserAllocation();

        Logger.log(`Total deposited: $${total.toFixed(2)} USDC`, 'success');
    },

    // ── User Insight Cards (read-only views) ───────────────────────────────

    updateUserInsightCards() {
        if (State.userRole !== 'user') return;

        // Pending orders count
        const count = (State.pendingOrders || []).length;
        const countEl = document.getElementById('userPendingCount');
        if (countEl) countEl.textContent = count === 0 ? 'No orders' : `${count} order${count !== 1 ? 's' : ''}`;

        // Auto trader status
        const statusEl = document.getElementById('userBotStatus');
        if (statusEl) {
            if (typeof AutoTrader !== 'undefined' && AutoTrader.isActive) {
                const activeCoins = Object.keys(AutoTrader.targets).filter(c => !AutoTrader._isOnCooldown(c));
                statusEl.textContent = `Active · ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
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

        // Auto-refresh every 10 seconds while modal is open
        this._userAutoTraderInterval = setInterval(() => this._fetchAndRenderUserAutoTrader(), 10000);

        modal.classList.add('show');
    },

    closeUserAutoTrader() {
        const modal = document.getElementById('userAutoTraderModal');
        if (modal) modal.classList.remove('show');
        if (this._userAutoTraderInterval) {
            clearInterval(this._userAutoTraderInterval);
            this._userAutoTraderInterval = null;
        }
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
                    // Apply active state
                    if (data.autoActive) {
                        AutoTrader.isActive = data.autoActive.isActive || false;
                        AutoTrader.targets = data.autoActive.targets || data.autoActive.basePrices || {};
                    } else {
                        AutoTrader.isActive = false;
                    }

                    // Apply tier settings
                    if (data.autoTiers) {
                        if (data.autoTiers.tier1) AutoTrader.tier1 = data.autoTiers.tier1;
                        if (data.autoTiers.tier2) AutoTrader.tier2 = data.autoTiers.tier2;
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

        // Settings summary
        if (settingsEl && typeof AutoTrader !== 'undefined') {
            settingsEl.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="padding:10px;border-radius:10px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);">
                    <div style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:6px;">Tier 1 – Blue Chips</div>
                    <div style="font-size:10px;color:#94a3b8;">Dev: <span style="color:#e2e8f0;font-weight:600;">${AutoTrader.tier1.deviation}%</span></div>
                    <div style="font-size:10px;color:#94a3b8;">Alloc: <span style="color:#e2e8f0;font-weight:600;">${AutoTrader.tier1.allocation}%</span></div>
                    <div style="font-size:9px;color:#64748b;margin-top:4px;">${AutoTrader.TIER1_COINS.join(', ')}</div>
                </div>
                <div style="padding:10px;border-radius:10px;background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.15);">
                    <div style="font-size:10px;font-weight:700;color:#eab308;margin-bottom:6px;">Tier 2 – Alts</div>
                    <div style="font-size:10px;color:#94a3b8;">Dev: <span style="color:#e2e8f0;font-weight:600;">${AutoTrader.tier2.deviation}%</span></div>
                    <div style="font-size:10px;color:#94a3b8;">Alloc: <span style="color:#e2e8f0;font-weight:600;">${AutoTrader.tier2.allocation}%</span></div>
                    <div style="font-size:9px;color:#64748b;margin-top:4px;">All other coins</div>
                </div>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Cooldown: ${AutoTrader.COOLDOWN_HOURS}h</span>
                <span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Reserve: $${AutoTrader.MIN_USDC_RESERVE}</span>
                <span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.04);color:#94a3b8;">Prices: 60s</span>
            </div>`;
        }

        // Monitoring status
        if (monitorEl && typeof AutoTrader !== 'undefined') {
            if (!isActive) {
                monitorEl.innerHTML = '<div style="text-align:center;color:#64748b;font-size:11px;padding:12px;background:rgba(0,0,0,0.15);border-radius:8px;">Bot is not currently running.</div>';
            } else {
                const coins = Object.keys(AutoTrader.targets);
                const activeCoins = coins.filter(c => !AutoTrader._isOnCooldown(c));
                const cdCoins = coins.filter(c => AutoTrader._isOnCooldown(c));

                // Countdown
                let countdownText = '';
                if (State.lastPriceTick && typeof API !== 'undefined') {
                    const elapsed = Math.floor((Date.now() - State.lastPriceTick) / 1000);
                    const remaining = Math.max(0, (API.PRICE_TICK_INTERVAL || 60) - elapsed);
                    countdownText = `${remaining}s`;
                }

                let html = '<div style="display:flex;flex-direction:column;gap:4px;">';
                html += `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;color:#e2e8f0;margin-bottom:4px;">`;
                html += `<span>Monitoring ${activeCoins.length} coin${activeCoins.length !== 1 ? 's' : ''}`;
                if (cdCoins.length > 0) html += ` <span style="color:#94a3b8;font-weight:400;">(${cdCoins.length} on cooldown)</span>`;
                html += `</span>`;
                html += `<span style="font-size:9px;font-weight:400;color:#64748b;">${countdownText}</span>`;
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

        // Calculate allocation based on current pool data
        this.calculateUserAllocation();

        return total;
    }
};
