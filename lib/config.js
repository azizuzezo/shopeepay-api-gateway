// Runtime-editable config, backed by a local JSON file instead of process.env
// so the /setup panel can save changes that take effect immediately (no
// server restart needed). .env is still used for the one-time deploy secret
// (API_KEY) and as a fallback default.

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'shopee-config.json');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function saveConfig(partial) {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const updated = { ...loadConfig(), ...partial };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
}

function get(key, envFallbackKey) {
    const config = loadConfig();
    if (config[key]) return config[key];
    return envFallbackKey ? process.env[envFallbackKey] : undefined;
}

module.exports = { loadConfig, saveConfig, get };
