// ==========================================
// API - All Network Requests
// ==========================================

// JWT token expiry — Swyftx tokens last ~1 hour, refresh every 50 minutes
const TOKEN_TTL_MS = 50 * 60 * 1000;
let _tokenExpiresAt = 0;

const API = {
    async connect() {
        UI.updateStatus('connecting');
        Logger.log('Connecting to Swyftx...', 'info');

        try {
            await this._ensureToken();
            Logger.log('Connected!', 'success');
            UI.updateStatus('connected');
            await this.refreshData();
            return true;

        } catch (error) {
            Logger.log(`Connection failed: ${error.message}`, 'error');
            UI.updateStatus('disconnected');
            const list = document.getElementById('holdings-list');
            if (list) list.innerHTML = `
                <div style="text-align:center;color:#64748b;padding:40px;">
                    Connection failed. Tap refresh to retry.
                </div>`;
            return false;
        }
    },

    // Only re-authenticates if the cached token is expired or missing
    async _ensureToken() {
        if (State.jwtToken && Date.now() < _tokenExpiresAt) {
            Logger.log('Using cached token', 'info');
            return;
        }

        Logger.log('Fetching new auth token...', 'info');
        const res = await _fetchWithRetry('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: '/auth/refresh/', method: 'POST' })
        });

        if (!res.ok) throw new Error(`Auth failed: HTTP ${res.status}`);
        const data = await res.json();
        if (!data.accessToken) throw new Error('No access token in response');

        State.jwtToken  = data.accessToken;
        _tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
        Logger.log('Token refreshed', 'success');
    },

    async refreshData() {
        const btn = document.getElementById('refreshBtn');
        btn?.classList.add('spinning');

        try {
            Logger.log('Fetching portfolio data...', 'info');

            const response = await _fetchWithRetry(CONFIG.API_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

            const data = await response.json();
            Logger.log('Portfolio data received: ' + JSON.stringify(data).substring(0, 200), 'info');

            const assets = _extractAssets(data);
            if (assets.length === 0) {
                throw new Error('No assets found in response: ' + JSON.stringify(data).substring(0, 100));
            }

            State.portfolioData.assets = assets
                .filter(asset => asset?.code !== 'USD')
                .map(_normalizeAsset)
                .filter(a => a.balance > 0 || a.code === 'AUD' || a.code === 'USDC');

            Assets.sort(State.currentSort);
            UI.renderPortfolio();
            UI.renderHoldings();
            UI.updateLastUpdated();
            Logger.log(`Loaded ${State.portfolioData.assets.length} assets`, 'success');

        } catch (error) {
            Logger.log(`Refresh error: ${error.message}`, 'error');
            const list = document.getElementById('holdings-list');
            if (list) list.innerHTML = `
                <div style="text-align:center;color:#ef4444;padding:40px;">
                    Error loading portfolio: ${error.message}<br>
                    <button onclick="App.refreshData()"
                        style="margin-top:20px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;">
                        Retry
                    </button>
                </div>`;
        } finally {
            btn?.classList.remove('spinning');
        }
    },

    getRealtimePrice(assetCode) {
        return State.portfolioData.assets.find(a => a.code === assetCode)?.usd_price ?? 0;
    },

    async placeOrder(orderData) {
        Logger.log('API Request: POST /orders/', 'info');
        Logger.log('Order data: ' + JSON.stringify(orderData), 'info');

        const res = await _fetchWithRetry('/api/proxy', {
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
 * fetch() wrapper that retries once on 429 (rate limit) after waiting
 * for the Retry-After header, or a default 5 second backoff.
 */
async function _fetchWithRetry(url, options = {}, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const res = await fetch(url, options);

        if (res.status !== 429) return res;

        if (attempt === maxRetries) {
            Logger.log('Rate limited by Swyftx API. Please wait a moment before retrying.', 'error');
            return res;
        }

        // Read Retry-After header if provided, otherwise back off 5s then 10s
        const retryAfter = res.headers.get('Retry-After');
        const waitMs     = retryAfter ? parseInt(retryAfter) * 1000 : attempt * 5000;

        Logger.log(`Rate limited (429). Retrying in ${waitMs / 1000}s...`, 'info');

        // Show a non-blocking status update
        const list = document.getElementById('holdings-list');
        if (list && list.querySelector('.retry-notice') === null) {
            const notice = document.createElement('div');
            notice.className = 'retry-notice';
            notice.style.cssText = 'text-align:center;color:#eab308;padding:12px;font-size:13px;';
            notice.textContent = `Rate limited — retrying in ${waitMs / 1000}s...`;
            list.prepend(notice);
        }

        await new Promise(resolve => setTimeout(resolve, waitMs));

        // Clean up notice
        document.querySelector('.retry-notice')?.remove();
    }
}

function _extractAssets(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.assets))        return data.assets;
    if (Array.isArray(data))               return data;
    if (Array.isArray(data.data?.assets))  return data.data.assets;
    if (Array.isArray(data.data))          return data.data;
    const fallback = Object.values(data).find(v => Array.isArray(v) && v.length > 0);
    return fallback ?? [];
}

function _normalizeAsset(asset) {
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
