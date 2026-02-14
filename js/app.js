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
        'AUD': 1, 'BTC': 2, 'ETH': 3, 'XRP': 5, 'ADA': 12,
        'USD': 36, 'USDC': 53, 'DOGE': 73, 'SOL': 130,
        'LUNA': 405, 'LUNC': 406, 'NEXO': 407, 'SUI': 438,
        'ENA': 496, 'POL': 569, 'XAUT': 635
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
    pendingTradeSide: null, // 'buy' or 'sell' - now set FIRST
    currentSort: 'value',
    isMiniChartVisible: false,
    isConnected: false,
    portfolioChart: null,
    miniChart: null,
    autoTradeConfig: { deviation: 0, allocation: 0 }
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
                body: JSON.stringify({ endpoint: '/auth/refresh/', method: 'POST' })
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
        
        // Reset all trading state
        State.pendingTradeSide = null;
        State.amountSliderValue = 0;
        State.triggerOffset = 0;
        State.isMiniChartVisible = false;
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        
        // Reset UI
        document.getElementById('amountSlider').value = 0;
        document.getElementById('triggerSlider').value = 0;
        document.getElementById('autoDevSlider').value = 0;
        document.getElementById('autoAllocSlider').value = 0;
        document.getElementById('miniChartContainer').classList.remove('show');
        document.getElementById('chartToggleBtn').classList.remove('active');
        
        // Reset direction buttons
        document.getElementById('buyBtn').classList.remove('selected');
        document.getElementById('sellBtn').classList.remove('selected');
        
        // Hide config panel until direction selected
        document.getElementById('orderConfigPanel').classList.remove('show');
        
        this.updateAmountDisplay();
        Trading.updateTriggerDisplay();
        Trading.updateAutoTradeDisplay();
        
        // Show trading view
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
        
        // Reset trading state
        State.pendingTradeSide = null;
        document.getElementById('buyBtn').classList.remove('selected');
        document.getElementById('sellBtn').classList.remove('selected');
        document.getElementById('orderConfigPanel').classList.remove('show');
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
    }
};

// ==========================================
// UI Module (continued)
// ==========================================

UI.setOrderType = function(type) {
    State.orderType = type;
    document.getElementById('btnInstant').classList.toggle('active', type === 'instant');
    document.getElementById('btnTrigger').classList.toggle('active', type === 'trigger');
    document.getElementById('btnAuto').classList.toggle('active', type === 'auto');
    
    // Show/hide appropriate sections
    document.getElementById('triggerSection').classList.toggle('show', type === 'trigger');
    document.getElementById('autoSection').classList.toggle('show', type === 'auto');
    
    // Hide amount card when auto trade is selected
    const amountSection = document.getElementById('amountSection');
    if (type === 'auto') {
        amountSection.classList.add('hidden');
    } else {
        amountSection.classList.remove('hidden');
    }
    
    // Reset offsets when switching order types
    State.triggerOffset = 0;
    State.autoTradeConfig.deviation = 0;
    document.getElementById('triggerSlider').value = 0;
    document.getElementById('autoDevSlider').value = 0;
    
    // Reset error messages
    document.getElementById('triggerError').style.display = 'none';
    document.getElementById('autoError').style.display = 'none';
    
    // Re-apply direction constraints if direction is already selected
    if (State.pendingTradeSide) {
        if (type === 'trigger') {
            Trading.configureTriggerForDirection(State.pendingTradeSide);
        } else if (type === 'auto') {
            Trading.updateAutoTradeConstraints(State.pendingTradeSide);
        }
    }
    
    Trading.updateTriggerDisplay();
    Trading.updateAutoTradeDisplay();
    UI.updateAmountDisplay();
};

UI.setCash = function(cash) {
    State.cashAsset = cash;
    document.getElementById('optAUD').classList.toggle('active', cash === 'AUD');
    document.getElementById('optUSDC').classList.toggle('active', cash === 'USDC');
    UI.updateAmountDisplay();
    Trading.updateAutoTradeDisplay();
    Trading.updateTriggerDisplay();
    Trading.updateBalanceDisplay(); // Update balance display
};

UI.updateAmountSlider = function(value) {
    State.amountSliderValue = parseInt(value);
    document.getElementById('amountFill').style.width = State.amountSliderValue + '%';
    document.getElementById('amountPercent').textContent = State.amountSliderValue + '%';
    UI.updateAmountDisplay();
};

UI.updateAmountDisplay = function() {
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
};

UI.toggleSort = function() {
    document.getElementById('sortModal').classList.add('show');
    document.getElementById('modalOverlay').classList.add('show');
};

UI.closeSort = function() {
    document.getElementById('sortModal').classList.remove('show');
    document.getElementById('modalOverlay').classList.remove('show');
};

