# ==========================================
# MongoDB Database Handler
# ==========================================
# Share-based (NAV) accounting for fair multi-user pools.
# Works like mutual fund / LP token math:
#   - Pool has total shares outstanding (stored in pool_state collection)
#   - NAV per share = totalPoolValue / totalShares
#   - On deposit: sharesIssued = depositAmount / currentNAV
#   - User value = userShares x currentNAV
#   - P&L = currentValue - totalDeposited
# ==========================================

import os
from datetime import datetime
from typing import Optional, Dict, List
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
import base58
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

# MongoDB connection
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
DB_NAME = "flub"

# Admin wallet addresses (set via env var, comma-separated)
ADMIN_WALLETS = [w.strip() for w in os.getenv("ADMIN_WALLETS", "").split(",") if w.strip()]

client = MongoClient(MONGODB_URI)
db = client[DB_NAME]

# Collections
users_collection = db["users"]
trades_collection = db["trades"]
deposits_collection = db["deposits"]
withdrawals_collection = db["withdrawals"]
trader_state_collection = db["trader_state"]
pool_state_collection = db["pool_state"]

# Create indexes
users_collection.create_index("walletAddress", unique=True)
trades_collection.create_index([("userId", 1), ("timestamp", -1)])
deposits_collection.create_index([("userId", 1), ("timestamp", -1)])
deposits_collection.create_index("txHash", unique=True)


def verify_wallet_signature(wallet_address: str, message: str, signature: List[int]) -> bool:
    """
    Verify that the signature was created by the wallet owner.
    Returns True if valid, False otherwise.
    """
    try:
        # Convert wallet address to public key
        public_key_bytes = base58.b58decode(wallet_address)
        verify_key = VerifyKey(public_key_bytes)

        # Convert signature to bytes
        signature_bytes = bytes(signature)
        message_bytes = message.encode('utf-8')

        # Verify signature
        verify_key.verify(message_bytes, signature_bytes)
        return True
    except (BadSignatureError, Exception) as e:
        print(f"Signature verification failed: {e}")
        return False


def register_user(wallet_address: str, signature: List[int] = None, message: str = None) -> Dict:
    """
    Register a new user or return existing user data.
    Optionally verifies wallet ownership via signature (if provided).
    """
    # Verify signature if provided
    if signature and message:
        if not verify_wallet_signature(wallet_address, message, signature):
            raise ValueError("Invalid signature")

    # Check if user exists
    existing_user = users_collection.find_one({"walletAddress": wallet_address})

    if existing_user:
        # Update last login
        users_collection.update_one(
            {"walletAddress": wallet_address},
            {"$set": {"lastLogin": datetime.utcnow()}}
        )
        return format_user_data(existing_user)

    # Create new user with shares field
    new_user = {
        "walletAddress": wallet_address,
        "shares": 0.0,
        "allocation": 0.0,
        "totalDeposited": 0.0,
        "totalWithdrawn": 0.0,
        "holdings": {},
        "joinedDate": datetime.utcnow(),
        "lastLogin": datetime.utcnow(),
        "isActive": True
    }

    try:
        users_collection.insert_one(new_user)
        return format_user_data(new_user)
    except DuplicateKeyError:
        existing_user = users_collection.find_one({"walletAddress": wallet_address})
        return format_user_data(existing_user)


def is_admin(wallet_address: str) -> bool:
    """Check if a wallet address belongs to an admin"""
    return wallet_address in ADMIN_WALLETS


def format_user_data(user: Dict) -> Dict:
    """Format user data for API response"""
    wallet = user["walletAddress"]
    return {
        "walletAddress": wallet,
        "role": "admin" if is_admin(wallet) else "user",
        "shares": user.get("shares", 0.0),
        "allocation": user.get("allocation", 0.0),
        "totalDeposited": user.get("totalDeposited", 0.0),
        "totalWithdrawn": user.get("totalWithdrawn", 0.0),
        "holdings": user.get("holdings", {}),
        "joinedDate": user.get("joinedDate").isoformat() if user.get("joinedDate") else None,
        "isActive": user.get("isActive", True)
    }


# ── Pool Share State ────────────────────────────────────────────────────────
# Single document in pool_state collection tracks totalShares for NAV math.

def get_pool_state() -> Dict:
    """Get pool share state (totalShares, initialized timestamp)"""
    doc = pool_state_collection.find_one({"_id": "pool"})
    if not doc:
        return {"totalShares": 0, "initialized": None}
    return {
        "totalShares": doc.get("totalShares", 0),
        "initialized": doc.get("initialized")
    }


