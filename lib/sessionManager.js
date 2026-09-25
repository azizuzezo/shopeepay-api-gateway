// ShopeePay Partner Portal token handling.
//
// Mechanism (confirmed legitimate, no app-patching/pinning-bypass involved):
// the ShopeePay Partner Portal (https://partner.shopee.co.id/) is a normal
// merchant web dashboard. Its own frontend calls an internal API using a
// bearer-style token (starts with "B:"). You get that token by logging into
// the portal in a normal browser, opening DevTools -> Network -> XHR, and
// copying the token field out of the `get-transaction-list` request payload
// (Request Payload -> data -> metadata -> token).
//
// The token itself is entered through the /setup panel (see server.js), not
// hardcoded in .env, so a host can paste it in later without touching files.

const config = require('./config');

function getValidHeaders() {
    const token = config.get('shopeeToken', 'SHOPEE_TOKEN');
    if (!token) return null;
    // TODO(partner-portal-capture): confirm the exact header/body shape the
    // portal's own requests use once you've got a real account — this is a
    // reasonable starting guess (bearer-style token), verify against your
    // own captured request before trusting it.
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

function hasToken() {
    return Boolean(config.get('shopeeToken', 'SHOPEE_TOKEN'));
}

function getTransactionsUrl() {
    return config.get('shopeeTransactionsUrl', 'SHOPEE_TRANSACTIONS_URL');
}

module.exports = { getValidHeaders, hasToken, getTransactionsUrl };
