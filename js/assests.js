// ==========================================
// ASSETS - Asset Management & Utilities
// ==========================================
import { State } from './config.js';

/**
 * Sorts the portfolio assets array in-place and updates the sort UI.
 * @param {'value'|'change'|'name'|'balance'} sortType
 */
export function sort(sortType) {
    State.currentSort = sortType;

    document.querySelectorAll('[id^="check-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById(`check-${sortType}`)?.classList.remove('hidden');

    const labels = {
        value:   'Sort: Value',
        change:  'Sort: Change %',
        name:    'Sort: Name',
        balance: 'Sort: Balance'
    };
    const sortLabel = document.getElementById('currentSortLabel');
    if (sortLabel) sortLabel.textContent = labels[sortType];

    const { assets } = State.portfolioData;

    if (sortType === 'value') {
        assets.sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    } else if (sortType === 'change') {
        assets.sort((a, b) => (b.change_24h || 0) - (a.change_24h || 0));
    } else if (sortType === 'name') {
        assets.sort((a, b) => a.code.localeCompare(b.code));
    } else if (sortType === 'balance') {
        assets.sort((a, b) => (b.balance || 0) - (a.balance || 0));
    }
}

/**
 * Formats a USD dollar value with appropriate decimal places.
 * @param {number} value
 * @returns {string} e.g. "$1,234", "$12.34", "$0.0012"
 */
export function formatCurrency(value) {
    if (!value || isNaN(value)) return '$0.00';
    if (value >= 1000) return '$' + value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (value >= 1)    return '$' + value.toFixed(2);
    return '$' + value.toFixed(4);
}

/**
 * Formats a raw numeric balance with appropriate decimal places.
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000)  return num.toLocaleString();
    if (num >= 1)     return num.toFixed(2);
    if (num >= 0.01)  return num.toFixed(4);
    return num.toFixed(6);
}

export const Assets = { sort, formatCurrency, formatNumber };
