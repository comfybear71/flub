// ==========================================
// PRICE ANIMATOR — Count-up animations for live price display
// Display-only: never touches State.liveRates or trading logic
// ==========================================

const PriceAnimator = {
    _animations: new Map(),   // track active animations to cancel duplicates
    _prevValues: new Map(),   // track previous values for direction detection

    /**
     * Animate a numeric value in a DOM element from old → new
     * @param {HTMLElement} el       — target element
     * @param {number}      newVal   — target number
     * @param {function}    formatter — e.g. Assets.formatCurrency
     * @param {number}      duration — ms (default 1200)
     */
    animateEl(el, newVal, formatter, duration = 1200) {
        if (!el) return;

        const key = el.id || el.dataset.code + '-' + el.dataset.field;

        // Cancel any running animation on this element
        const prev = this._animations.get(key);
        if (prev) cancelAnimationFrame(prev);

        // Parse old value from what's currently displayed
        const oldVal = this._parseDisplayed(el.textContent);

        // Skip if no real change
        if (Math.abs(oldVal - newVal) < 0.000001) {
            el.textContent = formatter(newVal);
            return;
        }

        // Direction flash
        const prevKnown = this._prevValues.get(key);
        if (prevKnown !== undefined && prevKnown !== newVal) {
            const direction = newVal > prevKnown ? 'up' : 'down';
            el.classList.remove('price-flash-up', 'price-flash-down');
            // Force reflow so animation restarts
            void el.offsetWidth;
            el.classList.add(`price-flash-${direction}`);
        }
        this._prevValues.set(key, newVal);

        // Animate
        const startTime = performance.now();
        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = oldVal + (newVal - oldVal) * eased;
            el.textContent = formatter(current);
            if (progress < 1) {
                this._animations.set(key, requestAnimationFrame(step));
            } else {
                this._animations.delete(key);
            }
        };
        this._animations.set(key, requestAnimationFrame(step));
    },

    /**
     * Animate from zero (used on initial page load)
     */
    animateFromZero(el, targetVal, formatter, duration = 1500) {
        if (!el) return;
        const key = el.id || el.dataset.code + '-' + el.dataset.field;
        this._prevValues.set(key, targetVal);

        const prev = this._animations.get(key);
        if (prev) cancelAnimationFrame(prev);

        const startTime = performance.now();
        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = targetVal * eased;
            el.textContent = formatter(current);
            if (progress < 1) {
                this._animations.set(key, requestAnimationFrame(step));
            } else {
                this._animations.delete(key);
            }
        };
        this._animations.set(key, requestAnimationFrame(step));
    },

    /**
     * Parse a displayed currency/number string back to a float
     * "$1,234.56" → 1234.56, "0.0034" → 0.0034
     */
    _parseDisplayed(text) {
        const cleaned = (text || '').replace(/[^0-9.\-]/g, '');
        return parseFloat(cleaned) || 0;
    }
};