def initialize_pool(total_pool_value: float) -> Dict:
    """
    Bootstrap pool shares. Called once when pool has value but no share data.
    Sets totalShares = totalPoolValue so NAV starts at $1.00/share.
    The project/admin implicitly owns all initial shares.
    """
    existing = pool_state_collection.find_one({"_id": "pool"})
    if existing:
        return {
            "success": True,
            "totalShares": existing["totalShares"],
            "nav": 1.0,
            "alreadyInitialized": True
        }

    pool_state_collection.insert_one({
        "_id": "pool",
        "totalShares": total_pool_value,
        "initialized": datetime.utcnow()
    })

    return {
        "success": True,
        "totalShares": total_pool_value,
        "nav": 1.0,
        "alreadyInitialized": False
    }


def get_nav(total_pool_value: float) -> float:
    """Calculate current NAV per share = totalPoolValue / totalShares"""
    pool = get_pool_state()
    total_shares = pool["totalShares"]
    if total_shares <= 0 or total_pool_value <= 0:
        return 1.0
    return total_pool_value / total_shares


# ── User Position ───────────────────────────────────────────────────────────

def get_user_position(wallet_address: str, total_pool_value: float) -> Dict:
    """
    Get a user's current position based on share-based accounting.
    Returns shares, NAV, currentValue, allocation%, totalDeposited.
    """
    user = users_collection.find_one({"walletAddress": wallet_address})
    if not user:
        return {
            "shares": 0, "nav": 1.0, "currentValue": 0,
            "allocation": 0, "totalDeposited": 0
        }

    pool = get_pool_state()
    total_shares = pool["totalShares"]
    user_shares = user.get("shares", 0.0)
    nav = total_pool_value / total_shares if total_shares > 0 else 1.0

    return {
        "shares": user_shares,
        "nav": nav,
        "currentValue": user_shares * nav,
        "allocation": (user_shares / total_shares * 100) if total_shares > 0 else 0,
        "totalDeposited": user.get("totalDeposited", 0.0)
    }


def get_user_portfolio(wallet_address: str) -> Optional[Dict]:
    """Get user's portfolio data including current value"""
    user = users_collection.find_one({"walletAddress": wallet_address})

    if not user:
        return None

    wallet = user["walletAddress"]
    return {
        "walletAddress": wallet,
        "role": "admin" if is_admin(wallet) else "user",
        "shares": user.get("shares", 0.0),
        "allocation": user.get("allocation", 0.0),
        "totalDeposited": user.get("totalDeposited", 0.0),
        "holdings": user.get("holdings", {}),
        "joinedDate": user.get("joinedDate").isoformat() if user.get("joinedDate") else None
    }


def get_user_deposits(wallet_address: str) -> List[Dict]:
    """Get all deposits for a user, sorted newest first"""
    cursor = deposits_collection.find(
        {"userId": wallet_address},
        {"_id": 0, "userId": 0}
    ).sort("timestamp", -1)

    deposits = []
    for doc in cursor:
        d = dict(doc)
        if "timestamp" in d and d["timestamp"]:
            d["timestamp"] = d["timestamp"].isoformat()
        deposits.append(d)
    return deposits


# ── Deposit with Share Issuance ─────────────────────────────────────────────

def record_deposit(wallet_address: str, amount: float, tx_hash: str,
                   total_pool_value: float, currency: str = "USDC") -> Dict:
    """
    Record a deposit and issue shares at the current NAV.

    total_pool_value: current USD value of all pool assets (from Swyftx).
                      This should be the value BEFORE the deposit is added,
                      or the deposit amount will be subtracted internally.
    """
    user = users_collection.find_one({"walletAddress": wallet_address})
    if not user:
        raise ValueError("User not found")

    # Ensure pool is initialized
    pool = get_pool_state()
    if pool["totalShares"] <= 0:
        initialize_pool(total_pool_value)
        pool = get_pool_state()

    # NAV before this deposit
    # If the deposit USDC is already reflected in pool value, subtract it
    pre_deposit_value = total_pool_value - amount
    if pre_deposit_value <= 0:
        nav = 1.0  # First-ever deposit
    else:
        nav = pre_deposit_value / pool["totalShares"]

    shares_issued = amount / nav

    # Record deposit with share data for audit trail
    deposit = {
        "userId": wallet_address,
        "amount": amount,
        "currency": currency,
        "txHash": tx_hash,
        "shares": shares_issued,
        "nav": nav,
        "timestamp": datetime.utcnow(),
        "status": "completed"
    }
    deposits_collection.insert_one(deposit)

    # Update pool totalShares
    pool_state_collection.update_one(
        {"_id": "pool"},
        {"$inc": {"totalShares": shares_issued}}
    )

    # Update user: add shares and deposited amount
    new_total_deposited = user.get("totalDeposited", 0.0) + amount
    new_shares = user.get("shares", 0.0) + shares_issued
    users_collection.update_one(
        {"walletAddress": wallet_address},
        {"$set": {
            "totalDeposited": new_total_deposited,
            "shares": new_shares
        }}
    )

    # Recalculate all user allocations from shares
    _recalculate_allocations()

    return {
        "success": True,
        "shares": shares_issued,
        "nav": nav,
        "totalShares": pool["totalShares"] + shares_issued,
        "newTotalDeposited": new_total_deposited,
        "userShares": new_shares
    }


