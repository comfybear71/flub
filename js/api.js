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

            // Split pipeline: normalize → update IDs → filter
            const normalized = assets
                .filter(asset => asset?.code !== 'USD')
                .map(_normalizeAsset);

            // Rebuild CODE_TO_ID from live Swyftx data so order IDs are always correct.
            for (const a of normalized) {
                if (a.code && a.asset_id != null) {
                    CONFIG.CODE_TO_ID[a.code] = a.asset_id;
                }
            }
            Logger.log('CODE_TO_ID updated: ' + JSON.stringify(CONFIG.CODE_TO_ID), 'info');

            State.portfolioData.assets = normalized
                .filter(a => a.balance > 0 || a.code === 'AUD' || a.code === 'USDC');

            Assets.sort(State.currentSort);
            UI.renderPortfolio();
            UI.renderHoldings();
            UI.updateLastUpdated();
            Logger.log(`Loaded ${State.portfolioData.assets.length} assets`, 'success');

            // Fetch pending orders in background
            this.fetchPendingOrders();

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

    async fetchPendingOrders() {
        try {
            // ── 1) Load locally-tracked trigger orders ──────────────────
            const localOrders = Trading.getLocalPendingOrders();

            // Map order type strings to numeric + buy/sell
            const TYPE_MAP = {
                'LIMIT_BUY': 3, 'LIMIT_SELL': 4, 'STOP_LIMIT_BUY': 5, 'STOP_LIMIT_SELL': 6,
                'MARKET_BUY': 1, 'MARKET_SELL': 2
            };

            const normalised = localOrders.map(o => {
                const ot       = typeof o.orderType === 'string' ? (TYPE_MAP[o.orderType] ?? 0) : parseInt(o.orderType ?? 0);
                const isBuy    = ot === 1 || ot === 3 || ot === 5;
                const trigger  = parseFloat(o.trigger ?? 0);
                const quantity = parseFloat(o.quantity ?? 0);
                const priCode  = o.priCode ?? 'USDC';

                // Current price in the same currency as the trigger
                const asset      = State.portfolioData.assets.find(a => a.code === o.assetCode);
                const currentPrice = priCode === 'AUD'
                    ? (asset?.price ?? 0)
                    : (asset?.usd_price ?? 0);

                const distance = currentPrice > 0 && trigger > 0
                    ? Math.abs(currentPrice - trigger) / currentPrice * 100
                    : 100;

                return {
                    id:           o.id ?? '',
                    orderType:    ot,
                    status:       0,   // 0 = locally tracked (pending)
                    isBuy,
                    assetCode:    o.assetCode ?? '',
                    priCode,
                    trigger,
                    quantity,
                    currentPrice,
                    distance:     Math.round(distance * 100) / 100,
                    created:      o.created ?? '',
                    local:        true
                };
            }).filter(o => o.trigger > 0);

            // ── 2) Also try Swyftx API for any server-side pending orders ─
            let apiOrders = [];
            try {
                await this._ensureToken();
                const openRes = await _fetchWithRetry('/api/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: '/orders/open', method: 'GET', authToken: State.jwtToken })
                });
                if (openRes.ok) {
                    const openData = await openRes.json();
                    if (!openData.error) {
                        const raw = Array.isArray(openData) ? openData : (openData.orders ?? []);
                        const idToCode = {};
                        for (const [code, id] of Object.entries(CONFIG.CODE_TO_ID)) {
                            idToCode[String(id)] = code;
                        }
                        apiOrders = raw.map(o => {
                            const ot = parseInt(o.order_type ?? o.orderType ?? 0);
                            const isBuy = ot === 1 || ot === 3 || ot === 5;
                            const secId = String(o.secondary_asset ?? '');
                            const priId = String(o.primary_asset ?? '');
                            const assetCode = idToCode[secId] ?? secId;
                            const priCode   = idToCode[priId] ?? priId;
                            const trigger   = parseFloat(o.trigger ?? 0);
                            const quantity  = parseFloat(o.quantity ?? 0);
                            const asset     = State.portfolioData.assets.find(a => a.code === assetCode);
                            const currentPrice = priCode === 'AUD' ? (asset?.price ?? 0) : (asset?.usd_price ?? 0);
                            const distance = currentPrice > 0 && trigger > 0
                                ? Math.abs(currentPrice - trigger) / currentPrice * 100 : 100;
                            return {
                                id: o.orderUuid ?? o.id ?? '', orderType: ot,
                                status: parseInt(o.status ?? 0), isBuy, assetCode, priCode,
                                trigger, quantity, currentPrice,
                                distance: Math.round(distance * 100) / 100,
                                created: o.created_time ?? '', local: false
                            };
                        }).filter(o => o.trigger > 0);
                    }
                }
            } catch (e) {
                Logger.log(`API pending orders check: ${e.message}`, 'info');
            }

            // ── 3) Merge: local + API (dedupe by id) ──────────────────
            const seen = new Set(apiOrders.map(o => o.id));
            const merged = [...apiOrders, ...normalised.filter(o => !seen.has(o.id))];

            State.pendingOrders = merged.sort((a, b) => a.distance - b.distance);

            Logger.log(`Pending orders: ${normalised.length} local + ${apiOrders.length} API = ${State.pendingOrders.length} total`, 'info');
            UI.renderPendingOrders();

        } catch (error) {
            Logger.log(`Pending orders error: ${error.message}`, 'error');
        }
    },

    async placeOrder(orderData) {
        Logger.log('─── ORDER DEBUG ───', 'info');
        Logger.log('Raw input: ' + JSON.stringify(orderData), 'info');

        // Convert string order types to Swyftx numeric values
        const normalised = _normaliseOrderData(orderData);

        Logger.log('Normalised: ' + JSON.stringify(normalised), 'info');
        Logger.log(`  primary=${normalised.primary} secondary=${normalised.secondary}`, 'info');
        Logger.log(`  quantity=${normalised.quantity} (type: ${typeof normalised.quantity})`, 'info');
        Logger.log(`  assetQuantity=${normalised.assetQuantity}`, 'info');
        Logger.log(`  orderType=${normalised.orderType} trigger=${normalised.trigger}`, 'info');
        Logger.log('API Request: POST /orders/', 'info');

        const res = await _fetchWithRetry('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: '/orders/',
                method: 'POST',
                body: normalised,
                authToken: State.jwtToken,
                pin: CONFIG.TRADE_PIN
            })
        });

        Logger.log(`API Response: ${res.status} ${res.statusText}`, res.ok ? 'success' : 'error');
        if (!res.ok) {
            // Clone before reading so callers can still read the original body
            const errorBody = await res.clone().text();
            Logger.log('Error response: ' + errorBody, 'error');
        }
        return res;
    }
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper — just a named alias so all API calls go through
 * one place. Does NOT retry on 429; retrying rate-limited requests only
 * makes the problem worse.
 */
