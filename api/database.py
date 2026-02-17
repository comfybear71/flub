# ==========================================
# MongoDB Database Handler
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

# Create indexes
users_collection.create_index("walletAddress", unique=True)
trades_collection.create_index([("userId", 1), ("timestamp", -1)])
deposits_collection.create_index([("userId", 1), ("timestamp", -1)])


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


def register_user(wallet_address: str, signature: List[int], message: str) -> Dict:
    """
    Register a new user or return existing user data.
    Verifies wallet ownership via signature.
    """
    # Verify signature
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

    # Create new user
    new_user = {
        "walletAddress": wallet_address,
        "allocation": 0.0,  # % of pool they own
        "totalDeposited": 0.0,
        "totalWithdrawn": 0.0,
        "holdings": {},  # {coin: amount} - coins acquired after joining
        "joinedDate": datetime.utcnow(),
        "lastLogin": datetime.utcnow(),
        "isActive": True
    }

    try:
        users_collection.insert_one(new_user)
        return format_user_data(new_user)
    except DuplicateKeyError:
        # Race condition - user was created between check and insert
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
        "allocation": user.get("allocation", 0.0),
        "totalDeposited": user.get("totalDeposited", 0.0),
        "totalWithdrawn": user.get("totalWithdrawn", 0.0),
        "holdings": user.get("holdings", {}),
        "joinedDate": user.get("joinedDate").isoformat() if user.get("joinedDate") else None,
        "isActive": user.get("isActive", True)
    }


def get_user_portfolio(wallet_address: str) -> Optional[Dict]:
    """Get user's portfolio data including current value"""
    user = users_collection.find_one({"walletAddress": wallet_address})

    if not user:
        return None

    # Calculate current value based on holdings and current prices
    # This will be enhanced when we add real-time price tracking
    current_value = user.get("totalDeposited", 0.0)  # Placeholder

    wallet = user["walletAddress"]
    return {
        "walletAddress": wallet,
        "role": "admin" if is_admin(wallet) else "user",
        "allocation": user.get("allocation", 0.0),
        "totalDeposited": user.get("totalDeposited", 0.0),
        "currentValue": current_value,
        "holdings": user.get("holdings", {}),
        "joinedDate": user.get("joinedDate").isoformat() if user.get("joinedDate") else None
    }


def record_deposit(wallet_address: str, amount: float, tx_hash: str, currency: str = "USDC") -> Dict:
    """Record a user deposit and update their allocation"""
    user = users_collection.find_one({"walletAddress": wallet_address})

    if not user:
        raise ValueError("User not found")

    # Record deposit
    deposit = {
        "userId": wallet_address,
        "amount": amount,
        "currency": currency,
        "txHash": tx_hash,
        "timestamp": datetime.utcnow(),
        "status": "completed"
    }
    deposits_collection.insert_one(deposit)

    # Update user's total deposited
    new_total = user.get("totalDeposited", 0.0) + amount

    # Calculate new allocation (simplified - will need total pool value)
    # For now, just update the deposited amount
    users_collection.update_one(
        {"walletAddress": wallet_address},
        {
            "$set": {"totalDeposited": new_total},
            "$inc": {"allocation": 0.0}  # Recalculate based on pool size
        }
    )

    return {
        "success": True,
        "depositId": str(deposit["_id"]),
        "newTotal": new_total
    }


def record_trade(coin: str, trade_type: str, amount: float, price: float, user_allocations: Dict[str, float]) -> Dict:
    """
    Record a pool trade and distribute holdings to all active users
    based on their allocation percentage.

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
            # Add to user's holdings
            users_collection.update_one(
                {"walletAddress": wallet_address},
                {"$inc": {f"holdings.{coin}": user_share}}
            )
        elif trade_type == 'sell':
            # Subtract from user's holdings
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


def calculate_pool_allocations() -> Dict[str, float]:
    """
    Calculate allocation percentages for all active users
    Returns {wallet_address: allocation_percent}
    """
    users = list(users_collection.find({"isActive": True}))

    if not users:
        return {}

    total_deposited = sum(user.get("totalDeposited", 0.0) for user in users)

    if total_deposited == 0:
        return {}

    allocations = {}
    for user in users:
        user_deposit = user.get("totalDeposited", 0.0)
        allocation_pct = (user_deposit / total_deposited) * 100.0
        allocations[user["walletAddress"]] = allocation_pct

        # Update user's allocation in database
        users_collection.update_one(
            {"walletAddress": user["walletAddress"]},
            {"$set": {"allocation": allocation_pct}}
        )

    return allocations
