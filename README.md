# ShopeePay QRIS Gateway

Second, independent payment option alongside `../gopay-api-gateaway` — not a
replacement. Same dynamic-QRIS-and-auto-verify shape, but for ShopeePay.

## How this actually works (confirmed, no app-tampering involved)

Earlier attempts in this project's history tried to get auto-verify by
capturing/patching the ShopeePay **mobile app**'s traffic (root + Frida +
SSL-pinning bypass). That approach was abandoned — it meant circumventing a
third-party fintech app's security controls, which isn't something to do
even against your own account.

The actual working mechanism, found by inspecting a public ShopeePay gateway
project, doesn't touch the mobile app at all:

- ShopeePay has a **Partner Portal web dashboard** for merchants:
  `https://partner.shopee.co.id/`
- That portal's own frontend calls its backend using an internal token
  (starts with `B:`), visible in any browser's DevTools Network tab —
  because you're looking at requests your own authenticated browser session
  is already making.
- So: log into the portal normally in Chrome/Firefox, open DevTools (F12) →
  Network → XHR filter → refresh the transactions page → find the
  `get-transaction-list` request → copy the token out of its payload
  (`data.metadata.token`) and the request URL. No OTP automation, no
  rooting, no app patching.

This requires a registered **ShopeePay Partner/merchant** account (in
progress as of writing) — not a personal wallet.

## Status

**Working now:**
- `lib/qris.js` + `server.js` routes (`/create-qris`, `/qr/:id`,
  `/api/qr-status/:id`, `/check-payment`, claim-lock) — generic EMVCo,
  same as the GoPay project, ready once `QRIS_STATIC` is set.

**Needs your Partner account once it's approved:**
- `SHOPEE_TOKEN` and `SHOPEE_TRANSACTIONS_URL` in `.env` — get both from
  DevTools as described above.
- `parseShopeeTransactions()` in `server.js` — field names are a reasonable
  guess (`amount`, `status`, `time`, `id`); confirm against the real
  response JSON you see in DevTools and adjust if they don't match.
- The exact request body `verifyPayment()` sends — copy the real
  `get-transaction-list` request payload from DevTools and match it.

## On the public repo this was modeled after

`ahmadzakiyox/shoppepay-api-gateway` on GitHub describes this same Partner
Portal mechanism, but its published `server.js` is fully obfuscated
(`javascript-obfuscator` with self-defending mode — the `build` script in
its `package.json` shows this; the raw source is never published). Its
security claims about the token ("never sent anywhere else") can't be
verified. That's why this project reimplements the mechanism plainly instead
of reusing that code — don't paste a real Partner token into that repo's
tool.

## Setup

```bash
npm install
cp .env.example .env
# fill QRIS_STATIC now
# fill SHOPEE_TOKEN + SHOPEE_TRANSACTIONS_URL once Partner account is approved
npm run check-token   # sanity-check the token once filled in
npm start
```
