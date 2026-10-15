// Runtime-editable config, backed by a local JSON file instead of process.env
// so the /setup panel can save changes that take effect immediately (no
// server restart needed). .env is still used for the one-time deploy secret
// (API_KEY) and as a fallback default.

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'shopee-config.json');

const DEFAULTS = {
    qrisStatic: '00020101021126610016ID.CO.SHOPEE.WWW01189360091800237735530208237735530303UMI51440014ID.CO.QRIS.WWW0215ID10266025306890303UMI5204581753033605802ID5909SebutAzza6009BANYUASIN61053091962070703A0163040C52',
    shopeeTransactionsUrl: 'https://shopeepay.shopee.co.id/merchant/v1/partner-web/get-transaction-list',
};

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    } catch (e) {
        return { ...DEFAULTS };
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
    if (envFallbackKey && process.env[envFallbackKey]) return process.env[envFallbackKey];
    return DEFAULTS[key];
}

module.exports = { loadConfig, saveConfig, get };