UI.selectSort = function(type) {
    Assets.sort(type);
    UI.renderHoldings();
    UI.closeSort();
};

// ==========================================
// TRADING - New Intuitive Trading Logic
// ==========================================
const Trading = {
    
    // Step 1: Select Buy or Sell direction
    selectDirection(direction) {
        // Check PIN first
        if (!CONFIG.TRADE_PIN) {
            document.getElementById('pinModal').classList.add('show');
            return;
        }
        
        State.pendingTradeSide = direction;
        
        // Update button states
        const buyBtn = document.getElementById('buyBtn');
        const sellBtn = document.getElementById('sellBtn');
        
        if (direction === 'buy') {
            buyBtn.classList.add('selected');
            sellBtn.classList.remove('selected');
            Logger.log('Buy mode selected', 'info');
        } else {
            sellBtn.classList.add('selected');
            buyBtn.classList.remove('selected');
            Logger.log('Sell mode selected', 'info');
        }
        
        // Show configuration panel
        document.getElementById('orderConfigPanel').classList.add('show');
        
        // Configure based on order type
        if (State.orderType === 'trigger') {
            this.configureTriggerForDirection(direction);
        } else if (State.orderType === 'auto') {
            this.updateAutoTradeConstraints(direction);
        }
        
        // Update displays
        this.updateBalanceDisplay();
        UI.updateAmountDisplay();
    },

    // Update balance display for selected currency
    updateBalanceDisplay() {
        const audBalance = State.portfolioData.assets.find(a => a.code === 'AUD')?.aud_value || 0;
        const usdcBalance = State.portfolioData.assets.find(a => a.code === 'USDC')?.aud_value || 0;
        
        document.getElementById('audBalanceDisplay').textContent = `AUD: ${Assets.formatCurrency(audBalance)}`;
        document.getElementById('usdcBalanceDisplay').textContent = `USDC: ${Assets.formatCurrency(usdcBalance)}`;
    },

    // Configure trigger slider for buy or sell
    configureTriggerForDirection(direction) {
        const slider = document.getElementById('triggerSlider');
        const container = document.getElementById('triggerSliderContainer');
        const guide = document.getElementById('triggerGuide');
        
        // Reset to center
        State.triggerOffset = 0;
        slider.value = 0;
        
        if (direction === 'buy') {
            // BUY: Can only set below market (negative)
            slider.min = -20;
            slider.max = 0;
            container.className = 'slider-box buy-mode';
            guide.innerHTML = '<span style="color: #ef4444;">← Drag left</span> to buy below market price';
        } else {
            // SELL: Can only set above market (positive)
            slider.min = 0;
            slider.max = 20;
            container.className = 'slider-box sell-mode';
            guide.innerHTML = 'Drag right to sell above market price <span style="color: #22c55e;">→</span>';
        }
        
        this.updateTriggerDisplay();
    },

    updateTriggerSlider(value) {
        State.triggerOffset = parseInt(value);
        this.updateTriggerDisplay();
    },

    updateTriggerDisplay() {
        if (!State.selectedAsset) return;
        
        const currentPrice = State.selectedAsset.price || 0;
        const cashPrice = Assets.getPriceInCurrency(currentPrice, State.cashAsset);
        const multiplier = 1 + (State.triggerOffset / 100);
        const triggerPrice = cashPrice * multiplier;
        
        const slider = document.getElementById('triggerSlider');
        const fill = document.getElementById('triggerFill');
        
        // Calculate position for visual fill
        const min = parseInt(slider.min);
        const max = parseInt(slider.max);
        const range = max - min;
        const percent = ((State.triggerOffset - min) / range) * 100;
        
        // Visual feedback: Color based on direction from center
        if (State.pendingTradeSide === 'buy') {
            // Buy: Fill from right (center) to left
            fill.style.width = (50 - percent/2) + '%';
            fill.style.left = 'auto';
            fill.style.right = '50%';
            fill.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
        } else if (State.pendingTradeSide === 'sell') {
            // Sell: Fill from center to right
            fill.style.width = (percent/2) + '%';
            fill.style.left = '50%';
            fill.style.right = 'auto';
            fill.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else {
            // No direction selected yet
            fill.style.width = '50%';
            fill.style.left = '0';
            fill.style.right = 'auto';
            fill.style.background = '#64748b';
        }
        
        document.getElementById('triggerPrice').textContent = Assets.formatCurrency(triggerPrice);
        
        const offsetEl = document.getElementById('triggerOffset');
        const sign = State.triggerOffset >= 0 ? '+' : '';
        offsetEl.textContent = `${sign}${State.triggerOffset}%`;
        
        if (State.triggerOffset < 0) {
            offsetEl.style.color = '#ef4444';
            offsetEl.style.background = 'rgba(239, 68, 68, 0.15)';
        } else if (State.triggerOffset > 0) {
            offsetEl.style.color = '#22c55e';
            offsetEl.style.background = 'rgba(34, 197, 94, 0.15)';
        } else {
            offsetEl.style.color = '#94a3b8';
            offsetEl.style.background = 'rgba(148, 163, 184, 0.15)';
        }
    },

    resetTrigger() {
        State.triggerOffset = 0;
        document.getElementById('triggerSlider').value = 0;
        this.updateTriggerDisplay();
    },

    updateAutoTradeConstraints(side) {
        const slider = document.getElementById('autoDevSlider');
        const guideText = document.getElementById('autoGuideText');
        
        if (side === 'buy') {
            slider.min = -20;
            slider.max = 0;
            if (parseInt(slider.value) > 0) {
                slider.value = 0;
                State.autoTradeConfig.deviation = 0;
            }
            guideText.innerHTML = 'Set <span style="color: #ef4444;">negative %</span> to buy when price drops';
        } else {
            slider.min = 0;
            slider.max = 20;
            if (parseInt(slider.value) < 0) {
                slider.value = 0;
                State.autoTradeConfig.deviation = 0;
            }
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

    // Step 4: Review and prepare order
    reviewOrder() {
        if (!State.pendingTradeSide) {
            alert('Please select Buy or Sell first');
            return;
        }
        
        if (State.orderType !== 'auto' && State.amountSliderValue === 0) {
            alert('Please select an amount');
            return;
        }
        
        if (State.orderType === 'auto' && State.autoTradeConfig.allocation === 0) {
            alert('Please set portfolio allocation for auto trade');
            return;
        }
        
        if (!State.selectedAsset) return;
        
        const cashBalance = State.portfolioData.assets.find(a => a.code === State.cashAsset)?.aud_value || 0;
        const assetBalance = State.selectedAsset.balance || 0;
        const currentAudPrice = State.selectedAsset.price;
        const cashPrice = Assets.getPriceInCurrency(currentAudPrice, State.cashAsset);
        
        const side = State.pendingTradeSide;
        let amount, receiveAmount, triggerPrice, orderTypeDisplay;
        
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
            orderTypeDisplay = `Auto (${State.autoTradeConfig.deviation >= 0 ? '+' : ''}${State.autoTradeConfig.deviation}%)`;
        } else if (side === 'buy') {
            amount = (State.amountSliderValue / 100) * cashBalance;
            let effectivePrice = cashPrice;
            
            if (State.orderType === 'trigger') {
                const offsetMultiplier = 1 + (State.triggerOffset / 100);
                effectivePrice = cashPrice * offsetMultiplier;
            }
            
            receiveAmount = effectivePrice > 0 ? amount / effectivePrice : 0;
            triggerPrice = effectivePrice;
            orderTypeDisplay = State.orderType === 'instant' ? 'Instant (Market)' : 'Limit Order';
        } else {
            const sellQuantity = (State.amountSliderValue / 100) * assetBalance;
            amount = sellQuantity;
            let effectivePrice = cashPrice;
            
            if (State.orderType === 'trigger') {
                const offsetMultiplier = 1 + (State.triggerOffset / 100);
                effectivePrice = cashPrice * offsetMultiplier;
            }
            
            receiveAmount = sellQuantity * effectivePrice;
            triggerPrice = effectivePrice;
            orderTypeDisplay = State.orderType === 'instant' ? 'Instant (Market)' : 'Limit Order';
        }
        
        // Populate and show modal
        const modalTitle = document.getElementById('tradeModalTitle');
        modalTitle.textContent = `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`;
        modalTitle.className = `trade-modal-title ${side}`;
        
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
        if (State.orderType === 'trigger' || State.orderType === 'auto') {
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
    },

    // Step 5: Execute order
    async confirmTrade() {
        const side = State.pendingTradeSide;
        
        if (!side || !State.selectedAsset) {
            document.getElementById('tradeModal').classList.remove('show');
            return;
        }
        
        document.getElementById('tradeModal').classList.remove('show');
        
        const btn = document.getElementById('reviewOrderBtn');
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
            Logger.log(`${orderData.orderType}, Qty: ${orderData.quantity}, Trigger: ${orderData.trigger || 'N/A'}`, 'info');
            
            const res = await API.placeOrder(orderData);
            
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }
            
            const totalCash = side === 'buy' 
                ? (State.orderType === 'auto' ? (State.autoTradeConfig.allocation / 100) * cashBalance : (State.amountSliderValue / 100) * cashBalance)
                : orderData.quantity * cashPrice;
                
            Logger.log(`✅ ${side.toUpperCase()} order placed!`, 'success');
            Logger.log(`${orderData.quantity} ${State.selectedAsset.code} ≈ $${totalCash.toFixed(2)}`, 'trade');
            
            // Reset form
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
