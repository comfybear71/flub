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
