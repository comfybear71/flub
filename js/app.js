// ==========================================
// CONFIG - Constants & Configuration
// ==========================================
const CONFIG = {
    API_URL: 'https://portfolio-api-jade-delta.vercel.app/api/portfolio',
    TRADE_PIN: '',
    ASSET_STYLES: {
        'BTC': { color: '#f97316', icon: '₿', name: 'Bitcoin' },
        'NEO': { color: '#22c55e', icon: 'N', name: 'NEO' },
        'ETH': { color: '#6366f1', icon: 'E', name: 'Ethereum' },
        'XRP': { color: '#06b6d4', icon: 'X', name: 'XRP' },
        'BCH': { color: '#8b5cf6', icon: 'B', name: 'Bitcoin Cash' },
        'BNB': { color: '#eab308', icon: 'B', name: 'Binance Coin' },
        'TRX': { color: '#ef4444', icon: 'T', name: 'TRON' },
        'SOL': { color: '#a855f7', icon: 'S', name: 'Solana' },
        'SUI': { color: '#4ade80', icon: 'S', name: 'Sui' },
        'LUNA': { color: '#ef4444', icon: 'L', name: 'Terra' },
        'ENA': { color: '#6b7280', icon: 'E', name: 'Ethena' },
        'USDC': { color: '#22c55e', icon: '$', name: 'USD Coin' },
        'ADA': { color: '#3b82f6', icon: 'A', name: 'Cardano' },
        'POL': { color: '#8b5cf6', icon: 'P', name: 'Polygon' },
        'DOGE': { color: '#eab308', icon: 'Ð', name: 'Dogecoin' },
        'AUD': { color: '#f59e0b', icon: 'A$', name: 'Australian Dollar' }
    },
    CODE_TO_ID: {
        'AUD': 1,
        'BTC': 2,
        'ETH': 3,
        'XRP': 5,
        'ADA': 12,
        'USD': 36,
        'USDC': 53,
        'DOGE': 73,
        'SOL': 130,
        'LUNA': 405,
        'LUNC': 406,
        'NEXO': 407,
        'SUI': 438,
        'ENA': 496,
        'POL': 569,
        'XAUT': 635
    }
};

// ==========================================
// STATE - Global Application State
// ==========================================
const State = {
    portfolioData: { assets: [] },
    selectedAsset: null,
    cashAsset: 'AUD',
    orderType: 'instant',
    amountSliderValue: 0,
    triggerOffset: 0,
    jwtToken: null,
    pendingTradeSide: null,
    currentSort: 'value',
    isMiniChartVisible: false,
    isConnected: false,
    portfolioChart: null,
    miniChart: null,
    autoTradeConfig: {
        deviation: 0,
        allocation: 0
    },
    selectedTriggerCash: 'AUD',
    selectedLimitType: null,
    triggerAmountPercent: 0,
    liveRates: {},
    pendingOrderType: null,
    pendingTriggerPrice: 0
};

// ==========================================
// API - All Network Requests
// ==========================================
const API = {
    async connect() {
        UI.updateStatus('connecting');
        Logger.log('Connecting to Swyftx...', 'info');
        
        try {
            const res = await fetch('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: '/auth/refresh/',
                    method: 'POST'
                })
            });
            
            const data = await res.json();
            
            if (data.accessToken) {
                State.jwtToken = data.accessToken;
                Logger.log('Connected!', 'success');
                UI.updateStatus('connected');
                await this.refreshData();
                return true;
            } else {
                throw new Error('No access token');
            }
        } catch (error) {
            Logger.log('Connection failed: ' + error.message, 'error');
            UI.updateStatus('disconnected');
            document.getElementById('holdings-list').innerHTML = `
                <div style="text-align: center; color: #64748b; padding: 40px;">
                    Connection failed. Tap refresh to retry.
                </div>
            `;
            return false;
        }
    },

    async refreshData() {
        const btn = document.getElementById('refreshBtn');
        if (btn) btn.classList.add('spinning');
        
        try {
            Logger.log('Fetching portfolio data...', 'info');
            
            const response = await fetch(CONFIG.API_URL);
            const data = await response.json();
            
            Logger.log('Portfolio data received: ' + JSON.stringify(data).substring(0, 200), 'info');
            
            // Handle different possible response structures
            let assets = [];
            if (data && Array.isArray(data.assets)) {
                assets = data.assets;
            } else if (data && Array.isArray(data)) {
                assets = data;
            } else if (data && data.data && Array.isArray(data.data.assets)) {
                assets = data.data.assets;
            } else {
                throw new Error('Unexpected data structure: ' + typeof data);
            }
            
            State.portfolioData.assets = assets
                .filter(asset => asset && asset.code !== 'USD')
                .map(asset => ({
                    code: asset.code || 'UNKNOWN',
                    name: asset.name || asset.code || 'Unknown',
                    balance: parseFloat(asset.balance || 0),
                    aud_value: parseFloat(asset.aud_value || asset.value || 0),
                    price: parseFloat(asset.aud_value || asset.value || 0) / parseFloat(asset.balance || 1),
                    change_24h: parseFloat(asset.change_24h || asset.change || 0),
                    asset_id: asset.asset_id || asset.id
                }))
                .filter(a => a.balance > 0 || a.code === 'AUD' || a.code === 'USDC');
            
            // Fetch live rates for accurate pricing (optional)
            try {
                await this.fetchLiveRates();
            } catch (e) {
                Logger.log('Live rates optional fetch failed', 'info');
            }
            
            Assets.sort(State.currentSort);
            
            UI.renderPortfolio();
            UI.renderHoldings();
            UI.updateLastUpdated();
            Logger.log(`Loaded ${State.portfolioData.assets.length} assets`, 'success');
            
        } catch (error) {
            Logger.log('Refresh error: ' + error.message, 'error');
            document.getElementById('holdings-list').innerHTML = `
                <div style="text-align: center; color: #ef4444; padding: 40px;">
                    Error loading portfolio: ${error.message}<br>
                    <button onclick="App.refreshData()" style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer;">Retry</button>
                </div>
            `;
        } finally {
            if (btn) btn.classList.remove('spinning');
        }
    },

    async fetchLiveRates() {
        try {
            const res = await fetch('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: '/markets/live/rates/AUD/',
                    method: 'GET',
                    authToken: State.jwtToken
                })
            });
            
            if (res.ok) {
                const rates = await res.json();
                State.liveRates = {};
                if (Array.isArray(rates)) {
                    rates.forEach(rate => {
                        if (rate.asset && rate.rate) {
                            State.liveRates[rate.asset] = parseFloat(rate.rate);
                        }
                    });
                    Logger.log(`Live rates fetched for ${rates.length} assets`, 'info');
                }
            } else {
                Logger.log('Live rates fetch failed: ' + res.status, 'warning');
            }
        } catch (error) {
            Logger.log('Failed to fetch live rates: ' + error.message, 'warning');
        }
    },

    getRealtimePrice(assetCode) {
        if (State.liveRates[assetCode]) {
            return State.liveRates[assetCode];
        }
        const asset = State.portfolioData.assets.find(a => a.code === assetCode);
        return asset ? asset.price : 0;
    },

    async placeOrder(orderData) {
        Logger.log('API Request: POST /orders/', 'info');
        Logger.log('Order data: ' + JSON.stringify(orderData), 'info');
        
        const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: '/orders/',
                method: 'POST',
                body: orderData,
                authToken: State.jwtToken,
                pin: CONFIG.TRADE_PIN
            })
        });
        
        Logger.log(`API Response: ${res.status} ${res.statusText}`, res.ok ? 'success' : 'error');
        
        if (!res.ok) {
            const errorBody = await res.text();
            Logger.log('Error response: ' + errorBody, 'error');
        }
        
        return res;
    }
};

