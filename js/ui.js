// ==========================================
// UI - User Interface & DOM Manipulation
// ==========================================
const UI = {
    init() {
        this.checkPin();
    },

    // ── PIN / Auth ────────────────────────────────────────────────────────────

    checkPin() {
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
        if (headerUsdc) headerUsdc.textContent = Assets.formatCurrency(usdcBalance);
        if (headerAud)  headerAud.textContent  = Assets.formatCurrency(audBalance);

        const cryptoAssets = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC' && a.usd_value > 10
        );

        const colors      = cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color ?? '#666');
        const cryptoTotal = cryptoAssets.reduce((sum, a) => sum + (a.usd_value || 0), 0);
        const totalValue  = cryptoTotal + usdcBalance + audBalance;

        State.portfolioChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: cryptoAssets.map(a => a.usd_value || 0),
                    backgroundColor: colors,
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
                                const asset = cryptoAssets[context.dataIndex];
                                return `${asset.code}: ${Assets.formatCurrency(asset.usd_value)}`;
                            }
                        }
                    }
                },
                maintainAspectRatio: false
            }
        });

        const totalEl = document.getElementById('total-value');
        const countEl = document.getElementById('asset-count');
        if (totalEl) totalEl.textContent = Assets.formatCurrency(totalValue);
        if (countEl) countEl.textContent = `${cryptoAssets.length} assets + cash`;
    },

    // ── Holdings List ─────────────────────────────────────────────────────────

    renderHoldings() {
        const container = document.getElementById('holdings-list');
        if (!container) return;

        const holdings = State.portfolioData.assets.filter(
            a => a.code !== 'AUD' && a.code !== 'USDC'
        );

        if (holdings.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#64748b;padding:40px;">No crypto holdings found</div>';
            return;
        }

        container.innerHTML = holdings.map(asset => {
            const style      = CONFIG.ASSET_STYLES[asset.code] ?? { color: '#666', icon: asset.code[0] };
            const change     = asset.change_24h || 0;
            const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
            const changeSign  = change >= 0 ? '+' : '';
            return `
            <div class="card" onclick="UI.openTrade('${asset.code}')">
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
    },

    // ── Trading Panel ─────────────────────────────────────────────────────────

    openTrade(code) {
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
        const autoDevSlider = document.getElementById('autoDevSlider');
        const autoAllocSlider = document.getElementById('autoAllocSlider');
        if (amountSlider)   amountSlider.value   = 0;
        if (triggerSlider)  triggerSlider.value  = 0;
        if (autoDevSlider)  autoDevSlider.value  = 3;
        if (autoAllocSlider) autoAllocSlider.value = 3;
        document.getElementById('miniChartContainer')?.classList.remove('show');
        document.getElementById('chartToggleBtn')?.classList.remove('active');
        // Reset instant toggle to Buy
        this.setInstantSide('buy');
        Trading.updateTriggerButtonBalances();
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        
        // Initialize AutoTrader display
        if (typeof AutoTrader !== 'undefined') {
            AutoTrader.updateDeviation(3);
            AutoTrader.updateAllocation(3);
        }
        
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

        if (type === 'instant') {
            amountSection?.classList.remove('hidden');
            triggerSection?.classList.remove('show');
            autoSection?.classList.remove('show');
        } else if (type === 'trigger') {
            amountSection?.classList.add('hidden');
            triggerSection?.classList.add('show');
            autoSection?.classList.remove('show');
            Trading.resetTrigger();
        } else if (type === 'auto') {
            amountSection?.classList.add('hidden');
            triggerSection?.classList.remove('show');
            autoSection?.classList.add('show');
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
    }
};