def _recalculate_allocations():
    """
    Recalculate allocation % for all users based on their shares.
    allocation = (userShares / totalShares) * 100
    """
    pool = get_pool_state()
    total_shares = pool["totalShares"]
    if total_shares <= 0:
        return

    users = list(users_collection.find({"isActive": True, "shares": {"$gt": 0}}))
    for user in users:
        user_shares = user.get("shares", 0.0)
        allocation = (user_shares / total_shares) * 100.0
        users_collection.update_one(
            {"walletAddress": user["walletAddress"]},
            {"$set": {"allocation": allocation}}
        )


def record_trade(coin: str, trade_type: str, amount: float, price: float, user_allocations: Dict[str, float]) -> Dict:
    """
    Record a pool trade and distribute holdings to all active users
    based on their allocation percentage (derived from shares).

    user_allocations: {wallet_address: allocation_percent}
    """
    trade = {
        "coin": coin,
        "type": trade_type,  # 'buy' or 'sell'
        "amount": amount,
        "price": price,
        "timestamp": datetime.utcnow(),
        "userAllocations": user_allocations
    }

    trade_id = trades_collection.insert_one(trade).inserted_id

    # Update each user's holdings
    for wallet_address, allocation_pct in user_allocations.items():
        user_share = amount * (allocation_pct / 100.0)

        if trade_type == 'buy':
            users_collection.update_one(
                {"walletAddress": wallet_address},
                {"$inc": {f"holdings.{coin}": user_share}}
            )
        elif trade_type == 'sell':
            users_collection.update_one(
                {"walletAddress": wallet_address},
                {"$inc": {f"holdings.{coin}": -user_share}}
            )

    return {
        "success": True,
        "tradeId": str(trade_id),
        "usersUpdated": len(user_allocations)
    }


def get_all_active_users() -> List[Dict]:
    """Get all active users with their allocations"""
    users = users_collection.find({"isActive": True})
    return [format_user_data(user) for user in users]


def get_leaderboard(total_pool_value: float) -> List[Dict]:
    """
    Get leaderboard of all non-admin users ranked by current holdings value.
    Excludes admin wallets. Includes truncated wallet, date joined,
    last deposit info, total holdings value, and pool percentage.
    """
    pool = get_pool_state()
    total_shares = pool["totalShares"]
    nav = total_pool_value / total_shares if total_shares > 0 else 1.0

    # Get all active non-admin users with shares
    users = list(users_collection.find({
        "isActive": True,
        "walletAddress": {"$nin": ADMIN_WALLETS}
    }))

    leaderboard = []
    for user in users:
        wallet = user["walletAddress"]
        user_shares = user.get("shares", 0.0)
        current_value = user_shares * nav
        allocation = (user_shares / total_shares * 100) if total_shares > 0 else 0

        # Get last deposit for this user
        last_deposit = deposits_collection.find_one(
            {"userId": wallet},
            sort=[("timestamp", -1)]
        )

        leaderboard.append({
            "walletAddress": wallet,
            "walletShort": wallet[:4] + "..." + wallet[-4:],
            "joinedDate": user.get("joinedDate").isoformat() if user.get("joinedDate") else None,
            "lastDeposit": last_deposit["timestamp"].isoformat() if last_deposit and last_deposit.get("timestamp") else None,
            "lastDepositAmount": last_deposit.get("amount", 0) if last_deposit else 0,
            "totalDeposited": user.get("totalDeposited", 0.0),
            "currentValue": round(current_value, 2),
            "allocation": round(allocation, 2),
            "shares": user_shares
        })

    # Sort by current value descending
    leaderboard.sort(key=lambda x: x["currentValue"], reverse=True)

    # Add rank
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    return leaderboard