// ==========================================
// LOGGER - Activity Logging
// ==========================================
const Logger = {
    log(message, type = 'info') {
        const container = document.getElementById('log-container');
        if (!container) return;
        
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        let msgStr = message;
        if (typeof message === 'object') {
            try {
                msgStr = JSON.stringify(message).substring(0, 200);
            } catch (e) {
                msgStr = '[Object]';
            }
        }
        
        entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${msgStr}</span>`;
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
        console.log(message);
    }
};

// ==========================================
// ASSETS - Asset Management & Sorting
// ==========================================
const Assets = {
    sort(sortType) {
        State.currentSort = sortType;
        
        document.querySelectorAll('[id^="check-"]').forEach(el => el.classList.add('hidden'));
        const checkEl = document.getElementById(`check-${sortType}`);
        if (checkEl) checkEl.classList.remove('hidden');
        
        const labels = {
            'value': 'Sort: Value',
            'change': 'Sort: Change %',
            'name': 'Sort: Name',
            'balance': 'Sort: Balance'
        };
        const sortLabel = document.getElementById('currentSortLabel');
        if (sortLabel) sortLabel.textContent = labels[sortType];
        
        if (sortType === 'value') {
            State.portfolioData.assets.sort((a, b) => (b.aud_value || 0) - (a.aud_value || 0));
        } else if (sortType === 'change') {
            State.portfolioData.assets.sort((a, b) => (b.change_24h || 0) - (a.change_24h || 0));
        } else if (sortType === 'name') {
            State.portfolioData.assets.sort((a, b) => a.code.localeCompare(b.code));
        } else if (sortType === 'balance') {
            State.portfolioData.assets.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        }
    },

    getUsdcToAudRate() {
        const usdcAsset = State.portfolioData.assets.find(a => a.code === 'USDC');
        if (usdcAsset && usdcAsset.balance > 0) {
            return usdcAsset.aud_value / usdcAsset.balance;
        }
        return 1.5;
    },

    getPriceInCurrency(audPrice, targetCurrency) {
        if (targetCurrency === 'AUD') {
            return audPrice;
        } else if (targetCurrency === 'USDC') {
            const usdcRate = this.getUsdcToAudRate();
            return audPrice / usdcRate;
        }
        return audPrice;
    },

    formatCurrency(value) {
        if (!value || isNaN(value)) return '$0.00';
        if (value >= 1000) return '$' + value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return '$' + value.toFixed(2);
    },

    formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        if (num >= 1000) return num.toLocaleString();
        if (num >= 1) return num.toFixed(2);
        if (num >= 0.01) return num.toFixed(4);
        return num.toFixed(6);
    }
};

// ==========================================
// UI - User Interface & DOM Manipulation
// ==========================================
const UI = {
    init() {
        this.checkPin();
    },

    checkPin() {
        const savedPin = localStorage.getItem('tradePin');
        if (!savedPin) {
            const pinModal = document.getElementById('pinModal');
            if (pinModal) pinModal.classList.add('show');
        } else {
            CONFIG.TRADE_PIN = savedPin;
        }
    },

    unlockTrading() {
        const pinInput = document.getElementById('pinInput');
        const pinError = document.getElementById('pinError');
        const pinBtn = document.getElementById('pinBtn');
        
        if (!pinInput || !pinBtn) return;
        
        pinBtn.disabled = true;
        pinBtn.textContent = 'Verifying...';
        
        if (pinInput.value.length >= 4) {
            CONFIG.TRADE_PIN = pinInput.value;
            localStorage.setItem('tradePin', pinInput.value);
            const pinModal = document.getElementById('pinModal');
            if (pinModal) pinModal.classList.remove('show');
            Logger.log('Trading unlocked', 'success');
        } else {
            if (pinError) pinError.classList.add('show');
            pinBtn.disabled = false;
            pinBtn.textContent = 'Unlock';
        }
    },

    updateStatus(status) {
        const el = document.getElementById('api-status');
        if (!el) return;
        
        if (status === 'connected') {
            el.className = 'api-status api-connected';
            el.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400"></span> Connected';
            State.isConnected = true;
        } else if (status === 'connecting') {
            el.className = 'api-status api-connecting';
            el.innerHTML = '<span class="w-2 h-2 rounded-full bg-yellow-400"></span> Connecting...';
        } else {
            el.className = 'api-status api-disconnected';
            el.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-400"></span> Disconnected';
            State.isConnected = false;
        }
    },

    updateLastUpdated() {
        const el = document.getElementById('last-updated');
        if (!el) return;
        
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.textContent = `Last updated: ${time}`;
    },

    renderPortfolio() {
        const ctx = document.getElementById('portfolioChart');
        if (!ctx) return;
        
        if (State.portfolioChart) State.portfolioChart.destroy();
        
        const cryptoAssets = State.portfolioData.assets.filter(a => 
            a.code !== 'AUD' && a.code !== 'USDC' && a.aud_value > 10
        );
        
        const colors = cryptoAssets.map(a => CONFIG.ASSET_STYLES[a.code]?.color || '#666');
        const total = cryptoAssets.reduce((sum, a) => sum + (a.aud_value || 0), 0);
        
        State.portfolioChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: cryptoAssets.map(a => a.aud_value || 0),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '70%',
                plugins: { legend: { display: false } },
                maintainAspectRatio: false
            }
        });
        
        const totalEl = document.getElementById('total-value');
        const countEl = document.getElementById('asset-count');
        if (totalEl) totalEl.textContent = Assets.formatCurrency(total);
        if (countEl) countEl.textContent = cryptoAssets.length + ' assets';
    },

    renderHoldings() {
        const container = document.getElementById('holdings-list');
        if (!container) return;
        
        const holdings = State.portfolioData.assets.filter(a => a.code !== 'AUD' && a.code !== 'USDC');
        
        if (holdings.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 40px;">No crypto holdings found</div>';
            return;
        }
        
        let html = '';
        holdings.forEach(asset => {
            const style = CONFIG.ASSET_STYLES[asset.code] || { color: '#666', icon: asset.code[0] };
            const change = asset.change_24h || 0;
            const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
            const changeSign = change >= 0 ? '+' : '';
            
            html += `
            <div class="card" onclick="UI.openTrade('${asset.code}')">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg" 
                             style="background: ${style.color}20; color: ${style.color};">
                            ${style.icon}
                        </div>
                        <div>
                            <div class="font-bold text-sm">${asset.code}</div>
                            <div class="text-xs text-slate-400">${Assets.formatNumber(asset.balance)} ${asset.code}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-sm">${Assets.formatCurrency(asset.aud_value)}</div>
                        <div class="text-xs text-slate-400">$${Assets.formatNumber(asset.price)}</div>
                        <div class="text-xs font-semibold" style="color: ${changeColor};">${changeSign}${change.toFixed(2)}%</div>
                    </div>
                </div>
            </div>
            `;
        });
        
        container.innerHTML = html;
    },

    openTrade(code) {
        State.selectedAsset = State.portfolioData.assets.find(a => a.code === code);
        if (!State.selectedAsset) return;
        
        const style = CONFIG.ASSET_STYLES[code];
        
        const iconEl = document.getElementById('tradeIcon');
        const nameEl = document.getElementById('tradeName');
        
        if (iconEl) {
            iconEl.textContent = style.icon;
            iconEl.style.background = style.color + '33';
            iconEl.style.color = style.color;
        }
        if (nameEl) nameEl.textContent = code;
        
        State.amountSliderValue = 0;
        State.triggerOffset = 0;
        State.isMiniChartVisible = false;
        
        const amountSlider = document.getElementById('amountSlider');
        const triggerSlider = document.getElementById('triggerSlider');
        if (amountSlider) amountSlider.value = 0;
        if (triggerSlider) triggerSlider.value = 0;
        
        const miniChartContainer = document.getElementById('miniChartContainer');
        const chartToggleBtn = document.getElementById('chartToggleBtn');
        if (miniChartContainer) miniChartContainer.classList.remove('show');
        if (chartToggleBtn) chartToggleBtn.classList.remove('active');
        
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        const autoDevSlider = document.getElementById('autoDevSlider');
        const autoAllocSlider = document.getElementById('autoAllocSlider');
        if (autoDevSlider) autoDevSlider.value = 0;
        if (autoAllocSlider) autoAllocSlider.value = 0;
        
        Trading.updateTriggerButtonBalances();
        
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        
        const chartSection = document.getElementById('chartSection');
        const chartSlider = document.getElementById('chartSlider');
        if (chartSection) chartSection.classList.add('trading-open');
        if (chartSlider) chartSlider.classList.add('slide-left');
        
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        if (event && event.currentTarget) event.currentTarget.classList.add('selected');
    },

    closeTradingView() {
        const chartSection = document.getElementById('chartSection');
        const chartSlider = document.getElementById('chartSlider');
        if (chartSection) chartSection.classList.remove('trading-open');
        if (chartSlider) chartSlider.classList.remove('slide-left');
        
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        
        State.isMiniChartVisible = false;
        const miniChartContainer = document.getElementById('miniChartContainer');
        const chartToggleBtn = document.getElementById('chartToggleBtn');
        if (miniChartContainer) miniChartContainer.classList.remove('show');
        if (chartToggleBtn) chartToggleBtn.classList.remove('active');
    },

    toggleMiniChart() {
        State.isMiniChartVisible = !State.isMiniChartVisible;
        const container = document.getElementById('miniChartContainer');
        const btn = document.getElementById('chartToggleBtn');
        
        if (State.isMiniChartVisible) {
            if (container) container.classList.add('show');
            if (btn) btn.classList.add('active');
            if (State.selectedAsset) {
                this.renderMiniChart(CONFIG.ASSET_STYLES[State.selectedAsset.code].color);
            }
        } else {
            if (container) container.classList.remove('show');
            if (btn) btn.classList.remove('active');
        }
    },

    renderMiniChart(color) {
        const ctx = document.getElementById('miniChart');
        if (!ctx) return;
        
        if (State.miniChart) State.miniChart.destroy();
        
        const data = [];
        const change = State.selectedAsset.change_24h || 0;
        let price = State.selectedAsset.price * (1 - change/100);
        const volatility = Math.abs(change) / 20 || 0.01;
        
        for (let i = 0; i < 20; i++) {
            price = price * (1 + (Math.random() - 0.5) * volatility);
            data.push(price);
        }
        data[data.length - 1] = State.selectedAsset.price;
        
        const context = ctx.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 0, 70);
        gradient.addColorStop(0, color + '50');
        gradient.addColorStop(1, color + '00');
        
        State.miniChart = new Chart(context, {
            type: 'line',
            data: {
                labels: data.map((_, i) => i),
                datasets: [{
                    data: data,
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
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    },

    setOrderType(type) {
        State.orderType = type;
        
        const btnInstant = document.getElementById('btnInstant');
        const btnTrigger = document.getElementById('btnTrigger');
        const btnAuto = document.getElementById('btnAuto');
        
        if (btnInstant) btnInstant.classList.toggle('active', type === 'instant');
        if (btnTrigger) btnTrigger.classList.toggle('active', type === 'trigger');
        if (btnAuto) btnAuto.classList.toggle('active', type === 'auto');
        
        const amountSection = document.getElementById('amountSection');
        const triggerSection = document.getElementById('triggerSection');
        const autoSection = document.getElementById('autoSection');
        
        if (type === 'instant') {
            if (amountSection) amountSection.classList.remove('hidden');
            if (triggerSection) triggerSection.classList.remove('show');
            if (autoSection) autoSection.classList.remove('show');
        } else if (type === 'trigger') {
            if (amountSection) amountSection.classList.add('hidden');
            if (triggerSection) triggerSection.classList.add('show');
            if (autoSection) autoSection.classList.remove('show');
            Trading.resetTrigger();
        } else if (type === 'auto') {
            if (amountSection) amountSection.classList.add('hidden');
            if (triggerSection) triggerSection.classList.remove('show');
            if (autoSection) autoSection.classList.add('show');
        }
        
        State.triggerOffset = 0;
        State.autoTradeConfig.deviation = 0;
        
        const triggerSlider = document.getElementById('triggerSlider');
        const autoDevSlider = document.getElementById('autoDevSlider');
        if (triggerSlider) triggerSlider.value = 0;
        if (autoDevSlider) autoDevSlider.value = 0;
        
        const triggerError = document.getElementById('triggerError');
        const autoError = document.getElementById('autoError');
        if (triggerError) triggerError.style.display = 'none';
        if (autoError) autoError.style.display = 'none';
        
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        UI.updateAmountDisplay();
    },

    setCash(cash) {
        State.cashAsset = cash;
        
        const optAUD = document.getElementById('optAUD');
        const optUSDC = document.getElementById('optUSDC');
        if (optAUD) optAUD.classList.toggle('active', cash === 'AUD');
        if (optUSDC) optUSDC.classList.toggle('active', cash === 'USDC');
        
        UI.updateAmountDisplay();
        Trading.updateAutoTradeDisplay();
        Trading.updateTriggerDisplay();
    },

    updateAmountSlider(value) {
        State.amountSliderValue = parseInt(value);
        
        const amountFill = document.getElementById('amountFill');
        const amountPercent = document.getElementById('amountPercent');
        if (amountFill) amountFill.style.width = State.amountSliderValue + '%';
        if (amountPercent) amountPercent.textContent = State.amountSliderValue + '%';
        
        UI.updateAmountDisplay();
    },

    updateAmountDisplay() {
        const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
        const assetBalance = State.selectedAsset?.balance || 0;
        const currentPrice = State.selectedAsset?.price || 0;
        
        let displayAmount, conversionText;
        
        if (State.pendingTradeSide === 'sell') {
            const sellQuantity = (State.amountSliderValue / 100) * assetBalance;
            const cashPrice = Assets.getPriceInCurrency(currentPrice, State.cashAsset);
            const cashValue = sellQuantity * cashPrice;
            displayAmount = cashValue;
            conversionText = `${sellQuantity.toFixed(8)} ${State.selectedAsset?.code || ''}`;
        } else {
            const cashAmount = (State.amountSliderValue / 100) * cashBalance;
            displayAmount = cashAmount;
            const cashPrice = Assets.getPriceInCurrency(currentPrice, State.cashAsset);
            const receiveAmount = cashPrice > 0 ? cashAmount / cashPrice : 0;
            conversionText = `≈ ${receiveAmount.toFixed(8)} ${State.selectedAsset?.code || ''}`;
        }
        
        const amountValue = document.getElementById('amountValue');
        const conversionTextEl = document.getElementById('conversionText');
        if (amountValue) amountValue.textContent = Assets.formatCurrency(displayAmount);
        if (conversionTextEl) conversionTextEl.textContent = conversionText;
    },

    toggleSort() {
        const sortModal = document.getElementById('sortModal');
        const modalOverlay = document.getElementById('modalOverlay');
        if (sortModal) sortModal.classList.add('show');
        if (modalOverlay) modalOverlay.classList.add('show');
    },

    closeSort() {
        const sortModal = document.getElementById('sortModal');
        const modalOverlay = document.getElementById('modalOverlay');
        if (sortModal) sortModal.classList.remove('show');
        if (modalOverlay) modalOverlay.classList.remove('show');
    },

    selectSort(type) {
        Assets.sort(type);
        UI.renderHoldings();
        UI.closeSort();
    }
};

// ==========================================
// TRADING - Trading Logic & Order Management
// ==========================================
const Trading = {
    getTriggerCashBalance(currency) {
        const asset = State.portfolioData.assets.find(a => a.code === currency);
        return asset ? (asset.aud_value || 0) : 0;
    },

    updateTriggerButtonBalances() {
        const audBalance = this.getTriggerCashBalance('AUD');
        const usdcBalance = this.getTriggerCashBalance('USDC');
        
        const audBtn = document.getElementById('triggerOptAUD');
        const usdcBtn = document.getElementById('triggerOptUSDC');
        
        if (audBtn) {
            const balanceEl = audBtn.querySelector('.balance');
            if (balanceEl) balanceEl.textContent = Assets.formatCurrency(audBalance);
        }
        
        if (usdcBtn) {
            const balanceEl = usdcBtn.querySelector('.balance');
            if (balanceEl) balanceEl.textContent = Assets.formatCurrency(usdcBalance);
        }
        
        const amountSliderLabel = document.getElementById('amountSliderLabel');
        if (amountSliderLabel) amountSliderLabel.textContent = `Amount (${State.selectedTriggerCash})`;
    },

    setTriggerCash(currency) {
        State.selectedTriggerCash = currency;
        
        const triggerOptAUD = document.getElementById('triggerOptAUD');
        const triggerOptUSDC = document.getElementById('triggerOptUSDC');
        if (triggerOptAUD) triggerOptAUD.classList.toggle('active', currency === 'AUD');
        if (triggerOptUSDC) triggerOptUSDC.classList.toggle('active', currency === 'USDC');
        
        const balance = this.getTriggerCashBalance(currency);
        const amountSliderLabel = document.getElementById('amountSliderLabel');
        if (amountSliderLabel) amountSliderLabel.textContent = `Amount (${currency})`;
        
        const balanceText = document.querySelector(`#triggerOpt${currency} .balance`);
        if (balanceText) balanceText.textContent = Assets.formatCurrency(balance);
        
        this.updateTriggerAmountSlider(0);
        
        Logger.log(`Selected ${currency} for trigger order. Balance: ${Assets.formatCurrency(balance)}`, 'info');
    },

    selectLimitType(type) {
        State.selectedLimitType = type;
        State.pendingTradeSide = type;
        
        const limitButtons = document.getElementById('limitButtons');
        const confirmLimitBtn = document.getElementById('confirmLimitBtn');
        const confirmBtnText = document.getElementById('confirmBtnText');
        
        if (limitButtons) limitButtons.classList.add('hidden');
        if (confirmLimitBtn) confirmLimitBtn.classList.remove('hidden');
        if (confirmBtnText) confirmBtnText.textContent = type === 'buy' ? 'Confirm Buy Trigger' : 'Confirm Sell Trigger';
        
        const triggerSliderSection = document.getElementById('triggerSliderSection');
        const amountSliderSection = document.getElementById('amountSliderSection');
        if (triggerSliderSection) triggerSliderSection.classList.remove('hidden');
        if (amountSliderSection) amountSliderSection.classList.remove('hidden');
        
        const confirmBtn = document.getElementById('confirmLimitBtn');
        if (confirmBtn) {
            if (type === 'buy') {
                confirmBtn.style.background = '#22c55e';
                confirmBtn.onmouseenter = () => confirmBtn.style.background = '#16a34a';
                confirmBtn.onmouseleave = () => confirmBtn.style.background = '#22c55e';
            } else {
                confirmBtn.style.background = '#ef4444';
                confirmBtn.onmouseenter = () => confirmBtn.style.background = '#dc2626';
                confirmBtn.onmouseleave = () => confirmBtn.style.background = '#ef4444';
            }
        }
        
        this.setTriggerConstraints(type);
        
        Logger.log(`Selected ${type} trigger`, 'info');
    },

    updateTriggerSlider(value) {
        State.triggerOffset = parseInt(value);
        this.updateTriggerDisplay();
    },

    updateTriggerAmountSlider(value) {
        State.triggerAmountPercent = parseInt(value);
        const balance = this.getTriggerCashBalance(State.selectedTriggerCash);
        const amount = (balance * State.triggerAmountPercent / 100).toFixed(2);
        
        const triggerAmountDisplay = document.getElementById('triggerAmountDisplay');
        const triggerAmountPercent = document.getElementById('triggerAmountPercent');
        const triggerAmountFill = document.getElementById('triggerAmountFill');
        
        if (triggerAmountDisplay) triggerAmountDisplay.textContent = `$${amount}`;
        if (triggerAmountPercent) triggerAmountPercent.textContent = State.triggerAmountPercent + '%';
        if (triggerAmountFill) triggerAmountFill.style.width = State.triggerAmountPercent + '%';
    },

    updateTriggerDisplay() {
        if (!State.selectedAsset) return;
        
        const currentPrice = State.selectedAsset.price || 0;
        const multiplier = 1 + (State.triggerOffset / 100);
        const triggerPrice = currentPrice * multiplier;
        
        const slider = document.getElementById('triggerSlider');
        if (!slider) return;
        
        const min = parseInt(slider.min);
        const max = parseInt(slider.max);
        const range = max - min;
        const percent = ((State.triggerOffset - min) / range) * 100;
        
        const triggerFill = document.getElementById('triggerFill');
        const triggerPriceEl = document.getElementById('triggerPrice');
        const triggerOffset = document.getElementById('triggerOffset');
        
        if (triggerFill) triggerFill.style.width = percent + '%';
        if (triggerPriceEl) triggerPriceEl.textContent = Assets.formatCurrency(triggerPrice);
        
        if (triggerOffset) {
            triggerOffset.textContent = (State.triggerOffset >= 0 ? '+' : '') + State.triggerOffset + '%';
            
            if (State.triggerOffset > 0) {
                triggerOffset.style.color = '#22c55e';
                triggerOffset.style.background = 'rgba(34, 197, 94, 0.15)';
            } else if (State.triggerOffset < 0) {
                triggerOffset.style.color = '#ef4444';
                triggerOffset.style.background = 'rgba(239, 68, 68, 0.15)';
            } else {
                triggerOffset.style.color = '#94a3b8';
                triggerOffset.style.background = 'rgba(148, 163, 184, 0.15)';
            }
        }
    },

    resetTrigger() {
        State.selectedLimitType = null;
        State.triggerOffset = 0;
        State.triggerAmountPercent = 0;
        State.pendingTradeSide = null;
        
        const limitButtons = document.getElementById('limitButtons');
        const confirmLimitBtn = document.getElementById('confirmLimitBtn');
        const triggerSliderSection = document.getElementById('triggerSliderSection');
        const amountSliderSection = document.getElementById('amountSliderSection');
        
        if (limitButtons) limitButtons.classList.remove('hidden');
        if (confirmLimitBtn) confirmLimitBtn.classList.add('hidden');
        if (triggerSliderSection) triggerSliderSection.classList.add('hidden');
        if (amountSliderSection) amountSliderSection.classList.add('hidden');
        
        const triggerSlider = document.getElementById('triggerSlider');
        const triggerAmountSlider = document.getElementById('triggerAmountSlider');
        if (triggerSlider) triggerSlider.value = 0;
        if (triggerAmountSlider) triggerAmountSlider.value = 0;
        
        this.updateTriggerDisplay();
        this.updateTriggerAmountSlider(0);
        
        const confirmBtn = document.getElementById('confirmLimitBtn');
        if (confirmBtn) {
            confirmBtn.style.background = '#3b82f6';
            confirmBtn.onmouseenter = null;
            confirmBtn.onmouseleave = null;
        }
        
        Logger.log('Reset trigger settings', 'info');
    },

    resetTriggerForm() {
        this.resetTrigger();
        API.refreshData();
    },

    async showConfirmModal() {
        if (!State.selectedAsset) {
            alert('No asset selected');
            return;
        }
        
        if (State.triggerAmountPercent === 0) {
            alert('Please select an amount');
            return;
        }
        
        // Fetch latest live rate before showing modal
        await API.fetchLiveRates();
        
        const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
        const multiplier = 1 + (State.triggerOffset / 100);
        let triggerPrice = realtimePrice * multiplier;
        
        // Determine correct order type based on trigger vs market price
        let orderType;
        if (State.selectedLimitType === 'buy') {
            if (triggerPrice > realtimePrice) {
                orderType = 'STOP_LIMIT_BUY';
            } else {
                orderType = 'LIMIT_BUY';
            }
        } else {
            if (triggerPrice < realtimePrice) {
                orderType = 'STOP_LIMIT_SELL';
            } else {
                orderType = 'LIMIT_SELL';
            }
        }
        
        const btn = document.getElementById('confirmLimitBtn');
        const spinner = document.getElementById('confirmSpinner');
        const text = document.getElementById('confirmBtnText');
        
        if (btn) btn.disabled = true;
        if (spinner) spinner.classList.remove('hidden');
        if (text) text.textContent = 'Loading...';
        
        const balance = this.getTriggerCashBalance(State.selectedTriggerCash);
        const amount = (balance * State.triggerAmountPercent / 100);
        
        const limitModalType = document.getElementById('limitModalType');
        const limitModalAsset = document.getElementById('limitModalAsset');
        const limitModalTrigger = document.getElementById('limitModalTrigger');
        const limitModalAmount = document.getElementById('limitModalAmount');
        const limitModalReceive = document.getElementById('limitModalReceive');
        
        if (limitModalType) {
            limitModalType.textContent = orderType.replace(/_/g, ' ');
            limitModalType.style.color = State.selectedLimitType === 'buy' ? '#22c55e' : '#ef4444';
        }
        if (limitModalAsset) limitModalAsset.textContent = State.selectedAsset.code;
        if (limitModalTrigger) limitModalTrigger.textContent = Assets.formatCurrency(triggerPrice);
        if (limitModalAmount) limitModalAmount.textContent = `$${amount.toFixed(2)} ${State.selectedTriggerCash}`;
        
        const receiveAmount = amount / triggerPrice;
        if (limitModalReceive) limitModalReceive.textContent = `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`;
        
        State.pendingOrderType = orderType;
        State.pendingTriggerPrice = triggerPrice;
        
        const limitConfirmModal = document.getElementById('limitConfirmModal');
        if (limitConfirmModal) limitConfirmModal.classList.add('show');
        
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (text) text.textContent = State.selectedLimitType === 'buy' ? 'Confirm Buy Trigger' : 'Confirm Sell Trigger';
    },

    closeLimitModal() {
        const limitConfirmModal = document.getElementById('limitConfirmModal');
        if (limitConfirmModal) limitConfirmModal.classList.remove('show');
    },

    executeLimitOrder: async function() {
        const btn = document.getElementById('limitModalExecuteBtn');
        if (!btn) return;
        
        const originalText = btn.textContent;
        
        btn.disabled = true;
        btn.textContent = 'Submitting...';
        
        try {
            const balance = this.getTriggerCashBalance(State.selectedTriggerCash);
            const amount = (balance * State.triggerAmountPercent / 100);
            const triggerPrice = parseFloat(State.pendingTriggerPrice.toFixed(2));
            const quantity = parseFloat((amount / triggerPrice).toFixed(8));
            
            const orderData = {
                primary: State.selectedAsset.code,
                secondary: State.selectedTriggerCash,
                quantity: quantity,
                assetQuantity: State.selectedAsset.code,
                orderType: State.pendingOrderType,
                trigger: triggerPrice
            };
            
            Logger.log(`Sending ${State.pendingOrderType} order:`, 'info');
            Logger.log(`Asset: ${orderData.primary}, Quantity: ${orderData.quantity}, Trigger: ${orderData.trigger}`, 'info');
            
            const res = await API.placeOrder(orderData);
            
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }
            
            const data = await res.json();
            
            Logger.log(`✅ Order placed! Order ID: ${data.id || data.orderId || 'N/A'}`, 'success');
            Logger.log(`Response: ${JSON.stringify(data).substring(0, 200)}`, 'info');
            
            const limitConfirmModal = document.getElementById('limitConfirmModal');
            const successModal = document.getElementById('successModal');
            if (limitConfirmModal) limitConfirmModal.classList.remove('show');
            if (successModal) successModal.classList.add('show');
            
            await API.refreshData();
            this.updateTriggerButtonBalances();
            
        } catch (error) {
            Logger.log(`❌ Order failed: ${error.message}`, 'error');
            alert('Order failed: ' + error.message);
            const limitConfirmModal = document.getElementById('limitConfirmModal');
            if (limitConfirmModal) limitConfirmModal.classList.remove('show');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
            this.resetTriggerForm();
        }
    },

    closeSuccessModal() {
        const successModal = document.getElementById('successModal');
        if (successModal) successModal.classList.remove('show');
    },

    setTriggerConstraints(side) {
        const slider = document.getElementById('triggerSlider');
        const labels = document.getElementById('triggerLabels');
        
        if (!slider) return;
        
        // Allow full range -20% to +20%, system will determine correct order type
        slider.min = -20;
        slider.max = 20;
        
        if (labels) labels.innerHTML = '<span>-20%</span><span>Market</span><span>+20%</span>';
        
        this.updateTriggerDisplay();
    },

    updateAutoTradeConstraints(side) {
        const slider = document.getElementById('autoDevSlider');
        const labels = document.getElementById('autoDevLabels');
        const guideText = document.getElementById('autoGuideText');
        
        if (!slider) return;
        
        slider.min = -20;
        slider.max = 20;
        
        if (labels) labels.innerHTML = '<span>-20%</span><span>Market</span><span>+20%</span>';
        
        if (guideText) {
            if (side === 'buy') {
                guideText.innerHTML = 'Set <span style="color: #22c55e;">positive %</span> for stop-buy, <span style="color: #ef4444;">negative %</span> for limit-buy';
            } else {
                guideText.innerHTML = 'Set <span style="color: #ef4444;">negative %</span> for stop-sell, <span style="color: #22c55e;">positive %</span> for limit-sell';
            }
        }
        
        this.updateAutoTradeDisplay();
    },

    updateAutoDevSlider(value) {
        State.autoTradeConfig.deviation = parseInt(value);
        this.updateAutoTradeDisplay();
    },

    updateAutoAllocSlider(value) {
        State.autoTradeConfig.allocation = parseInt(value);
        this.updateAutoTradeDisplay();
    },

    updateAutoTradeDisplay() {
        if (!State.selectedAsset) return;
        
        const currentPrice = State.selectedAsset.price || 0;
        const cashPrice = Assets.getPriceInCurrency(currentPrice, State.cashAsset);
        const multiplier = 1 + (State.autoTradeConfig.deviation / 100);
        const triggerPrice = cashPrice * multiplier;
        
        const slider = document.getElementById('autoDevSlider');
        if (!slider) return;
        
        const min = parseInt(slider.min);
        const max = parseInt(slider.max);
        const range = max - min;
        const percent = ((State.autoTradeConfig.deviation - min) / range) * 100;
        
        const autoDevFill = document.getElementById('autoDevFill');
        const autoPrice = document.getElementById('autoPrice');
        const autoDeviation = document.getElementById('autoDeviation');
        
        if (autoDevFill) autoDevFill.style.width = percent + '%';
        if (autoPrice) autoPrice.textContent = Assets.formatCurrency(triggerPrice);
        
        if (autoDeviation) {
            const devSign = State.autoTradeConfig.deviation >= 0 ? '+' : '';
            autoDeviation.textContent = `${devSign}${State.autoTradeConfig.deviation}%`;
            
            if (State.autoTradeConfig.deviation > 0) {
                autoDeviation.style.color = '#22c55e';
                autoDeviation.style.background = 'rgba(34, 197, 94, 0.15)';
            } else if (State.autoTradeConfig.deviation < 0) {
                autoDeviation.style.color = '#ef4444';
                autoDeviation.style.background = 'rgba(239, 68, 68, 0.15)';
            } else {
                autoDeviation.style.color = '#94a3b8';
                autoDeviation.style.background = 'rgba(148, 163, 184, 0.15)';
            }
        }
        
        const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
        const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;
        
        const autoAllocFill = document.getElementById('autoAllocFill');
        const autoAllocPercent = document.getElementById('autoAllocPercent');
        const autoAllocationValue = document.getElementById('autoAllocationValue');
        
        if (autoAllocFill) autoAllocFill.style.width = State.autoTradeConfig.allocation + '%';
        if (autoAllocPercent) autoAllocPercent.textContent = State.autoTradeConfig.allocation + '%';
        if (autoAllocationValue) autoAllocationValue.textContent = 
            `${State.autoTradeConfig.allocation}% of ${Assets.formatCurrency(cashBalance)} ${State.cashAsset}`;
    },

    resetAutoTrade() {
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        
        const autoDevSlider = document.getElementById('autoDevSlider');
        const autoAllocSlider = document.getElementById('autoAllocSlider');
        if (autoDevSlider) autoDevSlider.value = 0;
        if (autoAllocSlider) autoAllocSlider.value = 0;
        
        this.updateAutoTradeDisplay();
    },

    prepareTrade(side) {
        State.pendingTradeSide = side;
        
        if (!CONFIG.TRADE_PIN) {
            alert('Please set trading PIN in settings');
            const pinModal = document.getElementById('pinModal');
            if (pinModal) pinModal.classList.add('show');
            return;
        }
        
        if (State.orderType === 'trigger') {
            this.updateTriggerConstraints(side);
        } else if (State.orderType === 'auto') {
            this.updateAutoTradeConstraints(side);
        }
        
        if (State.orderType === 'trigger' && State.selectedLimitType === null) {
            return;
        }
        
        if (State.orderType !== 'auto' && State.amountSliderValue === 0 && State.orderType !== 'trigger') {
            alert('Please select an amount');
            return;
        }
        
        if (State.orderType === 'auto' && State.autoTradeConfig.allocation === 0) {
            alert('Please set portfolio allocation for auto trade');
            return;
        }
        
        if (!State.selectedAsset) return;
        
        UI.updateAmountDisplay();
        
        const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
        const assetBalance = State.selectedAsset.balance || 0;
        const currentAudPrice = State.selectedAsset.price;
        const cashPrice = Assets.getPriceInCurrency(currentAudPrice, State.cashAsset);
        
        Logger.log(`Preparing ${side.toUpperCase()} order - Type: ${State.orderType}, Cash: ${State.cashAsset}`, 'info');
        
        let amount, receiveAmount, triggerPrice;
        
        if (State.orderType === 'auto') {
            const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;
            const deviationMultiplier = 1 + (State.autoTradeConfig.deviation / 100);
            triggerPrice = cashPrice * deviationMultiplier;
            
            if (side === 'buy') {
                amount = allocationAmount;
                receiveAmount = triggerPrice > 0 ? amount / triggerPrice : 0;
            } else {
                const sellValue = allocationAmount;
                amount = sellValue / cashPrice;
                receiveAmount = sellValue;
            }
        } else if (side === 'buy') {
            amount = (State.amountSliderValue / 100) * cashBalance;
            let effectivePrice = cashPrice;
            
            if (State.orderType === 'trigger') {
                const offsetMultiplier = 1 + (State.triggerOffset / 100);
                effectivePrice = cashPrice * offsetMultiplier;
            }
            
            receiveAmount = effectivePrice > 0 ? amount / effectivePrice : 0;
            if (State.orderType === 'trigger') triggerPrice = effectivePrice;
        } else {
            const sellQuantity = (State.amountSliderValue / 100) * assetBalance;
            amount = sellQuantity;
            let effectivePrice = cashPrice;
            
            if (State.orderType === 'trigger') {
                const offsetMultiplier = 1 + (State.triggerOffset / 100);
                effectivePrice = cashPrice * offsetMultiplier;
            }
            
            receiveAmount = sellQuantity * effectivePrice;
            if (State.orderType === 'trigger') triggerPrice = effectivePrice;
        }
        
        const modalTitle = document.getElementById('tradeModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`;
            modalTitle.className = `trade-modal-title ${side}`;
        }
        
        const orderTypeDisplay = State.orderType === 'instant' ? 'Instant (Market)' : 
                               State.orderType === 'trigger' ? 'Trigger Order' : 
                               `Auto Trade (${State.autoTradeConfig.deviation >= 0 ? '+' : ''}${State.autoTradeConfig.deviation}%)`;
        
        const modalOrderType = document.getElementById('modalOrderType');
        const modalAsset = document.getElementById('modalAsset');
        if (modalOrderType) modalOrderType.textContent = orderTypeDisplay;
        if (modalAsset) modalAsset.textContent = State.selectedAsset.code;
        
        const modalAmount = document.getElementById('modalAmount');
        const modalReceive = document.getElementById('modalReceive');
        
        if (side === 'buy') {
            if (modalAmount) modalAmount.textContent = `${Assets.formatCurrency(amount)} ${State.cashAsset}`;
            if (modalReceive) modalReceive.textContent = `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`;
        } else {
            if (modalAmount) modalAmount.textContent = `${amount.toFixed(8)} ${State.selectedAsset.code}`;
            if (modalReceive) modalReceive.textContent = `${Assets.formatCurrency(receiveAmount)} ${State.cashAsset}`;
        }
        
        const triggerRow = document.getElementById('modalTriggerRow');
        if (triggerRow) {
            if ((State.orderType === 'trigger' || State.orderType === 'auto') && triggerPrice) {
                triggerRow.style.display = 'flex';
                const modalTrigger = document.getElementById('modalTrigger');
                if (modalTrigger) modalTrigger.textContent = Assets.formatCurrency(triggerPrice);
            } else {
                triggerRow.style.display = 'none';
            }
        }
        
        const confirmBtn = document.getElementById('modalConfirmBtn');
        if (confirmBtn) confirmBtn.className = `trade-modal-btn confirm ${side}`;
        
        const tradeModal = document.getElementById('tradeModal');
        if (tradeModal) tradeModal.classList.add('show');
    },

    cancelTrade() {
        const tradeModal = document.getElementById('tradeModal');
        if (tradeModal) tradeModal.classList.remove('show');
        State.pendingTradeSide = null;
    },

    confirmTrade: async function() {
        const side = State.pendingTradeSide;
        
        if (!side || !State.selectedAsset) {
            const tradeModal = document.getElementById('tradeModal');
            if (tradeModal) tradeModal.classList.remove('show');
            State.pendingTradeSide = null;
            return;
        }
        
        const tradeModal = document.getElementById('tradeModal');
        if (tradeModal) tradeModal.classList.remove('show');
        
        const btn = side === 'buy' ? document.getElementById('buyBtn') : document.getElementById('sellBtn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('spinning');
        }
        
        try {
            // Fetch live rates before placing order
            await API.fetchLiveRates();
            const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
            
            const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
            const assetBalance = State.selectedAsset.balance || 0;
            const cashPrice = Assets.getPriceInCurrency(realtimePrice, State.cashAsset);
            
            let orderData;
            let quantity, triggerPrice;
            
            if (State.orderType === 'auto') {
                const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;
                const deviationMultiplier = 1 + (State.autoTradeConfig.deviation / 100);
                triggerPrice = cashPrice * deviationMultiplier;
                
                // Determine order type based on trigger vs market
                let orderType;
                if (side === 'buy') {
                    orderType = triggerPrice > cashPrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY';
                } else {
                    orderType = triggerPrice < cashPrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL';
                }
                
                triggerPrice = parseFloat(triggerPrice.toFixed(2));
                
                if (side === 'buy') {
                    quantity = parseFloat((allocationAmount / triggerPrice).toFixed(8));
                } else {
                    quantity = parseFloat((allocationAmount / cashPrice).toFixed(8));
                }
                
                orderData = {
                    primary: State.selectedAsset.code,
                    secondary: State.cashAsset,
                    quantity: quantity,
                    assetQuantity: State.selectedAsset.code,
                    orderType: orderType,
                    trigger: triggerPrice
                };
            } else if (side === 'buy') {
                const cashAmount = (State.amountSliderValue / 100) * cashBalance;
                
                if (State.orderType === 'instant') {
                    quantity = parseFloat((cashAmount / cashPrice).toFixed(8));
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        orderType: 'MARKET_BUY',
                        assetQuantity: State.selectedAsset.code
                    };
                } else {
                    const offsetMultiplier = 1 + (State.triggerOffset / 100);
                    triggerPrice = cashPrice * offsetMultiplier;
                    
                    // Determine correct order type
                    const orderType = triggerPrice > cashPrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY';
                    triggerPrice = parseFloat(triggerPrice.toFixed(2));
                    
                    quantity = parseFloat((cashAmount / triggerPrice).toFixed(8));
                    
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: orderType,
                        trigger: triggerPrice
                    };
                }
            } else {
                const sellPercentage = State.amountSliderValue / 100;
                quantity = parseFloat((assetBalance * sellPercentage).toFixed(8));
                
                if (State.orderType === 'instant') {
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        orderType: 'MARKET_SELL',
                        assetQuantity: State.selectedAsset.code
                    };
                } else {
                    const offsetMultiplier = 1 + (State.triggerOffset / 100);
                    triggerPrice = cashPrice * offsetMultiplier;
                    
                    // Determine correct order type
                    const orderType = triggerPrice < cashPrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL';
                    triggerPrice = parseFloat(triggerPrice.toFixed(2));
                    
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: orderType,
                        trigger: triggerPrice
                    };
                }
            }
            
            Logger.log(`Sending ${side.toUpperCase()} order:`, 'info');
            
            const res = await API.placeOrder(orderData);
            
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }
            
            const data = await res.json();
            
            Logger.log(`✅ ${side.toUpperCase()} order placed successfully!`, 'success');
            
            if (State.orderType === 'instant') {
                State.amountSliderValue = 0;
                const amountSlider = document.getElementById('amountSlider');
                if (amountSlider) amountSlider.value = 0;
                UI.updateAmountSlider(0);
            }
            
            await API.refreshData();
            
            if (State.orderType === 'trigger') {
                this.updateTriggerButtonBalances();
            }
            
        } catch (error) {
            Logger.log(`❌ Trade failed: ${error.message}`, 'error');
            alert('Trade failed: ' + error.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('spinning');
            }
            if (State.orderType !== 'trigger') {
                State.pendingTradeSide = null;
            }
        }
    }
};

// ==========================================
// APP - Main Application Controller
// ==========================================
const App = {
    init() {
        UI.init();
        API.connect();
    },
    
    refreshData() {
        API.refreshData();
    },
    
    unlockTrading() {
        UI.unlockTrading();
    }
};

// ==========================================
// INITIALIZE
// ==========================================
window.addEventListener('load', () => {
    App.init();
});
