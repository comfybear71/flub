// ==========================================
// API - All Network Requests
// ==========================================
import { CONFIG, State } from './config.js';
import { Logger } from './logger.js';
import { Assets } from './assets.js';

export const API = {
    async connect() {
        // UI.updateStatus is called via the UI module; import lazily to avoid circular deps
        const { UI } = await import('./ui.js');
        UI.updateStatus('connecting');
        Logger.log('Connecting to Swyftx...', 'info');

        try {
            const res = await fetch('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: '/auth/refresh/', method: 'POST' })
            });

            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

            const data = await res.json();

            if (!data.accessToken) throw new Error('No access token in response');

            State.jwtToken = data.accessToken;
            Logger.log('Connected!', 'success');
            UI.updateStatus('connected');
            await this.refreshData();
            return true;

        } catch (error) {
            Logger.log(`Connection failed: ${error.message}`, 'error');
            const { UI } = await import('./ui.js');
            UI.updateStatus('disconnected');
            const list = document.getElementById('holdings-list');
            if (list) {
                list.innerHTML = `<div style="text-align:center;color:#64748b;padding:40px;">
                    Connection failed. Tap refresh to retry.
                </div>`;
            }
            return false;
        }
    },

    async refreshData() {
        const btn = document.getElementById('refreshBtn');
        btn?.classList.add('spinning');

        try {
            Logger.log('Fetching portfolio data...', 'info');

            const response = await fetch(CONFIG.API_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

            const data = await response.json();
            Logger.log('Portfolio data received: ' + JSON.stringify(data).substring(0, 200), 'info');

            const assets = extractAssets(data);

            if (assets.length === 0) {
                throw new Error('No assets found in response: ' + JSON.stringify(data).substring(0, 100));
            }

            State.portfolioData.assets = assets
                .filter(asset => asset?.code !== 'USD')
                .map(normalizeAsset)
                .filter(a => a.balance > 0 || a.code === 'AUD' || a.code === 'USDC');

            const { UI } = await import('./ui.js');
            Assets.sort(State.currentSort);
            UI.renderPortfolio();
            UI.renderHoldings();
            UI.updateLastUpdated();
            Logger.log(`Loaded ${State.portfolioData.assets.length} assets`, 'success');

        } catch (error) {
            Logger.log(`Refresh error: ${error.message}`, 'error');
            const list = document.getElementById('holdings-list');
            if (list) {
                list.innerHTML = `
                    <div style="text-align:center;color:#ef4444;padding:40px;">
                        Error loading portfolio: ${error.message}<br>
                        <button onclick="App.refreshData()"
                            style="margin-top:20px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;">
                            Retry
                        </button>
                    </div>`;
            }
        } finally {
            btn?.classList.remove('spinning');
        }
    },

    /** Returns the current USD price for a given asset code from portfolio data. */
    getRealtimePrice(assetCode) {
        const asset = State.portfolioData.assets.find(a => a.code === assetCode);
        return asset?.usd_price ?? 0;
    },

    /** Places an order via the proxy API. Returns the raw Response for caller to handle. */
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

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Finds the assets array from whatever shape the API returns.
 * @param {*} data
 * @returns {Array}
 */
function extractAssets(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.assets))       return data.assets;
    if (Array.isArray(data))              return data;
    if (Array.isArray(data.data?.assets)) return data.data.assets;
    if (Array.isArray(data.data))         return data.data;

    // Last resort: use the first non-empty array value found
    const fallback = Object.values(data).find(v => Array.isArray(v) && v.length > 0);
    return fallback ?? [];
}

/**
 * Normalizes a raw asset object from the API into a consistent shape.
 * @param {object} asset
 * @returns {object}
 */
function normalizeAsset(asset) {
    const audValue = parseFloat(asset.aud_value ?? asset.value ?? 0);
    const balance  = parseFloat(asset.balance ?? 0);
    const audPrice = balance > 0 ? audValue / balance : 0;

    return {
        code:       asset.code ?? 'UNKNOWN',
        name:       asset.name ?? asset.code ?? 'Unknown',
        balance,
        aud_value:  audValue,
        usd_value:  audValue * CONFIG.AUD_TO_USD_RATE,
        price:      audPrice,
        usd_price:  audPrice * CONFIG.AUD_TO_USD_RATE,
        change_24h: parseFloat(asset.change_24h ?? asset.change ?? 0),
        asset_id:   asset.asset_id ?? asset.id
    };
}
