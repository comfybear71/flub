// ==========================================
// CONFIG - Constants & Configuration
// ==========================================
const CONFIG = {
    API_URL: 'https://portfolio-api-jade-delta.vercel.app/api/portfolio',
    TRADE_PIN: '',
    AUD_TO_USD_RATE: 0.65,
    ASSET_STYLES: {
        'BTC':  { color: '#f97316', icon: '₿',  name: 'Bitcoin' },
        'NEO':  { color: '#22c55e', icon: 'N',  name: 'NEO' },
        'ETH':  { color: '#6366f1', icon: 'E',  name: 'Ethereum' },
        'XRP':  { color: '#06b6d4', icon: 'X',  name: 'XRP' },
        'BCH':  { color: '#8b5cf6', icon: 'B',  name: 'Bitcoin Cash' },
        'BNB':  { color: '#eab308', icon: 'B',  name: 'Binance Coin' },
        'TRX':  { color: '#ef4444', icon: 'T',  name: 'TRON' },
        'SOL':  { color: '#a855f7', icon: 'S',  name: 'Solana' },
        'SUI':  { color: '#4ade80', icon: 'S',  name: 'Sui' },
        'LUNA': { color: '#ef4444', icon: 'L',  name: 'Terra' },
        'ENA':  { color: '#6b7280', icon: 'E',  name: 'Ethena' },
        'NEXO': { color: '#1a56db', icon: 'N',  name: 'Nexo' },
        'USDC': { color: '#22c55e', icon: '$',  name: 'USD Coin' },
        'ADA':  { color: '#3b82f6', icon: 'A',  name: 'Cardano' },
        'POL':  { color: '#8b5cf6', icon: 'P',  name: 'Polygon' },
        'DOGE': { color: '#eab308', icon: 'Ð',  name: 'Dogecoin' },
        'AUD':  { color: '#f59e0b', icon: 'A$', name: 'Australian Dollar' }
    },
    CODE_TO_ID: {
        'AUD':  1,  'BTC':  2,  'ETH':  3,  'XRP':  5,
        'ADA':  12, 'USD':  36, 'USDC': 53, 'DOGE': 73,
        'SOL':  130,'LUNA': 405,'LUNC': 406,'NEXO': 407,
        'SUI':  438,'ENA':  496,'POL':  569,'XAUT': 635
    }
};

// ==========================================
// STATE - Global Application State
// ==========================================
const State = {
    portfolioData: { assets: [] },
    selectedAsset: null,
    cashAsset: 'USDC',
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
    autoTradeConfig: { deviation: 0, allocation: 0 },
    selectedTriggerCash: 'USDC',
    selectedLimitType: null,
    triggerAmountPercent: 0,
    liveRates: {},
    pendingOrderType: null,
    pendingTriggerPrice: 0,
    pendingQuantity: 0,
    // Phantom wallet / user tracking
    userAllocation: 0,
    userHoldings: {},
    userDeposits: 0
};
