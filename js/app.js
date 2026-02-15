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
// Expose to global scope for inline handlers
// ==========================================
window.App = App;
window.UI = UI;
window.Trading = Trading;
window.API = API;
window.Assets = Assets;
window.AutoTrader = AutoTrader;

// ==========================================
// INITIALIZE
// ==========================================
window.addEventListener('load', () => {
    App.init();
});
