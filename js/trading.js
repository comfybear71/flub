// ==========================================
// TRADING - Trading Logic & Order Management
// ==========================================
import { State } from './config.js';
import { Logger } from './logger.js';
import { Assets } from './assets.js';
import { API } from './api.js';

// ── Colour helpers ────────────────────────────────────────────────────────────

const POSITIVE_STYLE = { color: '#22c55e', background: 'rgba(34,197,94,0.15)' };
const NEGATIVE_STYLE = { color: '#ef4444', background: 'rgba(239,68,68,0.15)' };
const NEUTRAL_STYLE  = { color: '#94a3b8', background: 'rgba(148,163,184,0.15)' };

function applyOffsetStyle(el, value) {
    if (!el) return;
    const s = value > 0 ? POSITIVE_STYLE : value < 0 ? NEGATIVE_STYLE : NEUTRAL_STYLE;
    el.style.color      = s.color;
    el.style.background = s.background;
}

// ── Exported Trading object ───────────────────────────────────────────────────

export const Trading = {

    // ── Trigger cash balance helpers ─────────────────────────────────────────

    getTriggerCashBalance(currency) {
        return State.portfolioData.assets.find(a => a.code === currency)?.usd_value ?? 0;
    },

    updateTriggerButtonBalances() {
        const usdcBalance = this.getTriggerCashBalance('USDC');
        const balanceEl   = document.querySelector('#triggerOptUSDC .balance');
        if (balanceEl) balanceEl.textContent = Assets.formatCurrency(usdcBalance);

        const label = document.getElementById('amountSliderLabel');
        if (label) label.textContent = 'Amount (USDC)';
    },

    setTriggerCash(currency) {
        State.selectedTriggerCash = currency;
        document.getElementById('triggerOptUSDC')?.classList.add('active');

        const balance   = this.getTriggerCashBalance('USDC');
        const label     = document.getElementById('amountSliderLabel');
        const balanceEl = document.querySelector('#triggerOptUSDC .balance');
        if (label)     label.textContent     = 'Amount (USDC)';
        if (balanceEl) balanceEl.textContent  = Assets.formatCurrency(balance);

        this.updateTriggerAmountSlider(0);
        Logger.log(`Selected USDC for trigger order. Balance: ${Assets.formatCurrency(balance)}`, 'info');
    },

    // ── Limit type selection ─────────────────────────────────────────────────

    selectLimitType(type) {
        State.selectedLimitType = type;
        State.pendingTradeSide  = type;

        document.getElementById('limitButtons')?.classList.add('hidden');
        document.getElementById('triggerSliderSection')?.classList.remove('hidden');
        document.getElementById('amountSliderSection')?.classList.remove('hidden');

        const confirmLimitBtn = document.getElementById('confirmLimitBtn');
        const confirmBtnText  = document.getElementById('confirmBtnText');

        confirmLimitBtn?.classList.remove('hidden');
        if (confirmBtnText) {
            confirmBtnText.textContent = type === 'buy' ? 'Confirm Buy Trigger' : 'Confirm Sell Trigger';
        }

        // Style confirm button by side
        if (confirmLimitBtn) {
            const bg      = type === 'buy' ? '#22c55e' : '#ef4444';
            const bgHover = type === 'buy' ? '#16a34a' : '#dc2626';
            confirmLimitBtn.style.background = bg;
            confirmLimitBtn.onmouseenter = () => { confirmLimitBtn.style.background = bgHover; };
            confirmLimitBtn.onmouseleave = () => { confirmLimitBtn.style.background = bg; };
        }

        this.setTriggerConstraints(type);
        Logger.log(`Selected ${type} trigger`, 'info');
    },

    // ── Trigger slider controls ───────────────────────────────────────────────

    setTriggerConstraints(_side) {
        const slider = document.getElementById('triggerSlider');
        const labels = document.getElementById('triggerLabels');
        if (!slider) return;

        slider.min = -20;
        slider.max = 20;
        if (labels) labels.innerHTML = '<span>-20%</span><span>Market</span><span>+20%</span>';

        this.updateTriggerDisplay();
    },

    updateTriggerSlider(value) {
        State.triggerOffset = parseInt(value);
        this.updateTriggerDisplay();
    },

    updateTriggerAmountSlider(value) {
        State.triggerAmountPercent = parseInt(value);
        const balance = this.getTriggerCashBalance('USDC');
        const amount  = (balance * State.triggerAmountPercent / 100).toFixed(2);

        const displayEl = document.getElementById('triggerAmountDisplay');
        const percentEl = document.getElementById('triggerAmountPercent');
        const fillEl    = document.getElementById('triggerAmountFill');

        if (displayEl) displayEl.textContent = `$${amount}`;
        if (percentEl) percentEl.textContent = State.triggerAmountPercent + '%';
        if (fillEl)    fillEl.style.width    = State.triggerAmountPercent + '%';
    },

    updateTriggerDisplay() {
        if (!State.selectedAsset) return;

        const slider = document.getElementById('triggerSlider');
        if (!slider) return;

        const currentPrice  = State.selectedAsset.usd_price || 0;
        const triggerPrice  = currentPrice * (1 + State.triggerOffset / 100);

        const min     = parseInt(slider.min);
        const max     = parseInt(slider.max);
        const percent = ((State.triggerOffset - min) / (max - min)) * 100;

        const fillEl    = document.getElementById('triggerFill');
        const priceEl   = document.getElementById('triggerPrice');
        const offsetEl  = document.getElementById('triggerOffset');

        if (fillEl)  fillEl.style.width  = percent + '%';
        if (priceEl) priceEl.textContent = Assets.formatCurrency(triggerPrice);

        if (offsetEl) {
            offsetEl.textContent = (State.triggerOffset >= 0 ? '+' : '') + State.triggerOffset + '%';
            applyOffsetStyle(offsetEl, State.triggerOffset);
        }
    },

    resetTrigger() {
        State.selectedLimitType    = null;
        State.triggerOffset        = 0;
        State.triggerAmountPercent = 0;
        State.pendingTradeSide     = null;

        document.getElementById('limitButtons')?.classList.remove('hidden');
        document.getElementById('confirmLimitBtn')?.classList.add('hidden');
        document.getElementById('triggerSliderSection')?.classList.add('hidden');
        document.getElementById('amountSliderSection')?.classList.add('hidden');

        const triggerSlider = document.getElementById('triggerSlider');
        const amountSlider  = document.getElementById('triggerAmountSlider');
        if (triggerSlider) triggerSlider.value = 0;
        if (amountSlider)  amountSlider.value  = 0;

        // Reset confirm button to default blue
        const confirmBtn = document.getElementById('confirmLimitBtn');
        if (confirmBtn) {
            confirmBtn.style.background = '#3b82f6';
            confirmBtn.onmouseenter = null;
            confirmBtn.onmouseleave = null;
        }

        this.updateTriggerDisplay();
        this.updateTriggerAmountSlider(0);
        Logger.log('Reset trigger settings', 'info');
    },

    resetTriggerForm() {
        this.resetTrigger();
        API.refreshData();
    },

    // ── Auto-trade controls ───────────────────────────────────────────────────

    updateAutoTradeConstraints(side) {
        const slider  = document.getElementById('autoDevSlider');
        const labels  = document.getElementById('autoDevLabels');
        const guide   = document.getElementById('autoGuideText');
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

        const currentPrice = State.selectedAsset.usd_price || 0;
        const deviation    = State.autoTradeConfig.deviation;
        const triggerPrice = currentPrice * (1 + deviation / 100);

        const min     = parseInt(slider.min);
        const max     = parseInt(slider.max);
        const percent = ((deviation - min) / (max - min)) * 100;

        const fillEl      = document.getElementById('autoDevFill');
        const priceEl     = document.getElementById('autoPrice');
        const devEl       = document.getElementById('autoDeviation');

        if (fillEl)  fillEl.style.width  = percent + '%';
        if (priceEl) priceEl.textContent = Assets.formatCurrency(triggerPrice);

        if (devEl) {
            devEl.textContent = `${deviation >= 0 ? '+' : ''}${deviation}%`;
            applyOffsetStyle(devEl, deviation);
        }

        const cashBalance      = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
        const allocationAmount = (State.autoTradeConfig.allocation / 100) * cashBalance;

        const allocFillEl   = document.getElementById('autoAllocFill');
        const allocPctEl    = document.getElementById('autoAllocPercent');
        const allocValueEl  = document.getElementById('autoAllocationValue');

        if (allocFillEl)  allocFillEl.style.width   = State.autoTradeConfig.allocation + '%';
        if (allocPctEl)   allocPctEl.textContent     = State.autoTradeConfig.allocation + '%';
        if (allocValueEl) allocValueEl.textContent   =
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

    // ── Order preparation & confirmation (instant / auto) ────────────────────

    prepareTrade(side) {
        State.pendingTradeSide = side;

        if (!State.selectedAsset) return;

        if (!State.CONFIG?.TRADE_PIN) {
            // CONFIG imported at the top of this file's sibling; get it via the shared import
            import('./config.js').then(({ CONFIG }) => {
                if (!CONFIG.TRADE_PIN) {
                    alert('Please set trading PIN in settings');
                    document.getElementById('pinModal')?.classList.add('show');
                }
            });
            return;
        }

        if (State.orderType === 'trigger') {
            // Nothing to do here — user selects buy/sell via selectLimitType
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

        this._showInstantConfirmModal(side);
    },

    _showInstantConfirmModal(side) {
        const cashBalance  = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
        const assetBalance = State.selectedAsset.balance ?? 0;
        const currentPrice = State.selectedAsset.usd_price;

        let amount, receiveAmount, triggerPrice;

        if (State.orderType === 'auto') {
            const allocationAmount   = (State.autoTradeConfig.allocation / 100) * cashBalance;
            const deviationMultiplier = 1 + State.autoTradeConfig.deviation / 100;
            triggerPrice = currentPrice * deviationMultiplier;
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

        // Populate modal fields
        const modalTitle = document.getElementById('tradeModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `Confirm ${side === 'buy' ? 'Buy' : 'Sell'}`;
            modalTitle.className   = `trade-modal-title ${side}`;
        }

        const orderTypeLabel = State.orderType === 'instant'  ? 'Instant (Market)'
            : State.orderType === 'trigger' ? 'Trigger Order'
            : `Auto Trade (${State.autoTradeConfig.deviation >= 0 ? '+' : ''}${State.autoTradeConfig.deviation}%)`;

        setElText('modalOrderType', orderTypeLabel);
        setElText('modalAsset',     State.selectedAsset.code);

        if (side === 'buy') {
            setElText('modalAmount',  `${Assets.formatCurrency(amount)} USDC`);
            setElText('modalReceive', `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`);
        } else {
            setElText('modalAmount',  `${amount.toFixed(8)} ${State.selectedAsset.code}`);
            setElText('modalReceive', `${Assets.formatCurrency(receiveAmount)} USDC`);
        }

        const triggerRow = document.getElementById('modalTriggerRow');
        if (triggerRow) {
            const showTrigger = (State.orderType === 'trigger' || State.orderType === 'auto') && triggerPrice;
            triggerRow.style.display = showTrigger ? 'flex' : 'none';
            if (showTrigger) setElText('modalTrigger', Assets.formatCurrency(triggerPrice));
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

        const btnId = side === 'buy' ? 'buyBtn' : 'sellBtn';
        const btn   = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.classList.add('spinning');
        }

        try {
            const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
            const cashBalance   = State.portfolioData.assets.find(a => a.code === 'USDC')?.usd_value ?? 0;
            const assetBalance  = State.selectedAsset.balance ?? 0;

            const orderData = buildOrderData(side, realtimePrice, cashBalance, assetBalance);

            Logger.log(`Sending ${side.toUpperCase()} order:`, 'info');

            const res = await API.placeOrder(orderData);

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || `HTTP ${res.status}`);
            }

            await res.json(); // consume body
            Logger.log(`✅ ${side.toUpperCase()} order placed successfully!`, 'success');

            if (State.orderType === 'instant') {
                State.amountSliderValue = 0;
                const slider = document.getElementById('amountSlider');
                if (slider) slider.value = 0;
                // Re-import to avoid circular at module load time
                const { UI } = await import('./ui.js');
                UI.updateAmountSlider(0);
            }

            await API.refreshData();

            if (State.orderType === 'trigger') {
                this.updateTriggerButtonBalances();
            }

        } catch (error) {
            Logger.log(`❌ Trade failed: ${error.message}`, 'error');
            alert(`Trade failed: ${error.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('spinning');
            }
            if (State.orderType !== 'trigger') {
                State.pendingTradeSide = null;
            }
        }
    },

    // ── Trigger order confirmation modal ─────────────────────────────────────

    async showConfirmModal() {
        if (!State.selectedAsset) {
            alert('No asset selected');
            return;
        }
        if (State.triggerAmountPercent === 0) {
            alert('Please select an amount');
            return;
        }

        const realtimePrice = API.getRealtimePrice(State.selectedAsset.code);
        const triggerPrice  = realtimePrice * (1 + State.triggerOffset / 100);

        let orderType;
        if (State.selectedLimitType === 'buy') {
            orderType = triggerPrice > realtimePrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY';
        } else {
            orderType = triggerPrice < realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL';
        }

        const balance       = this.getTriggerCashBalance('USDC');
        const amount        = balance * State.triggerAmountPercent / 100;
        const receiveAmount = amount / triggerPrice;

        const typeEl = document.getElementById('limitModalType');
        if (typeEl) {
            typeEl.textContent = orderType.replace(/_/g, ' ');
            typeEl.style.color = State.selectedLimitType === 'buy' ? '#22c55e' : '#ef4444';
        }

        setElText('limitModalAsset',   State.selectedAsset.code);
        setElText('limitModalTrigger', Assets.formatCurrency(triggerPrice));
        setElText('limitModalAmount',  `$${amount.toFixed(2)} USDC`);
        setElText('limitModalReceive', `${receiveAmount.toFixed(8)} ${State.selectedAsset.code}`);

        State.pendingOrderType   = orderType;
        State.pendingTriggerPrice = triggerPrice;

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
            const balance      = this.getTriggerCashBalance('USDC');
            const amount       = balance * State.triggerAmountPercent / 100;
            const triggerPrice = parseFloat(State.pendingTriggerPrice.toFixed(2));
            const quantity     = parseFloat((amount / triggerPrice).toFixed(8));

            const orderData = {
                primary:       State.selectedAsset.code,
                secondary:     'USDC',
                quantity,
                assetQuantity: State.selectedAsset.code,
                orderType:     State.pendingOrderType,
                trigger:       triggerPrice
            };

            Logger.log(`Sending ${State.pendingOrderType} order:`, 'info');
            Logger.log(`Asset: ${orderData.primary}, Qty: ${orderData.quantity}, Trigger: ${orderData.trigger}`, 'info');

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

/** Sets the textContent of an element by ID (no-op if not found). */
function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

/**
 * Builds the order payload for confirmTrade based on current state.
 */
function buildOrderData(side, realtimePrice, cashBalance, assetBalance) {
    if (State.orderType === 'auto') {
        const allocationAmount    = (State.autoTradeConfig.allocation / 100) * cashBalance;
        const deviationMultiplier = 1 + State.autoTradeConfig.deviation / 100;
        const triggerPrice        = parseFloat((realtimePrice * deviationMultiplier).toFixed(2));

        let orderType;
        if (side === 'buy') {
            orderType = triggerPrice > realtimePrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY';
        } else {
            orderType = triggerPrice < realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL';
        }

        const quantity = side === 'buy'
            ? parseFloat((allocationAmount / triggerPrice).toFixed(8))
            : parseFloat((allocationAmount / realtimePrice).toFixed(8));

        return {
            primary:       State.selectedAsset.code,
            secondary:     'USDC',
            quantity,
            assetQuantity: State.selectedAsset.code,
            orderType,
            trigger:       triggerPrice
        };
    }

    if (side === 'buy') {
        const cashAmount = (State.amountSliderValue / 100) * cashBalance;

        if (State.orderType === 'instant') {
            return {
                primary:       State.selectedAsset.code,
                secondary:     'USDC',
                quantity:      parseFloat((cashAmount / realtimePrice).toFixed(8)),
                orderType:     'MARKET_BUY',
                assetQuantity: State.selectedAsset.code
            };
        }

        // trigger buy
        const offsetMultiplier = 1 + State.triggerOffset / 100;
        const triggerPrice     = parseFloat((realtimePrice * offsetMultiplier).toFixed(2));
        return {
            primary:       State.selectedAsset.code,
            secondary:     'USDC',
            quantity:      parseFloat((cashAmount / triggerPrice).toFixed(8)),
            assetQuantity: State.selectedAsset.code,
            orderType:     triggerPrice > realtimePrice ? 'STOP_LIMIT_BUY' : 'LIMIT_BUY',
            trigger:       triggerPrice
        };
    }

    // sell
    const sellQty = parseFloat(((State.amountSliderValue / 100) * assetBalance).toFixed(8));

    if (State.orderType === 'instant') {
        return {
            primary:       State.selectedAsset.code,
            secondary:     'USDC',
            quantity:      sellQty,
            orderType:     'MARKET_SELL',
            assetQuantity: State.selectedAsset.code
        };
    }

    // trigger sell
    const offsetMultiplier = 1 + State.triggerOffset / 100;
    const triggerPrice     = parseFloat((realtimePrice * offsetMultiplier).toFixed(2));
    return {
        primary:       State.selectedAsset.code,
        secondary:     'USDC',
        quantity:      sellQty,
        assetQuantity: State.selectedAsset.code,
        orderType:     triggerPrice < realtimePrice ? 'STOP_LIMIT_SELL' : 'LIMIT_SELL',
        trigger:       triggerPrice
    };
}
