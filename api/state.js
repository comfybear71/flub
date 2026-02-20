// ==========================================
// State Persistence API (Node.js + MongoDB)
// ==========================================
// Stores auto-trader config, cooldowns, trade log, and pending orders
// so they sync across iPad / iPhone / desktop.

import { MongoClient } from 'mongodb';

let cachedClient = null;

async function getDb() {
    let uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');

    // Auto-encode special chars in password (common Atlas gotcha)
    const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@.+)$/);
    if (match) {
        const rawPass = match[2];
        const encoded = encodeURIComponent(rawPass);
        if (rawPass !== encoded) {
            uri = match[1] + encoded + match[3];
        }
    }

    if (!cachedClient) {
        cachedClient = new MongoClient(uri, {
            maxPoolSize: 1,
            serverSelectionTimeoutMS: 10000
        });
        try {
            await cachedClient.connect();
        } catch (err) {
            cachedClient = null;  // Clear cache so next request retries
            throw err;
        }
    }
    return cachedClient.db('flub');
}

function debugUri() {
    const uri = process.env.MONGODB_URI || '';
    const m = uri.match(/:\/\/([^:]+):([^@]+)@/);
    return m ? { user: m[1], passLen: m[2].length, hasSpecial: /[^a-zA-Z0-9]/.test(m[2]), first3: m[2].substring(0, 3) } : { raw: uri.substring(0, 30) };
}

function isAdmin(wallet) {
    const admins = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean);
    return admins.includes(wallet);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Debug: check current URI after password change
        if (req.method === 'GET' && req.query.debug === '1') {
            return res.status(200).json(debugUri());
        }

        // ── GET: Load state ──
        if (req.method === 'GET') {
            const wallet = req.query.admin_wallet;
            if (!wallet || !isAdmin(wallet)) {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const db = await getDb();
            const doc = await db.collection('trader_state').findOne({ _id: 'admin_state' });

            if (!doc) {
                return res.status(200).json({
                    pendingOrders: [],
                    autoTiers: { tier1: { deviation: 2, allocation: 10 }, tier2: { deviation: 5, allocation: 5 } },
                    autoCooldowns: {},
                    autoTradeLog: []
                });
            }

            delete doc._id;
            return res.status(200).json(doc);
        }

        // ── POST: Save state (partial updates) ──
        if (req.method === 'POST') {
            const body = req.body || {};
            const wallet = body.adminWallet;
            if (!wallet || !isAdmin(wallet)) {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const allowedKeys = ['pendingOrders', 'enrichedOrders', 'autoTiers', 'autoCooldowns', 'autoTradeLog', 'autoActive', 'autoTierAssignments'];
            const update = {};
            for (const key of allowedKeys) {
                if (body[key] !== undefined) update[key] = body[key];
            }

            if (Object.keys(update).length === 0) {
                return res.status(400).json({ error: 'No valid state keys provided' });
            }

            const db = await getDb();
            await db.collection('trader_state').updateOne(
                { _id: 'admin_state' },
                { $set: update },
                { upsert: true }
            );

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('State API error:', error);
        return res.status(500).json({ error: error.message });
    }
}