def get_admin_stats(total_pool_value: float) -> Dict:
    """
    Aggregated admin dashboard stats: ALL participants (including admin).
    Shows total pool data so the admin always sees real values.
    """
    pool = get_pool_state()
    total_shares = pool["totalShares"]
    nav = total_pool_value / total_shares if total_shares > 0 else 1.0

    # ALL active users (including admin)
    all_users = list(users_collection.find({"isActive": True}))
    all_user_count = len(all_users)

    # Total deposited by ALL users
    total_deposited = sum(u.get("totalDeposited", 0) for u in all_users)

    # Total current value held by ALL users
    total_value = sum(u.get("shares", 0) * nav for u in all_users)

    # Last deposit (anyone)
    last_dep = deposits_collection.find_one(
        sort=[("timestamp", -1)]
    )

    # Last user registration (anyone)
    last_user = users_collection.find_one(
        sort=[("joinedDate", -1)]
    )

    # Trade count (all)
    trade_count = trades_collection.count_documents({})

    # Deposit count (all)
    deposit_count = deposits_collection.count_documents({})

    # Withdrawal count (all)
    withdrawal_count = withdrawals_collection.count_documents({})

    # Raw collection document counts for diagnostics
    raw_counts = {
        "users": users_collection.count_documents({}),
        "deposits": deposits_collection.count_documents({}),
        "trades": trades_collection.count_documents({}),
        "withdrawals": withdrawals_collection.count_documents({}),
        "poolState": 1 if pool_state_collection.find_one({"_id": "pool"}) else 0,
        "traderState": 1 if trader_state_collection.find_one({"_id": "admin_state"}) else 0
    }

    return {
        "userCount": all_user_count,
        "totalUserDeposited": round(total_deposited, 2),
        "totalUserValue": round(total_value, 2),
        "poolValue": round(total_pool_value, 2),
        "nav": round(nav, 6),
        "totalShares": round(total_shares, 2),
        "tradeCount": trade_count,
        "depositCount": deposit_count,
        "withdrawalCount": withdrawal_count,
        "lastDeposit": last_dep["timestamp"].isoformat() if last_dep and last_dep.get("timestamp") else None,
        "lastDepositWallet": (last_dep.get("userId", "")[:4] + "..." + last_dep.get("userId", "")[-4:]) if last_dep and len(last_dep.get("userId", "")) > 8 else None,
        "lastDepositAmount": last_dep.get("amount", 0) if last_dep else 0,
        "lastUserJoined": last_user.get("joinedDate").isoformat() if last_user and last_user.get("joinedDate") else None,
        "pnlPercent": round(((total_value / total_deposited) - 1) * 100, 2) if total_deposited > 0 else 0,
        "dbCounts": raw_counts
    }


