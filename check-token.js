// Sanity check for the SHOPEE_TOKEN you copied from the Partner Portal's
// DevTools Network tab. Just confirms it's set and (once SHOPEE_TRANSACTIONS_URL
// is filled in) that it's actually accepted by the real endpoint.

require('dotenv').config();
const axios = require('axios');
const sessionManager = require('./lib/sessionManager');

async function main() {
    if (!sessionManager.hasToken()) {
        console.error('SHOPEE_TOKEN belum diisi di .env — copy dari DevTools Network tab di partner.shopee.co.id (lihat README.md).');
        process.exit(1);
    }

    if (!process.env.SHOPEE_TRANSACTIONS_URL) {
        console.log('SHOPEE_TOKEN ada, tapi SHOPEE_TRANSACTIONS_URL belum diisi — nggak bisa tes ke endpoint asli. Isi dulu dari hasil capture DevTools.');
        return;
    }

    try {
        const res = await axios.post(
            process.env.SHOPEE_TRANSACTIONS_URL,
            { /* TODO(partner-portal-capture): body asli get-transaction-list */ },
            { headers: sessionManager.getValidHeaders(), timeout: 10000 }
        );
        console.log('Token diterima. Response status:', res.status);
    } catch (err) {
        console.error('Token ditolak / request gagal:', err.response?.status, err.response?.data || err.message);
    }
}

main();
