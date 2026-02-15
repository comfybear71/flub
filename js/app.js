// ==========================================
// APP - Entry Point
// ==========================================
import { API } from './api.js';
import { UI } from './ui.js';
import { Trading } from './trading.js';
import { Assets } from './assets.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
    UI.init();
    API.connect();
});

// ── Global bindings (called from inline HTML event handlers) ─────────────────
//
// ES modules are scoped — inline onclick="..." handlers need globals.
// Expose only what the HTML actually calls.

window.App      = { refreshData: () => API.refreshData() };
window.UI       = UI;
window.Trading  = Trading;
window.Assets   = Assets;