async function _fetchWithRetry(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 429) {
        Logger.log('Rate limited (429) — wait a few seconds then tap refresh.', 'error');
    }
    return res;
}

// Swyftx expects orderType as an integer (1-6), quantity/trigger as strings,
// and primary/secondary/assetQuantity as string asset IDs.
const _ORDER_TYPE_MAP = {
    'MARKET_BUY':      1,
    'MARKET_SELL':     2,
    'LIMIT_BUY':       3,
    'LIMIT_SELL':      4,
    'STOP_LIMIT_BUY':  5,
    'STOP_LIMIT_SELL': 6
};

function _normaliseOrderData(data) {
    const out = { ...data };

    // orderType: string → integer
    if (typeof out.orderType === 'string' && _ORDER_TYPE_MAP[out.orderType] !== undefined) {
        out.orderType = _ORDER_TYPE_MAP[out.orderType];
    }

    // quantity & trigger: number → string (Swyftx expects strings)
    if (typeof out.quantity === 'number') out.quantity = String(out.quantity);
    if (typeof out.trigger === 'number')  out.trigger  = String(out.trigger);

    // primary / secondary / assetQuantity: convert codes → numeric IDs if possible
    if (typeof out.primary === 'string' && CONFIG.CODE_TO_ID[out.primary] !== undefined) {
        out.primary = String(CONFIG.CODE_TO_ID[out.primary]);
    }
    if (typeof out.secondary === 'string' && CONFIG.CODE_TO_ID[out.secondary] !== undefined) {
        out.secondary = String(CONFIG.CODE_TO_ID[out.secondary]);
    }
    if (typeof out.assetQuantity === 'string' && CONFIG.CODE_TO_ID[out.assetQuantity] !== undefined) {
        out.assetQuantity = String(CONFIG.CODE_TO_ID[out.assetQuantity]);
    }

    return out;
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
