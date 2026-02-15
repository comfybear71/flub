// ==========================================
// LOGGER - Activity Logging
// ==========================================
const Logger = {
    log(message, type = 'info') {
        let msgStr = message;
        if (typeof message === 'object') {
            try { msgStr = JSON.stringify(message).substring(0, 200); }
            catch { msgStr = '[Object]'; }
        }

        console.log(message);

        const container = document.getElementById('log-container');
        if (!container) return;

        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${msgStr}</span>`;
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
    }
};
