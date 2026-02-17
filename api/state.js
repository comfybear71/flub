// ==========================================
// State Persistence API (Node.js + MongoDB)
// ==========================================
// Stores auto-trader config, cooldowns, trade log, and pending orders
// so they sync across iPad / iPhone / desktop.

import { MongoClient } from 'mongodb';

let cachedClient = null;

async function getDb() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI not set');

    if (!cachedClient) {
        cachedClient = new MongoClient(uri, {
            maxPoolSize: 1,
            serverSelectionTimeoutMS: 10000
        });
        await cachedClient.connect();
    }
    return cachedClient.db('flub');
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
        // Temporary debug — remove after connection works
        if (req.method === 'GET' && req.query.debug === 'uri') {
            const uri = process.env.MONGODB_URI || '';
            // Show first 4 + last 4 chars of password only
            const match = uri.match(/:\/\/([^:]+):([^@]+)@(.+)/);
            if (match) {
                const user = match[1];
                const pass = match[2];
                const masked = pass.length > 8
                    ? pass.slice(0, 4) + '...' + pass.slice(-4)
                    : '****';
                return res.status(200).json({
                    user,
                    pass_hint: masked,
                    pass_length: pass.length,
                    host: match[3].substring(0, 40),
                    has_special_chars: /[^a-zA-Z0-9]/.test(pass)
                });
            }
            return res.status(200).json({ format: 'unexpected', first50: uri.substring(0, 50) });
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

            const allowedKeys = ['pendingOrders', 'autoTiers', 'autoCooldowns', 'autoTradeLog'];
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
