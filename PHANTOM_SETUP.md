# Phantom Wallet + MongoDB Setup Guide

## Overview
This integration adds Phantom wallet login and MongoDB user tracking to the portfolio trader. Multiple users can share one trading pool, with fair allocation based on deposits.

## Architecture

### How It Works
1. User clicks **Connect** button → Phantom wallet popup
2. User signs a message to prove wallet ownership
3. Backend verifies signature → creates/updates MongoDB user record
4. User deposits USDC → allocation percentage calculated based on pool share
5. When pool executes a trade → all users get proportional share
6. New users only get allocation from trades AFTER they join

### MongoDB Collections

| Collection | Purpose | Key Fields |
|---|---|---|
| `users` | User accounts | walletAddress, allocation%, totalDeposited, holdings |
| `deposits` | Deposit history | userId, amount, txHash, timestamp |
| `trades` | Trade history | coin, type, amount, price, userAllocations |
| `withdrawals` | Withdrawal history | userId, amount, timestamp |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/user/register` | Register/login with wallet signature |
| GET | `/api/user/portfolio?wallet=...` | Get user's portfolio data |
| POST | `/api/deposit` | Record a deposit |
| POST | `/api/trade` | Record a pool trade |
| GET | `/api/users` | List all active users |
| GET | `/api/pool/allocations` | Get current pool allocations |

## Setup Steps

### 1. Set Up MongoDB Atlas (Free Tier)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account
3. Create a new cluster (M0 Free Tier)
4. Set up database access:
   - Create a database user with username/password
   - Add `0.0.0.0/0` to IP whitelist (for Vercel)
5. Get connection string:
   - Click **Connect** → **Connect your application**
   - Copy the connection string
   - Replace `<password>` with your database user password

Your connection string will look like:
```
mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

### 2. Add Environment Variables to Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add:
   - `MONGODB_URI` = your MongoDB connection string from step 1

### 3. Deploy

```bash
git add .
git commit -m "Add Phantom wallet + MongoDB user tracking"
git push
```

Vercel will automatically:
- Detect the Python API routes
- Install dependencies from `requirements.txt`
- Deploy both JS and Python serverless functions

### 4. Test

1. Open your deployed site
2. Click the **Connect** button in the header
3. Phantom wallet popup should appear
4. Approve the connection and sign the message
5. Your wallet address should appear in the header
6. User stats section should show below the portfolio chart

## Files

### New Files
- `js/phantom-wallet.js` - Wallet connection, signing, and session management
- `api/database.py` - MongoDB operations (CRUD for users, deposits, trades)
- `api/index.py` - Python API endpoints for user management
- `requirements.txt` - Python dependencies for Vercel
- `PHANTOM_SETUP.md` - This file

### Modified Files
- `index.html` - Added Phantom button, user stats section, install modal
- `js/app.js` - Initializes PhantomWallet on startup
- `js/ui.js` - Added `updateWalletStatus()` and `renderUserStats()` methods
- `css/styles.css` - Phantom button and user stats styling
- `vercel.json` - Routes for Python API endpoints
- `.gitignore` - Added Python cache files

## Troubleshooting

### "Phantom wallet not found"
- Install Phantom from https://phantom.app/
- Make sure you're using a supported browser (Chrome, Firefox, Brave, Edge)

### MongoDB connection errors
- Verify `MONGODB_URI` environment variable is set in Vercel
- Check IP whitelist includes `0.0.0.0/0`
- Verify database user credentials

### Signature verification fails
- This is normal if the message format changes
- Clear browser localStorage and reconnect
