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
    triggerAmountPercent: 0
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
        btn.classList.add('spinning');
        
        try {
            Logger.log('Fetching portfolio data...', 'info');
            
            const response = await fetch(CONFIG.API_URL);
            const data = await response.json();
            
            State.portfolioData.assets = data.assets
                .filter(asset => asset.code !== 'USD')
                .map(asset => ({
                    code: asset.code,
                    name: asset.name,
                    balance: parseFloat(asset.balance || 0),
                    aud_value: parseFloat(asset.aud_value || 0),
                    price: parseFloat(asset.aud_value || 0) / parseFloat(asset.balance || 1),
                    change_24h: parseFloat(asset.change_24h || 0),
                    asset_id: asset.asset_id
                }))
                .filter(a => a.balance > 0 || a.code === 'AUD' || a.code === 'USDC');
            
            Assets.sort(State.currentSort);
            
            UI.renderPortfolio();
            UI.renderHoldings();
            UI.updateLastUpdated();
            Logger.log(`Loaded ${State.portfolioData.assets.length} assets`, 'success');
            
        } catch (error) {
            Logger.log('Refresh error: ' + error.message, 'error');
        } finally {
            btn.classList.remove('spinning');
        }
    },

    async placeOrder(orderData) {
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
        return res;
    }
};

