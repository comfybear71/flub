// ==========================================
// TRADING - Trading Logic & Order Management
// ==========================================
const Trading = {

    // ── Trigger balance helpers ───────────────────────────────────────────────

    getTriggerCashBalance(currency) {
        return State.portfolioData.assets.find(a => a.code === currency)?.usd_value ?? 0;
    },

    updateTriggerButtonBalances() {
        const label = document.getElementById('amountSliderLabel');
        if (!label) return;
        if (State.selectedLimitType === 'buy') {
            const usdcBal = this.getTriggerCashBalance('USDC');
            label.textContent = `USDC to spend (${Assets.formatCurrency(usdcBal)} available)`;
        } else if (State.selectedLimitType === 'sell' && State.selectedAsset) {
            const assetBal = State.selectedAsset.balance || 0;
            label.textContent = `${State.selectedAsset.code} to sell (${Assets.formatNumber(assetBal)} available)`;
        }
    },

    // ── Limit type selection ─────────────────────────────────────────────────

    /**
     * Called when user taps "Buy Dip" or "Sell Rise".
     * buy  → slider -30% to 0   (price below market only)
     * sell → slider 0   to +30% (price above market only)
     */
    selectLimitType(type) {
        State.selectedLimitType = type;
        State.pendingTradeSide  = type;
        State.triggerOffset     = type === 'buy' ? -5 : 5;

        document.getElementById('limitButtons')?.classList.add('hidden');
        document.getElementById('triggerConfig')?.classList.remove('hidden');

        const badge = document.getElementById('triggerDirectionBadge');
        if (badge) {
            badge.textContent        = type === 'buy' ? '\u2193 Buy Dip' : '\u2191 Sell Rise';
            badge.style.color        = type === 'buy' ? '#22c55e' : '#ef4444';
            badge.style.background   = type === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
        }

        const slider = document.getElementById('triggerSlider');
        if (slider) {
            slider.min   = type === 'buy' ? -30 : 0;
            slider.max   = type === 'buy' ?   0 : 30;
            slider.value = State.triggerOffset;
        }

        const hint = document.getElementById('triggerHint');
        if (hint) hint.textContent = type === 'buy'
            ? 'Drag left \u2192 lower buy price (triggers when price drops to this level)'
            : 'Drag right \u2192 higher sell price (triggers when price rises to this level)';

        const confirmBtn  = document.getElementById('confirmLimitBtn');
        const confirmText = document.getElementById('confirmBtnText');
        if (confirmBtn) {
            const bg      = type === 'buy' ? '#22c55e' : '#ef4444';
            const bgHover = type === 'buy' ? '#16a34a' : '#dc2626';
            confirmBtn.style.background = bg;
            confirmBtn.onmouseenter = () => { confirmBtn.style.background = bgHover; };
            confirmBtn.onmouseleave = () => { confirmBtn.style.background = bg; };
        }
        if (confirmText) confirmText.textContent = type === 'buy' ? 'Confirm Buy Trigger' : 'Confirm Sell Trigger';

        const label = document.getElementById('amountSliderLabel');
        if (type === 'buy') {
            const usdcBal = this.getTriggerCashBalance('USDC');
            if (label) label.textContent = `USDC to spend (${Assets.formatCurrency(usdcBal)} available)`;
        } else {
            const assetBal = State.selectedAsset?.balance || 0;
            if (label) label.textContent = `${State.selectedAsset?.code} to sell (${Assets.formatNumber(assetBal)} available)`;
        }

        this.updateTriggerDisplay();
        this.updateTriggerAmountSlider(0);
        Logger.log(`Selected ${type} trigger`, 'info');
    },

    // ── Trigger slider controls ───────────────────────────────────────────────

    updateTriggerSlider(value) {
        State.triggerOffset = parseInt(value);
        this.updateTriggerDisplay();
    },

    updateTriggerAmountSlider(value) {
        State.triggerAmountPercent = parseInt(value);

        let displayText;
        if (State.selectedLimitType === 'sell') {
            const assetBal    = State.selectedAsset?.balance || 0;
            const qty         = (assetBal * State.triggerAmountPercent / 100);
            const currentPrice = State.selectedAsset?.usd_price || 0;
            const triggerPrice = currentPrice * (1 + State.triggerOffset / 100);
            const usdValue    = qty * triggerPrice;
            displayText = `${Assets.formatNumber(qty)} ${State.selectedAsset?.code ?? ''} \u2248 ${Assets.formatCurrency(usdValue)}`;
        } else {
            const balance = this.getTriggerCashBalance('USDC');
            displayText   = Assets.formatCurrency(balance * State.triggerAmountPercent / 100);
        }

        const displayEl = document.getElementById('triggerAmountDisplay');
        const percentEl = document.getElementById('triggerAmountPercent');
        const fillEl    = document.getElementById('triggerAmountFill');
        if (displayEl) displayEl.textContent = displayText;
        if (percentEl) percentEl.textContent = State.triggerAmountPercent + '%';
        if (fillEl)    fillEl.style.width    = State.triggerAmountPercent + '%';
    },

    updateTriggerDisplay() {
        if (!State.selectedAsset) return;

        const slider = document.getElementById('triggerSlider');
        if (!slider) return;

        const currentPrice = State.selectedAsset.usd_price || 0;
        const triggerPrice = currentPrice * (1 + State.triggerOffset / 100);

        const min     = parseInt(slider.min);
        const max     = parseInt(slider.max);
        const range   = max - min || 1;
        const percent = ((State.triggerOffset - min) / range) * 100;

        const fillEl   = document.getElementById('triggerFill');
        const priceEl  = document.getElementById('triggerPrice');
        const offsetEl = document.getElementById('triggerOffset');

        if (fillEl) {
            fillEl.style.width      = percent + '%';
            fillEl.style.background = State.selectedLimitType === 'buy' ? '#22c55e' : '#ef4444';
        }
        if (priceEl) priceEl.textContent = Assets.formatCurrency(triggerPrice);
        if (offsetEl) {
            offsetEl.textContent = (State.triggerOffset >= 0 ? '+' : '') + State.triggerOffset + '%';
            _applyOffsetStyle(offsetEl, State.triggerOffset);
        }

        if (State.triggerAmountPercent > 0) {
            this.updateTriggerAmountSlider(State.triggerAmountPercent);
        }
    },

    resetTrigger() {
        State.selectedLimitType    = null;
        State.triggerOffset        = 0;
        State.triggerAmountPercent = 0;
        State.pendingTradeSide     = null;

        document.getElementById('limitButtons')?.classList.remove('hidden');
        document.getElementById('triggerConfig')?.classList.add('hidden');

        const triggerSlider = document.getElementById('triggerSlider');
        const amountSlider  = document.getElementById('triggerAmountSlider');
        if (triggerSlider) { triggerSlider.min = -30; triggerSlider.max = 0; triggerSlider.value = 0; }
        if (amountSlider)  amountSlider.value = 0;

        const displayEl = document.getElementById('triggerAmountDisplay');
        const percentEl = document.getElementById('triggerAmountPercent');
        const fillEl    = document.getElementById('triggerAmountFill');
        if (displayEl) displayEl.textContent = '$0.00';
        if (percentEl) percentEl.textContent = '0%';
        if (fillEl)    fillEl.style.width    = '0%';

        Logger.log('Reset trigger settings', 'info');
    },

    resetTriggerForm() {
        this.resetTrigger();
        API.refreshData();
    },

    // ── Auto-trade controls ───────────────────────────────────────────────────

    updateAutoTradeConstraints(side) {
        const slider = document.getElementById('autoDevSlider');
        const labels = document.getElementById('autoDevLabels');
        const guide  = document.getElementById('autoGuideText');
        if (!slider) return;

        slider.min = -20;
        slider.max = 20;
        if (labels) labels.innerHTML = '<span>-20%</span><span>Market</span><span>+20%</span>';

        if (guide) {
            guide.innerHTML = side === 'buy'
                ? 'Set <span style="color:#22c55e">positive %</span> for stop-buy, <span style="color:#ef4444">negative %</span> for limit-buy'
                : 'Set <span style="color:#ef4444">negative %</span> for stop-sell, <span style="color:#22c55e">positive %</span> for limit-sell';
        }

        this.updateAutoTradeDisplay();
    },

    updateAutoDevSlider(value) {
        State.autoTradeConfig.deviation = parseInt(value);
        this.updateAutoTradeDisplay();
    },

    updateAutoAllocSlider(value) {
        State.autoTradeConfig.allocation = parseInt(value);
        this.updateAutoTradeDisplay();
    },

    updateAutoTradeDisplay() {
        if (!State.selectedAsset) return;

        const slider = document.getElementById('autoDevSlider');
        if (!slider) return;

        const deviation    = State.autoTradeConfig.deviation;
        const currentPrice = State.selectedAsset.usd_price || 0;
        const triggerPrice = currentPrice * (1 + deviation / 100);

        const min     = parseInt(slider.min);
        const max     = parseInt(slider.max);
        const percent = ((deviation - min) / (max - min)) * 100;

        const fillEl  = document.getElementById('autoDevFill');
        const priceEl = document.getElementById('autoPrice');
        const devEl   = document.getElementById('autoDeviation');

        if (fillEl)  fillEl.style.width  = percent + '%';
        if (priceEl) priceEl.textContent = Assets.formatCurrency(triggerPrice);

        if (devEl) {
            devEl.textContent = `${deviation >= 0 ? '+' : ''}${deviation}%`;
            _applyOffsetStyle(devEl, deviation);
        }

        const cashBalance     = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
        const allocFillEl     = document.getElementById('autoAllocFill');
        const allocPctEl      = document.getElementById('autoAllocPercent');
        const allocValueEl    = document.getElementById('autoAllocationValue');

        if (allocFillEl)  allocFillEl.style.width  = State.autoTradeConfig.allocation + '%';
        if (allocPctEl)   allocPctEl.textContent   = State.autoTradeConfig.allocation + '%';
        if (allocValueEl) allocValueEl.textContent =
            `${State.autoTradeConfig.allocation}% of ${Assets.formatCurrency(cashBalance)} USDC`;
    },

    resetAutoTrade() {
        State.autoTradeConfig = { deviation: 0, allocation: 0 };
        const devSlider   = document.getElementById('autoDevSlider');
        const allocSlider = document.getElementById('autoAllocSlider');
        if (devSlider)   devSlider.value   = 0;
        if (allocSlider) allocSlider.value = 0;
        this.updateAutoTradeDisplay();
    },

    // ── Order preparation & confirmation ─────────────────────────────────────

    prepareTrade(side) {
        if (!side) side = State.pendingTradeSide || 'buy';
        State.pendingTradeSide = side;

        if (!State.selectedAsset) return;

        if (!CONFIG.TRADE_PIN) {
            alert('Please set trading PIN in settings');
            document.getElementById('pinModal')?.classList.add('show');
            return;
        }

        if (State.orderType === 'trigger') {
            this.setTriggerConstraints(side);
            if (State.selectedLimitType === null) return;
        } else if (State.orderType === 'auto') {
            this.updateAutoTradeConstraints(side);
            if (State.autoTradeConfig.allocation === 0) {
                alert('Please set portfolio allocation for auto trade');
                return;
            }
        } else {
            if (State.amountSliderValue === 0) {
                alert('Please select an amount');
                return;
            }
        }

        UI.updateAmountDisplay();
        this._showInstantConfirmModal(side);
    },

    _showInstantConfirmModal(side) {
        const cashBalance  = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
        const assetBalance = State.selectedAsset.balance    ?? 0;
        const currentPrice = State.selectedAsset.usd_price  ?? 0;

        let amount, receiveAmount, triggerPrice;

        if (State.orderType === 'auto') {
            const allocationAmount    = (State.autoTradeConfig.allocation / 100) * cashBalance;
            const deviationMultiplier = 1 + State.autoTradeConfig.deviation / 100;
            triggerPrice  = currentPrice * deviationMultiplier;
            if (side === 'buy') {
                amount        = allocationAmount;
                receiveAmount = triggerPrice > 0 ? amount / triggerPrice : 0;
            } else {
                amount        = allocationAmount / currentPrice;
                receiveAmount = allocationAmount;
            }
        } else if (side === 'buy') {
            amount = (State.amountSliderValue / 100) * cashBalance;
            const effectivePrice = State.orderType === 'trigger'
                ? currentPrice * (1 + State.triggerOffset / 100)
                : currentPrice;
            receiveAmount = effectivePrice > 0 ? amount / effectivePrice : 0;
            if (State.orderType === 'trigger') triggerPrice = effectivePrice;
        } else {
            const sellQty = (State.amountSliderValue / 100) * assetBalance;
            amount        = sellQty;
            const effectivePrice = State.orderType === 'trigger'
                ? currentPrice * (1 + State.triggerOffset / 100)
                : currentPrice;
            receiveAmount = sellQty * effectivePrice;
            if (State.orderType === 'trigger') triggerPrice = effectivePrice;
        }

        const modalTitle = document.getElementById('tradeModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`;
            modalTitle.className   = `trade-modal-title ${side}`;
        }

        const orderTypeLabel = State.orderType === 'instant' ? 'Instant (Market)'
            : State.orderType === 'trigger'                  ? 'Trigger Order'
            : `Auto Trade (${State.autoTradeConfig.deviation >= 0 ? '+' : ''}${State.autoTradeConfig.deviation}%)`;

        _setElText('modalOrderType', orderTypeLabel);
        _setElText('modalAsset',     State.selectedAsset.code);

        if (side === 'buy') {
            _setElText('modalAmount',  `${Assets.formatCurrency(amount)} USDC`);
            _setElText('modalReceive', `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`);
        } else {
            _setElText('modalAmount',  `${amount.toFixed(8)} ${State.selectedAsset.code}`);
            _setElText('modalReceive', `${Assets.formatCurrency(receiveAmount)} USDC`);
        }

        const triggerRow = document.getElementById('modalTriggerRow');
        if (triggerRow) {
            const showTrigger = (State.orderType === 'trigger' || State.orderType === 'auto') && triggerPrice;
            triggerRow.style.display = showTrigger ? 'flex' : 'none';
            if (showTrigger) _setElText('modalTrigger', Assets.formatCurrency(triggerPrice));
        }

        const confirmBtn = document.getElementById('modalConfirmBtn');
        if (confirmBtn) confirmBtn.className = `trade-modal-btn confirm ${side}`;

        document.getElementById('tradeModal')?.classList.add('show');
    },

    cancelTrade() {
        document.getElementById('tradeModal')?.classList.remove('show');
        State.pendingTradeSide = null;
    },

    confirmTrade: async function() {
        const side = State.pendingTradeSide;

        if (!side || !State.selectedAsset) {
            document.getElementById('tradeModal')?.classList.remove('show');
            State.pendingTradeSide = null;
            return;
        }

        document.getElementById('tradeModal')?.classList.remove('show');

        const btn = document.getElementById('instantConfirmBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }

        try {
            const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
            const cashBalance   = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
            const assetBalance  = State.selectedAsset.balance ?? 0;

            const orderData = _buildOrderData(side, realtimePrice, cashBalance, assetBalance);
            Logger.log(`Sending ${side.toUpperCase()} order:`, 'info');

            const res = await API.placeOrder(orderData);
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }

            await res.json();
            Logger.log(`✅ ${side.toUpperCase()} order placed successfully!`, 'success');

            if (State.orderType === 'instant') {
                State.amountSliderValue = 0;
                const slider = document.getElementById('amountSlider');
                if (slider) slider.value = 0;
                UI.updateAmountSlider(0);
            }

            await API.refreshData();
            if (State.orderType === 'trigger') this.updateTriggerButtonBalances();

        } catch (error) {
            Logger.log(`❌ Trade failed: ${error.message}`, 'error');
            alert(`Trade failed: ${error.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                const side = State.pendingTradeSide || 'buy';
                btn.innerHTML = `<span id="instantConfirmText">Confirm ${side === 'buy' ? 'Buy' : 'Sell'}</span>`;
            }
            if (State.orderType !== 'trigger') {
                // Keep the side selection but allow new trades
            }
        }
    },

    // ── Trigger order confirm modal ───────────────────────────────────────────

    async showConfirmModal() {
        if (!State.selectedAsset) { alert('No asset selected'); return; }
        if (State.triggerAmountPercent === 0) { alert('Please select an amount'); return; }

        const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
        const triggerPrice  = parseFloat((realtimePrice * (1 + State.triggerOffset / 100)).toFixed(2));

        // Determine order type based on trigger vs market price
        // Buy below market = STOP_LIMIT_BUY (triggers when price drops TO this level)
        // Sell above market = STOP_LIMIT_SELL (triggers when price rises TO this level)
        let orderType;
        if (State.selectedLimitType === 'buy') {
            orderType = triggerPrice < realtimePrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY';
        } else {
            orderType = triggerPrice > realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL';
        }

        let spendDisplay, receiveDisplay, quantity;

        if (State.selectedLimitType === 'buy') {
            const usdcBalance = this.getTriggerCashBalance('USDC');
            const spendAmount = parseFloat((usdcBalance * State.triggerAmountPercent / 100).toFixed(2));
            quantity          = parseFloat((spendAmount / triggerPrice).toFixed(8));
            spendDisplay      = `${Assets.formatCurrency(spendAmount)} USDC`;
            receiveDisplay    = `${quantity} ${State.selectedAsset.code}`;
        } else {
            const assetBalance = State.selectedAsset.balance || 0;
            quantity           = parseFloat((assetBalance * State.triggerAmountPercent / 100).toFixed(8));
            const receiveUsdc  = parseFloat((quantity * triggerPrice).toFixed(2));
            spendDisplay       = `${Assets.formatNumber(quantity)} ${State.selectedAsset.code}`;
            receiveDisplay     = `${Assets.formatCurrency(receiveUsdc)} USDC`;
        }

        const typeEl = document.getElementById('limitModalType');
        if (typeEl) {
            typeEl.textContent = orderType.replace(/_/g, ' ');
            typeEl.style.color = State.selectedLimitType === 'buy' ? '#22c55e' : '#ef4444';
        }

        _setElText('limitModalAsset',   State.selectedAsset.code);
        _setElText('limitModalTrigger', Assets.formatCurrency(triggerPrice));
        _setElText('limitModalAmount',  spendDisplay);
        _setElText('limitModalReceive', receiveDisplay);

        State.pendingOrderType    = orderType;
        State.pendingTriggerPrice = triggerPrice;
        State.pendingQuantity     = quantity;
        State.pendingAssetCode    = State.selectedAsset.code;

        document.getElementById('limitConfirmModal')?.classList.add('show');
    },

    closeLimitModal() {
        document.getElementById('limitConfirmModal')?.classList.remove('show');
    },

    executeLimitOrder: async function() {
        const btn = document.getElementById('limitModalExecuteBtn');
        if (!btn) return;

        const originalText = btn.textContent;
        btn.disabled    = true;
        btn.textContent = 'Submitting...';

        try {
            // Use values pre-calculated and locked in showConfirmModal
            const assetCode    = State.pendingAssetCode;
            const quantity     = State.pendingQuantity;
            const triggerPrice = State.pendingTriggerPrice;

            const orderData = {
                primary:       'USDC',
                secondary:     assetCode,
                quantity,
                assetQuantity: assetCode,
                orderType:     State.pendingOrderType,
                trigger:       triggerPrice
            };

            Logger.log(`Sending ${State.pendingOrderType} order for ${assetCode}:`, 'info');
            Logger.log(`Qty: ${orderData.quantity}, Trigger: ${orderData.trigger}`, 'info');

            const res = await API.placeOrder(orderData);
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }

            const data = await res.json();
            Logger.log(`✅ Order placed! ID: ${data.id ?? data.orderId ?? 'N/A'}`, 'success');

            document.getElementById('limitConfirmModal')?.classList.remove('show');
            document.getElementById('successModal')?.classList.add('show');

            await API.refreshData();
            this.updateTriggerButtonBalances();

        } catch (error) {
            Logger.log(`❌ Order failed: ${error.message}`, 'error');
            alert(`Order failed: ${error.message}`);
            document.getElementById('limitConfirmModal')?.classList.remove('show');
        } finally {
            btn.disabled    = false;
            btn.textContent = originalText;
            this.resetTriggerForm();
        }
    },

    closeSuccessModal() {
        document.getElementById('successModal')?.classList.remove('show');
    }
};

// ─── Private helpers ──────────────────────────────────────────────────────────

function _setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function _applyOffsetStyle(el, value) {
    if (!el) return;
    if (value > 0) {
        el.style.color      = '#22c55e';
        el.style.background = 'rgba(34,197,94,0.15)';
    } else if (value < 0) {
        el.style.color      = '#ef4444';
        el.style.background = 'rgba(239,68,68,0.15)';
    } else {
        el.style.color      = '#94a3b8';
        el.style.background = 'rgba(148,163,184,0.15)';
    }
}

function _buildOrderData(side, realtimePrice, cashBalance, assetBalance) {
    if (State.orderType === 'auto') {
        const allocationAmount    = (State.autoTradeConfig.allocation / 100) * cashBalance;
        const deviationMultiplier = 1 + State.autoTradeConfig.deviation / 100;
        const triggerPrice        = parseFloat((realtimePrice * deviationMultiplier).toFixed(2));
        const orderType = side === 'buy'
            ? (triggerPrice > realtimePrice ? 'STOP_LIMIT_BUY'  : 'LIMIT_BUY')
            : (triggerPrice < realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL');
        const quantity = side === 'buy'
            ? parseFloat((allocationAmount / triggerPrice).toFixed(8))
            : parseFloat((allocationAmount / realtimePrice).toFixed(8));
        return { primary: 'USDC', secondary: State.selectedAsset.code, quantity,
                 assetQuantity: State.selectedAsset.code, orderType, trigger: triggerPrice };
    }

    if (side === 'buy') {
        const cashAmount = (State.amountSliderValue / 100) * cashBalance;
        if (State.orderType === 'instant') {
            return { primary: 'USDC', secondary: State.selectedAsset.code,
                     quantity: parseFloat((cashAmount / realtimePrice).toFixed(8)),
                     orderType: 'MARKET_BUY', assetQuantity: State.selectedAsset.code };
        }
        const triggerPrice = parseFloat((realtimePrice * (1 + State.triggerOffset / 100)).toFixed(2));
        return { primary: 'USDC', secondary: State.selectedAsset.code,
                 quantity: parseFloat((cashAmount / triggerPrice).toFixed(8)),
                 assetQuantity: State.selectedAsset.code,
                 orderType: triggerPrice > realtimePrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY',
                 trigger: triggerPrice };
    }

    // sell
    const sellQty = parseFloat(((State.amountSliderValue / 100) * assetBalance).toFixed(8));
    if (State.orderType === 'instant') {
        return { primary: 'USDC', secondary: State.selectedAsset.code,
                 quantity: sellQty, orderType: 'MARKET_SELL',
                 assetQuantity: State.selectedAsset.code };
    }
    const triggerPrice = parseFloat((realtimePrice * (1 + State.triggerOffset / 100)).toFixed(2));
    return { primary: 'USDC', secondary: State.selectedAsset.code,
             quantity: sellQty, assetQuantity: State.selectedAsset.code,
             orderType: triggerPrice < realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL',
             trigger: triggerPrice };
}