def get_all_transactions(wallet_address: str = None, is_admin_request: bool = False) -> List[Dict]:
    """
    Get transaction history.
    - If is_admin_request: returns ALL transactions (deposits, trades, withdrawals)
    - Otherwise: returns only the specified user's deposits/withdrawals
    """
    transactions = []

    if is_admin_request:
        # Get ALL deposits from all users
        for dep in deposits_collection.find({}).sort("timestamp", -1):
            user_wallet = dep.get("userId", "")
            transactions.append({
                "type": "deposit",
                "wallet": user_wallet,
                "walletShort": user_wallet[:4] + "..." + user_wallet[-4:] if len(user_wallet) > 8 else user_wallet,
                "amount": dep.get("amount", 0),
                "currency": dep.get("currency", "USDC"),
                "txHash": dep.get("txHash", ""),
                "timestamp": dep["timestamp"].isoformat() if dep.get("timestamp") else None,
                "shares": dep.get("shares", 0),
                "nav": dep.get("nav", 0),
                "isAdmin": user_wallet in ADMIN_WALLETS
            })

        # Get ALL trades
        for trade in trades_collection.find({}).sort("timestamp", -1):
            transactions.append({
                "type": "buy" if trade.get("type") == "buy" else "sell",
                "coin": trade.get("coin", ""),
                "amount": trade.get("amount", 0),
                "price": trade.get("price", 0),
                "timestamp": trade["timestamp"].isoformat() if trade.get("timestamp") else None,
                "wallet": "pool",
                "walletShort": "Pool Trade"
            })

        # Get ALL withdrawals
        for wd in withdrawals_collection.find({}).sort("timestamp", -1):
            user_wallet = wd.get("userId", "")
            transactions.append({
                "type": "withdrawal",
                "wallet": user_wallet,
                "walletShort": user_wallet[:4] + "..." + user_wallet[-4:] if len(user_wallet) > 8 else user_wallet,
                "amount": wd.get("amount", 0),
                "currency": wd.get("currency", "USDC"),
                "timestamp": wd["timestamp"].isoformat() if wd.get("timestamp") else None,
                "isAdmin": user_wallet in ADMIN_WALLETS
            })

        # Sort all by timestamp descending
        transactions.sort(key=lambda x: x.get("timestamp") or "", reverse=True)

    else:
        # User-specific: their deposits and withdrawals only
        if not wallet_address:
            return []

        for dep in deposits_collection.find({"userId": wallet_address}).sort("timestamp", -1):
            transactions.append({
                "type": "deposit",
                "amount": dep.get("amount", 0),
                "currency": dep.get("currency", "USDC"),
                "txHash": dep.get("txHash", ""),
                "timestamp": dep["timestamp"].isoformat() if dep.get("timestamp") else None,
                "shares": dep.get("shares", 0),
                "nav": dep.get("nav", 0)
            })

        for wd in withdrawals_collection.find({"userId": wallet_address}).sort("timestamp", -1):
            transactions.append({
                "type": "withdrawal",
                "amount": wd.get("amount", 0),
                "currency": wd.get("currency", "USDC"),
                "timestamp": wd["timestamp"].isoformat() if wd.get("timestamp") else None
            })

        transactions.sort(key=lambda x: x.get("timestamp") or "", reverse=True)

    return transactions


# ── Persistent Trader State ──────────────────────────────────────────────────
# Stores auto-trader config, cooldowns, trade log, and pending orders
# so they sync across devices (iPad / iPhone / desktop).

def get_trader_state() -> Dict:
    """Get the shared trader state document"""
    doc = trader_state_collection.find_one({"_id": "admin_state"})
    if not doc:
        return {
            "pendingOrders": [],
            "autoTiers": {"tier1": {"deviation": 2, "allocation": 10}, "tier2": {"deviation": 5, "allocation": 5}},
            "autoCooldowns": {},
            "autoTradeLog": []
        }
    # Remove MongoDB _id for JSON serialisation
    doc.pop("_id", None)
    return doc


def save_trader_state(state: Dict) -> Dict:
    """Save/update the shared trader state document"""
    trader_state_collection.update_one(
        {"_id": "admin_state"},
        {"$set": state},
        upsert=True
    )
    return {"success": True}


def sync_deposits_from_client(wallet_address: str, deposits: List[Dict], total_pool_value: float) -> Dict:
    """
    Import deposit records from client localStorage into MongoDB.
    Skips deposits that already exist (by txHash).
    Also ensures the user exists and updates their shares/totalDeposited.
    """
    # Auto-create user if needed
    user = users_collection.find_one({"walletAddress": wallet_address})
    if not user:
        register_user(wallet_address)
        user = users_collection.find_one({"walletAddress": wallet_address})

    # Ensure pool is initialized
    pool = get_pool_state()
    if pool["totalShares"] <= 0 and total_pool_value > 0:
        initialize_pool(total_pool_value)
        pool = get_pool_state()

    imported = 0
    skipped = 0
    total_new_shares = 0.0
    total_new_deposited = 0.0

    for dep in deposits:
        tx_hash = dep.get("txHash", "")
        amount = dep.get("amount", 0)
        if not tx_hash or amount <= 0:
            skipped += 1
            continue

        # Check if deposit already recorded
        existing = deposits_collection.find_one({"txHash": tx_hash})
        if existing:
            skipped += 1
            continue

        # Use the NAV from the original deposit if available, otherwise current
        nav = dep.get("nav", 1.0)
        shares = dep.get("shares", 0)
        if shares <= 0:
            shares = amount / nav if nav > 0 else amount

        deposit_doc = {
            "userId": wallet_address,
            "amount": amount,
            "currency": dep.get("currency", "USDC"),
            "txHash": tx_hash,
            "shares": shares,
            "nav": nav,
            "timestamp": datetime.utcnow(),
            "status": "completed",
            "source": "client_sync"
        }

        try:
            deposits_collection.insert_one(deposit_doc)
            total_new_shares += shares
            total_new_deposited += amount
            imported += 1
        except DuplicateKeyError:
            skipped += 1

    # Update user's shares and totalDeposited
    if total_new_shares > 0 or total_new_deposited > 0:
        users_collection.update_one(
            {"walletAddress": wallet_address},
            {"$inc": {
                "shares": total_new_shares,
                "totalDeposited": total_new_deposited
            }}
        )

        # Update pool totalShares
        pool_state_collection.update_one(
            {"_id": "pool"},
            {"$inc": {"totalShares": total_new_shares}}
        )

        # Recalculate all allocations
        _recalculate_allocations()

    return {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "newShares": total_new_shares,
        "newDeposited": total_new_deposited
    }