// ==========================================
// LOGGER - Activity Logging
// ==========================================
const Logger = {
    log(message, type = 'info') {
        const container = document.getElementById('log-container');
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
        document.getElementById(`check-${sortType}`).classList.remove('hidden');
        
        const labels = {
            'value': 'Sort: Value',
            'change': 'Sort: Change %',
            'name': 'Sort: Name',
            'balance': 'Sort: Balance'
        };
        document.getElementById('currentSortLabel').textContent = labels[sortType];
        
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
            document.getElementById('pinModal').classList.add('show');
        } else {
            CONFIG.TRADE_PIN = savedPin;
        }
    },

    unlockTrading() {
        const pinInput = document.getElementById('pinInput').value;
        const pinError = document.getElementById('pinError');
        const pinBtn = document.getElementById('pinBtn');
        
        pinBtn.disabled = true;
        pinBtn.textContent = 'Verifying...';
        
        if (pinInput.length >= 4) {
            CONFIG.TRADE_PIN = pinInput;
            localStorage.setItem('tradePin', pinInput);
            document.getElementById('pinModal').classList.remove('show');
            Logger.log('Trading unlocked', 'success');
        } else {
            pinError.classList.add('show');
            pinBtn.disabled = false;
            pinBtn.textContent = 'Unlock';
        }
    },

    updateStatus(status) {
        const el = document.getElementById('api-status');
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
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        document.getElementById('last-updated').textContent = `Last updated: ${time}`;
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
        
        document.getElementById('total-value').textContent = Assets.formatCurrency(total);
        document.getElementById('asset-count').textContent = cryptoAssets.length + ' assets';
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
        document.getElementById('amountSlider').value = 0;
        document.getElementById('triggerSlider').value = 0;
        document.getElementById('miniChartContainer').classList.remove('show');
        document.getElementById('chartToggleBtn').classList.remove('active');
        
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        document.getElementById('autoDevSlider').value = 0;
        document.getElementById('autoAllocSlider').value = 0;
        
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        
        document.getElementById('chartSection').classList.add('trading-open');
        document.getElementById('chartSlider').classList.add('slide-left');
        
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        event.currentTarget.classList.add('selected');
    },

    closeTradingView() {
        document.getElementById('chartSection').classList.remove('trading-open');
        document.getElementById('chartSlider').classList.remove('slide-left');
        document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        
        State.isMiniChartVisible = false;
        document.getElementById('miniChartContainer').classList.remove('show');
        document.getElementById('chartToggleBtn').classList.remove('active');
    },

    toggleMiniChart() {
        State.isMiniChartVisible = !State.isMiniChartVisible;
        const container = document.getElementById('miniChartContainer');
        const btn = document.getElementById('chartToggleBtn');
        
        if (State.isMiniChartVisible) {
            container.classList.add('show');
            btn.classList.add('active');
            if (State.selectedAsset) {
                this.renderMiniChart(CONFIG.ASSET_STYLES[State.selectedAsset.code].color);
            }
        } else {
            container.classList.remove('show');
            btn.classList.remove('active');
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
        document.getElementById('btnInstant').classList.toggle('active', type === 'instant');
        document.getElementById('btnTrigger').classList.toggle('active', type === 'trigger');
        document.getElementById('btnAuto').classList.toggle('active', type === 'auto');
        
        const amountSection = document.getElementById('amountSection');
        const triggerSection = document.getElementById('triggerSection');
        const autoSection = document.getElementById('autoSection');
        
        if (type === 'instant') {
            amountSection.classList.remove('hidden');
            triggerSection.classList.remove('show');
            autoSection.classList.remove('show');
        } else if (type === 'trigger') {
            amountSection.classList.add('hidden');
            triggerSection.classList.add('show');
            autoSection.classList.remove('show');
            Trading.resetTrigger();
        } else if (type === 'auto') {
            amountSection.classList.add('hidden');
            triggerSection.classList.remove('show');
            autoSection.classList.add('show');
        }
        
        State.triggerOffset = 0;
        State.autoTradeConfig.deviation = 0;
        document.getElementById('triggerSlider').value = 0;
        document.getElementById('autoDevSlider').value = 0;
        
        document.getElementById('triggerError').style.display = 'none';
        document.getElementById('autoError').style.display = 'none';
        
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        UI.updateAmountDisplay();
    },

    setCash(cash) {
        State.cashAsset = cash;
        document.getElementById('optAUD').classList.toggle('active', cash === 'AUD');
        document.getElementById('optUSDC').classList.toggle('active', cash === 'USDC');
        UI.updateAmountDisplay();
        Trading.updateAutoTradeDisplay();
        Trading.updateTriggerDisplay();
    },

    updateAmountSlider(value) {
        State.amountSliderValue = parseInt(value);
        document.getElementById('amountFill').style.width = State.amountSliderValue + '%';
        document.getElementById('amountPercent').textContent = State.amountSliderValue + '%';
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
        
        document.getElementById('amountValue').textContent = Assets.formatCurrency(displayAmount);
        document.getElementById('conversionText').textContent = conversionText;
    },

    toggleSort() {
        document.getElementById('sortModal').classList.add('show');
        document.getElementById('modalOverlay').classList.add('show');
    },

    closeSort() {
        document.getElementById('sortModal').classList.remove('show');
        document.getElementById('modalOverlay').classList.remove('show');
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
    setTriggerCash(currency) {
        State.selectedTriggerCash = currency;
        document.getElementById('triggerOptAUD').classList.toggle('active', currency === 'AUD');
        document.getElementById('triggerOptUSDC').classList.toggle('active', currency === 'USDC');
        document.getElementById('amountSliderLabel').textContent = `Amount (${currency})`;
        this.updateTriggerAmountSlider(0);
        Logger.log(`Selected ${currency} for limit order`, 'info');
    },

    selectLimitType(type) {
        State.selectedLimitType = type;
        State.pendingTradeSide = type;
        
        document.getElementById('limitButtons').classList.add('hidden');
        document.getElementById('confirmLimitBtn').classList.remove('hidden');
        document.getElementById('confirmBtnText').textContent = type === 'buy' ? 'Confirm Buy Limit' : 'Confirm Sell Limit';
        
        document.getElementById('triggerSliderSection').classList.remove('hidden');
        document.getElementById('amountSliderSection').classList.remove('hidden');
        
        const confirmBtn = document.getElementById('confirmLimitBtn');
        if (type === 'buy') {
            confirmBtn.style.background = '#22c55e';
            confirmBtn.onmouseenter = () => confirmBtn.style.background = '#16a34a';
            confirmBtn.onmouseleave = () => confirmBtn.style.background = '#22c55e';
            this.setTriggerConstraints('buy');
        } else {
            confirmBtn.style.background = '#ef4444';
            confirmBtn.onmouseenter = () => confirmBtn.style.background = '#dc2626';
            confirmBtn.onmouseleave = () => confirmBtn.style.background = '#ef4444';
            this.setTriggerConstraints('sell');
        }
        
        Logger.log(`Selected ${type} limit`, 'info');
    },

    updateTriggerSlider(value) {
        State.triggerOffset = parseInt(value);
        this.updateTriggerDisplay();
    },

    updateTriggerAmountSlider(value) {
        State.triggerAmountPercent = parseInt(value);
        const balance = State.selectedTriggerCash === 'AUD' ? 379.00 : 478.00;
        const amount = (balance * State.triggerAmountPercent / 100).toFixed(2);
        document.getElementById('triggerAmountDisplay').textContent = `$${amount}`;
        document.getElementById('triggerAmountPercent').textContent = State.triggerAmountPercent + '%';
        document.getElementById('triggerAmountFill').style.width = State.triggerAmountPercent + '%';
    },

    updateTriggerDisplay() {
        if (!State.selectedAsset) return;
        
        const currentPrice = State.selectedAsset.price || 0;
        const multiplier = 1 + (State.triggerOffset / 100);
        const triggerPrice = currentPrice * multiplier;
        const percent = ((State.triggerOffset + 20) / 40) * 100;
        
        document.getElementById('triggerFill').style.width = percent + '%';
        document.getElementById('triggerPrice').textContent = Assets.formatCurrency(triggerPrice);
        
        const offsetEl = document.getElementById('triggerOffset');
        offsetEl.textContent = (State.triggerOffset >= 0 ? '+' : '') + State.triggerOffset + '%';
        
        if (State.triggerOffset > 0) {
            offsetEl.style.color = '#22c55e';
            offsetEl.style.background = 'rgba(34, 197, 94, 0.15)';
        } else if (State.triggerOffset < 0) {
            offsetEl.style.color = '#ef4444';
            offsetEl.style.background = 'rgba(239, 68, 68, 0.15)';
        } else {
            offsetEl.style.color = '#94a3b8';
            offsetEl.style.background = 'rgba(148, 163, 184, 0.15)';
        }
    },

    resetTrigger() {
        State.selectedLimitType = null;
        State.triggerOffset = 0;
        State.triggerAmountPercent = 0;
        State.pendingTradeSide = null;
        
        document.getElementById('limitButtons').classList.remove('hidden');
        document.getElementById('confirmLimitBtn').classList.add('hidden');
        document.getElementById('triggerSliderSection').classList.add('hidden');
        document.getElementById('amountSliderSection').classList.add('hidden');
        
        document.getElementById('triggerSlider').value = 0;
        document.getElementById('triggerAmountSlider').value = 0;
        this.updateTriggerDisplay();
        this.updateTriggerAmountSlider(0);
        
        const confirmBtn = document.getElementById('confirmLimitBtn');
        confirmBtn.style.background = '#3b82f6';
        confirmBtn.onmouseenter = null;
        confirmBtn.onmouseleave = null;
        
        Logger.log('Reset trigger settings', 'info');
    },

    showConfirmModal() {
        const btn = document.getElementById('confirmLimitBtn');
        const spinner = document.getElementById('confirmSpinner');
        const text = document.getElementById('confirmBtnText');
        
        btn.disabled = true;
        spinner.classList.remove('hidden');
        text.textContent = 'Processing...';
        
        setTimeout(() => {
            const currentPrice = State.selectedAsset ? State.selectedAsset.price : 0;
            const multiplier = 1 + (State.triggerOffset / 100);
            const triggerPrice = currentPrice * multiplier;
            const balance = State.selectedTriggerCash === 'AUD' ? 379.00 : 478.00;
            const amount = (balance * State.triggerAmountPercent / 100);
            
            document.getElementById('limitModalType').textContent = State.selectedLimitType === 'buy' ? 'Buy Limit' : 'Sell Limit';
            document.getElementById('limitModalType').style.color = State.selectedLimitType === 'buy' ? '#22c55e' : '#ef4444';
            document.getElementById('limitModalAsset').textContent = State.selectedAsset ? State.selectedAsset.code : 'BTC';
            document.getElementById('limitModalTrigger').textContent = Assets.formatCurrency(triggerPrice);
            document.getElementById('limitModalAmount').textContent = `$${amount.toFixed(2)} ${State.selectedTriggerCash}`;
            
            const receiveAmount = amount / triggerPrice;
            document.getElementById('limitModalReceive').textContent = `${receiveAmount.toFixed(8)} ${State.selectedAsset ? State.selectedAsset.code : 'BTC'}`;
            
            document.getElementById('limitConfirmModal').classList.add('show');
            
            btn.disabled = false;
            spinner.classList.add('hidden');
            text.textContent = State.selectedLimitType === 'buy' ? 'Confirm Buy Limit' : 'Confirm Sell Limit';
        }, 500);
    },

    closeLimitModal() {
        document.getElementById('limitConfirmModal').classList.remove('show');
    },

    executeLimitOrder() {
        const btn = document.getElementById('limitModalExecuteBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting...';
        
        setTimeout(() => {
            document.getElementById('limitConfirmModal').classList.remove('show');
            document.getElementById('successModal').classList.add('show');
            btn.disabled = false;
            btn.textContent = 'Execute';
            this.resetTrigger();
        }, 800);
    },

    closeSuccessModal() {
        document.getElementById('successModal').classList.remove('show');
        UI.closeTradingView();
    },

    setTriggerConstraints(side) {
        const slider = document.getElementById('triggerSlider');
        const labels = document.getElementById('triggerLabels');
        
        if (side === 'buy') {
            slider.min = -20;
            slider.max = 0;
            if (parseInt(slider.value) > 0) {
                slider.value = 0;
                State.triggerOffset = 0;
            }
            labels.innerHTML = '<span>-20%</span><span>Current</span><span>0%</span>';
        } else {
            slider.min = 0;
            slider.max = 20;
            if (parseInt(slider.value) < 0) {
                slider.value = 0;
                State.triggerOffset = 0;
            }
            labels.innerHTML = '<span>0%</span><span>Current</span><span>+20%</span>';
        }
        
        this.updateTriggerDisplay();
    },

    updateAutoTradeConstraints(side) {
        const slider = document.getElementById('autoDevSlider');
        const labels = document.getElementById('autoDevLabels');
        const guideText = document.getElementById('autoGuideText');
        
        if (side === 'buy') {
            slider.min = -20;
            slider.max = 0;
            if (parseInt(slider.value) > 0) {
                slider.value = 0;
                State.autoTradeConfig.deviation = 0;
            }
            labels.innerHTML = '<span>-20%</span><span>Current</span><span>0%</span>';
            guideText.innerHTML = 'Set <span style="color: #ef4444;">negative %</span> to buy when price drops';
        } else {
            slider.min = 0;
            slider.max = 20;
            if (parseInt(slider.value) < 0) {
                slider.value = 0;
                State.autoTradeConfig.deviation = 0;
            }
            labels.innerHTML = '<span>0%</span><span>Current</span><span>+20%</span>';
            guideText.innerHTML = 'Set <span style="color: #22c55e;">positive %</span> to sell when price rises';
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
        const min = parseInt(slider.min);
        const max = parseInt(slider.max);
        const range = max - min;
        const percent = ((State.autoTradeConfig.deviation - min) / range) * 100;
        
        document.getElementById('autoDevFill').style.width = percent + '%';
        document.getElementById('autoPrice').textContent = Assets.formatCurrency(triggerPrice);
        
        const devEl = document.getElementById('autoDeviation');
        const devSign = State.autoTradeConfig.deviation >= 0 ? '+' : '';
        devEl.textContent = `${devSign}${State.autoTradeConfig.deviation}%`;
        
        if (State.autoTradeConfig.deviation > 0) {
            devEl.style.color = '#22c55e';
            devEl.style.background = 'rgba(34, 197, 94, 0.15)';
        } else if (State.autoTradeConfig.deviation < 0) {
            devEl.style.color = '#ef4444';
            devEl.style.background = 'rgba(239, 68, 68, 0.15)';
        } else {
            devEl.style.color = '#94a3b8';
            devEl.style.background = 'rgba(148, 163, 184, 0.15)';
        }
        
        const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
        const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;
        
        document.getElementById('autoAllocFill').style.width = State.autoTradeConfig.allocation + '%';
        document.getElementById('autoAllocPercent').textContent = State.autoTradeConfig.allocation + '%';
        document.getElementById('autoAllocationValue').textContent = 
            `${State.autoTradeConfig.allocation}% of ${Assets.formatCurrency(cashBalance)} ${State.cashAsset}`;
    },

    resetAutoTrade() {
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        document.getElementById('autoDevSlider').value = 0;
        document.getElementById('autoAllocSlider').value = 0;
        this.updateAutoTradeDisplay();
    },

    prepareTrade(side) {
        State.pendingTradeSide = side;
        
        if (!CONFIG.TRADE_PIN) {
            alert('Please set trading PIN in settings');
            document.getElementById('pinModal').classList.add('show');
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
            
            if (side === 'buy' && triggerPrice > cashPrice) {
                alert('Error: Buy trigger cannot exceed current price. Setting to current price.');
                triggerPrice = cashPrice;
                State.autoTradeConfig.deviation = 0;
                this.updateAutoTradeDisplay();
            } else if (side === 'sell' && triggerPrice < cashPrice) {
                alert('Error: Sell trigger cannot be below current price. Setting to current price.');
                triggerPrice = cashPrice;
                State.autoTradeConfig.deviation = 0;
                this.updateAutoTradeDisplay();
            }
            
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
                
                if (effectivePrice > cashPrice) {
                    alert('Error: Buy trigger cannot exceed current price. Please set to 0% or below.');
                    return;
                }
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
                
                if (effectivePrice < cashPrice) {
                    alert('Error: Sell trigger cannot be below current price. Please set to 0% or above.');
                    return;
                }
            }
            
            receiveAmount = sellQuantity * effectivePrice;
            if (State.orderType === 'trigger') triggerPrice = effectivePrice;
        }
        
        const modalTitle = document.getElementById('tradeModalTitle');
        modalTitle.textContent = `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`;
        modalTitle.className = `trade-modal-title ${side}`;
        
        const orderTypeDisplay = State.orderType === 'instant' ? 'Instant (Market)' : 
                               State.orderType === 'trigger' ? 'Trigger (Limit)' : 
                               `Auto Trade (${State.autoTradeConfig.deviation >= 0 ? '+' : ''}${State.autoTradeConfig.deviation}%)`;
        document.getElementById('modalOrderType').textContent = orderTypeDisplay;
        document.getElementById('modalAsset').textContent = State.selectedAsset.code;
        
        if (side === 'buy') {
            document.getElementById('modalAmount').textContent = `${Assets.formatCurrency(amount)} ${State.cashAsset}`;
            document.getElementById('modalReceive').textContent = `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`;
        } else {
            document.getElementById('modalAmount').textContent = `${amount.toFixed(8)} ${State.selectedAsset.code}`;
            document.getElementById('modalReceive').textContent = `${Assets.formatCurrency(receiveAmount)} ${State.cashAsset}`;
        }
        
        const triggerRow = document.getElementById('modalTriggerRow');
        if ((State.orderType === 'trigger' || State.orderType === 'auto') && triggerPrice) {
            triggerRow.style.display = 'flex';
            document.getElementById('modalTrigger').textContent = Assets.formatCurrency(triggerPrice);
        } else {
            triggerRow.style.display = 'none';
        }
        
        const confirmBtn = document.getElementById('modalConfirmBtn');
        confirmBtn.className = `trade-modal-btn confirm ${side}`;
        
        document.getElementById('tradeModal').classList.add('show');
    },

    cancelTrade() {
        document.getElementById('tradeModal').classList.remove('show');
        State.pendingTradeSide = null;
    },

    confirmTrade: async function() {
        const side = State.pendingTradeSide;
        
        if (!side || !State.selectedAsset) {
            document.getElementById('tradeModal').classList.remove('show');
            State.pendingTradeSide = null;
            return;
        }
        
        document.getElementById('tradeModal').classList.remove('show');
        
        const btn = side === 'buy' ? document.getElementById('buyBtn') : document.getElementById('sellBtn');
        
        btn.disabled = true;
        btn.classList.add('spinning');
        
        try {
            const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
            const assetBalance = State.selectedAsset.balance || 0;
            const currentAudPrice = State.selectedAsset.price;
            const cashPrice = Assets.getPriceInCurrency(currentAudPrice, State.cashAsset);
            
            let orderData;
            let quantity, triggerPrice;
            
            if (State.orderType === 'auto') {
                const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;
                const deviationMultiplier = 1 + (State.autoTradeConfig.deviation / 100);
                triggerPrice = parseFloat((cashPrice * deviationMultiplier).toFixed(2));
                
                if (side === 'buy' && triggerPrice > cashPrice) {
                    throw new Error('Buy trigger cannot exceed current market rate');
                }
                if (side === 'sell' && triggerPrice < cashPrice) {
                    throw new Error('Sell trigger cannot be below current market rate');
                }
                
                if (side === 'buy') {
                    quantity = parseFloat((allocationAmount / triggerPrice).toFixed(8));
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: 'LIMIT_BUY',
                        trigger: triggerPrice
                    };
                } else {
                    quantity = parseFloat((allocationAmount / cashPrice).toFixed(8));
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: 'LIMIT_SELL',
                        trigger: triggerPrice
                    };
                }
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
                    triggerPrice = parseFloat((cashPrice * offsetMultiplier).toFixed(2));
                    
                    if (triggerPrice > cashPrice) {
                        throw new Error('Buy trigger cannot exceed current market rate');
                    }
                    
                    quantity = parseFloat((cashAmount / triggerPrice).toFixed(8));
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: 'LIMIT_BUY',
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
                    triggerPrice = parseFloat((cashPrice * offsetMultiplier).toFixed(2));
                    
                    if (triggerPrice < cashPrice) {
                        throw new Error('Sell trigger cannot be below current market rate');
                    }
                    
                    orderData = {
                        primary: State.selectedAsset.code,
                        secondary: State.cashAsset,
                        quantity: quantity,
                        assetQuantity: State.selectedAsset.code,
                        orderType: 'LIMIT_SELL',
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
            
            const totalCash = side === 'buy' 
                ? (State.orderType === 'auto' ? (State.autoTradeConfig.allocation / 100) * cashBalance : (State.amountSliderValue / 100) * cashBalance)
                : orderData.quantity * cashPrice;
                
            Logger.log(`✅ ${side.toUpperCase()} order placed successfully!`, 'success');
            
            State.amountSliderValue = 0;
            document.getElementById('amountSlider').value = 0;
            UI.updateAmountSlider(0);
            
            if (State.orderType === 'auto') {
                this.resetAutoTrade();
            }
            
            setTimeout(() => {
                API.refreshData();
            }, 2000);
            
        } catch (error) {
            Logger.log(`❌ Trade failed: ${error.message}`, 'error');
            alert('Trade failed: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.classList.remove('spinning');
            State.pendingTradeSide = null;
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
