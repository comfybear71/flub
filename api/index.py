# ==========================================
# API Routes - User, Deposit, Trade Endpoints
# ==========================================
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(__file__))

from database import (
    register_user,
    get_user_portfolio,
    record_deposit,
    record_trade,
    get_all_active_users,
    calculate_pool_allocations
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._send_cors_headers()
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        self._send_cors_headers()

        try:
            path = self.path.split('?')[0]
            params = self._parse_query_params()

            if path == '/api/user/portfolio':
                wallet = params.get('wallet')
                if not wallet:
                    self._send_json(400, {"error": "wallet parameter required"})
                    return

                portfolio = get_user_portfolio(wallet)
                if not portfolio:
                    self._send_json(404, {"error": "User not found"})
                    return

                self._send_json(200, portfolio)

            elif path == '/api/users':
                users = get_all_active_users()
                self._send_json(200, {"users": users, "count": len(users)})

            elif path == '/api/pool/allocations':
                allocations = calculate_pool_allocations()
                self._send_json(200, {"allocations": allocations})

            else:
                self._send_json(404, {"error": "Not found"})

        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_POST(self):
        self._send_cors_headers()

        try:
            path = self.path.split('?')[0]
            body = self._read_body()

            if path == '/api/user/register':
                wallet_address = body.get('walletAddress')
                signature = body.get('signature')
                message = body.get('message')

                if not all([wallet_address, signature, message]):
                    self._send_json(400, {"error": "walletAddress, signature, and message required"})
                    return

                user_data = register_user(wallet_address, signature, message)
                self._send_json(200, user_data)

            elif path == '/api/deposit':
                wallet_address = body.get('walletAddress')
                amount = body.get('amount')
                tx_hash = body.get('txHash')
                currency = body.get('currency', 'USDC')

                if not all([wallet_address, amount, tx_hash]):
                    self._send_json(400, {"error": "walletAddress, amount, and txHash required"})
                    return

                result = record_deposit(wallet_address, float(amount), tx_hash, currency)
                self._send_json(200, result)

            elif path == '/api/trade':
                coin = body.get('coin')
                trade_type = body.get('type')
                amount = body.get('amount')
                price = body.get('price')

                if not all([coin, trade_type, amount, price]):
                    self._send_json(400, {"error": "coin, type, amount, and price required"})
                    return

                # Get current allocations for all active users
                allocations = calculate_pool_allocations()

                if not allocations:
                    self._send_json(400, {"error": "No active users with deposits"})
                    return

                result = record_trade(coin, trade_type, float(amount), float(price), allocations)
                self._send_json(200, result)

            else:
                self._send_json(404, {"error": "Not found"})

        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def _read_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        return json.loads(body) if body else {}

    def _parse_query_params(self):
        params = {}
        if '?' in self.path:
            query_string = self.path.split('?')[1]
            for param in query_string.split('&'):
                if '=' in param:
                    key, value = param.split('=', 1)
                    params[key] = value
        return params