def get_db_debug() -> Dict:
    """
    Raw diagnostic dump of MongoDB collections.
    Shows document counts, sample data, and connection status.
    """
    try:
        # Test connection
        db.command("ping")
        connected = True
    except Exception as e:
        connected = False
        return {"connected": False, "error": str(e)}

    # Collection counts
    counts = {
        "users": users_collection.count_documents({}),
        "deposits": deposits_collection.count_documents({}),
        "trades": trades_collection.count_documents({}),
        "withdrawals": withdrawals_collection.count_documents({}),
        "pool_state": pool_state_collection.count_documents({}),
        "trader_state": trader_state_collection.count_documents({})
    }

    # Pool state
    pool_doc = pool_state_collection.find_one({"_id": "pool"})
    pool_info = {
        "totalShares": pool_doc.get("totalShares", 0) if pool_doc else None,
        "initialized": pool_doc.get("initialized").isoformat() if pool_doc and pool_doc.get("initialized") else None,
        "exists": pool_doc is not None
    }

    # Sample users (first 10, truncated wallets)
    sample_users = []
    for u in users_collection.find().limit(10):
        w = u.get("walletAddress", "")
        sample_users.append({
            "wallet": w[:6] + "..." + w[-4:] if len(w) > 10 else w,
            "shares": u.get("shares", 0),
            "totalDeposited": u.get("totalDeposited", 0),
            "allocation": u.get("allocation", 0),
            "isActive": u.get("isActive"),
            "joinedDate": u.get("joinedDate").isoformat() if u.get("joinedDate") else None
        })

    # Sample deposits (last 5)
    sample_deposits = []
    for d in deposits_collection.find().sort("timestamp", -1).limit(5):
        w = d.get("userId", "")
        sample_deposits.append({
            "wallet": w[:6] + "..." + w[-4:] if len(w) > 10 else w,
            "amount": d.get("amount", 0),
            "currency": d.get("currency"),
            "shares": d.get("shares", 0),
            "nav": d.get("nav", 0),
            "timestamp": d.get("timestamp").isoformat() if d.get("timestamp") else None
        })

    # Sample trades (last 5)
    sample_trades = []
    for t in trades_collection.find().sort("timestamp", -1).limit(5):
        sample_trades.append({
            "coin": t.get("coin"),
            "type": t.get("type"),
            "amount": t.get("amount", 0),
            "price": t.get("price", 0),
            "timestamp": t.get("timestamp").isoformat() if t.get("timestamp") else None
        })

    # ADMIN_WALLETS config
    admin_config = {
        "count": len(ADMIN_WALLETS),
        "wallets": [w[:6] + "..." + w[-4:] if len(w) > 10 else w for w in ADMIN_WALLETS]
    }

    # All collection names in the database
    all_collections = db.list_collection_names()

    return {
        "connected": connected,
        "database": DB_NAME,
        "collections": all_collections,
        "counts": counts,
        "poolState": pool_info,
        "adminConfig": admin_config,
        "sampleUsers": sample_users,
        "sampleDeposits": sample_deposits,
        "sampleTrades": sample_trades
    }


def calculate_pool_allocations() -> Dict[str, float]:
    """
    Calculate allocation percentages for all active users based on SHARES.
    Returns {wallet_address: allocation_percent}
    """
    pool = get_pool_state()
    total_shares = pool["totalShares"]

    if total_shares <= 0:
        return {}

    users = list(users_collection.find({"isActive": True, "shares": {"$gt": 0}}))

    if not users:
        return {}

    allocations = {}
    for user in users:
        user_shares = user.get("shares", 0.0)
        allocation_pct = (user_shares / total_shares) * 100.0
        allocations[user["walletAddress"]] = allocation_pct

        users_collection.update_one(
            {"walletAddress": user["walletAddress"]},
            {"$set": {"allocation": allocation_pct}}
        )

    return allocations
