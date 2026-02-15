// ==========================================
// LOGGER - Activity Logging
// ==========================================

/**
 * Logs a message to the on-screen log container and the browser console.
 * @param {string|object} message - The message or object to log.
 * @param {'info'|'success'|'error'} type - Log level styling.
 */
export function log(message, type = 'info') {
    const container = document.getElementById('log-container');

    let msgStr = message;
    if (typeof message === 'object') {
        try {
            msgStr = JSON.stringify(message).substring(0, 200);
        } catch {
            msgStr = '[Object]';
        }
    }

    console.log(message);

    if (!container) return;

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${msgStr}</span>`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

export const Logger = { log };
