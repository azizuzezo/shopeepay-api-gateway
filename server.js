const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const sessionManager = require('./lib/sessionManager');
const { generateDynamicQRIS } = require('./lib/qris');
const config = require('./lib/config');

const PORT = process.env.PORT || 3001;
const MAX_LOGS = 100;
const CLAIMED_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 jam
const QRIS_EXPIRY_MS = 5 * 60 * 1000; // 5 menit

// claimedTransactions: Map<txId, { qrisId, claimedAt }>
// Satu transaksi masuk cuma bisa diklaim oleh satu QRIS, sama kayak di gopay-api-gateaway.
const claimedTransactions = new Map();
const activityLogs = [];
const qrisStore = new Map();

function logActivity(type, message, details = null) {
    const logObj = { id: Date.now(), timestamp: new Date().toISOString(), type, message, details };
    activityLogs.unshift(logObj);
    if (activityLogs.length > MAX_LOGS) activityLogs.pop();
    console.log(`[${logObj.timestamp}] [${type}] ${message}`);
}

setInterval(() => {
    const now = Date.now();
    for (const [txId, claim] of claimedTransactions.entries()) {
        if (now - claim.claimedAt > CLAIMED_CLEANUP_INTERVAL_MS) claimedTransactions.delete(txId);
    }
}, 60 * 60 * 1000);

const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.query.apikey;
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ success: false, message: 'Autentikasi Gagal: API Key tidak valid' });
    }
    next();
};

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('ShopeePay QRIS Gateway berjalan'));
app.get('/health', (req, res) => res.json({ status: 'OK', service: 'ShopeePay QRIS Gateway', timestamp: new Date() }));

// GET/POST /api/setup — dipakai panel /setup buat baca & simpen config.
// Auth-nya pake API_KEY yang sama kayak endpoint lain, dimasukin sekali di
// panel terus disimpen di localStorage browser host.
app.get('/api/setup', apiKeyAuth, (req, res) => {
    const stored = config.loadConfig();
    const mask = (val) => (val ? val.slice(0, 6) + '••••••' : '');
    res.json({
        success: true,
        data: {
            qris_static: stored.qrisStatic || '',
            shopee_token_masked: mask(stored.shopeeToken),
            shopee_token_set: Boolean(stored.shopeeToken),
            shopee_transactions_url: stored.shopeeTransactionsUrl || '',
        },
    });
});

app.post('/api/setup', apiKeyAuth, (req, res) => {
    const { qris_static, shopee_token, shopee_transactions_url } = req.body || {};
    const partial = {};
    if (qris_static !== undefined && qris_static !== '') partial.qrisStatic = qris_static.trim();
    if (shopee_token !== undefined && shopee_token !== '') partial.shopeeToken = shopee_token.trim();
    if (shopee_transactions_url !== undefined && shopee_transactions_url !== '') partial.shopeeTransactionsUrl = shopee_transactions_url.trim();

    config.saveConfig(partial);
    logActivity('SYSTEM', 'Config diupdate lewat panel /setup');
    res.json({ success: true, message: 'Tersimpan' });
});

app.get('/setup', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup — ShopeePay Gateway</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
body { background: #0f172a; color: #f8fafc; min-height: 100vh; padding: 24px 16px; }
.wrap { max-width: 480px; margin: 0 auto; }
h1 { font-size: 20px; margin-bottom: 4px; }
.sub { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
.card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
label { display: block; font-size: 13px; color: #cbd5e1; margin-bottom: 6px; margin-top: 14px; }
label:first-child { margin-top: 0; }
input, textarea { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; color: #f8fafc; font-size: 14px; font-family: inherit; }
textarea { resize: vertical; min-height: 60px; }
.hint { font-size: 12px; color: #64748b; margin-top: 4px; }
button { width: 100%; background: #ee4d2d; color: #fff; border: none; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 10px; cursor: pointer; margin-top: 16px; }
button:disabled { background: #475569; cursor: not-allowed; }
.status { font-size: 13px; padding: 10px 12px; border-radius: 8px; margin-top: 12px; display: none; }
.status.ok { display: block; background: rgba(34,197,94,0.15); color: #4ade80; }
.status.err { display: block; background: rgba(239,68,68,0.15); color: #f87171; }
details { margin-top: 20px; font-size: 13px; color: #94a3b8; }
summary { cursor: pointer; color: #cbd5e1; }
ol { margin: 10px 0 0 18px; }
li { margin-bottom: 6px; }
#gate { }
#panel { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>ShopeePay Gateway — Setup</h1>
  <div class="sub">Hubungkan akun sekali di sini, host nggak perlu edit file apa pun.</div>

  <div class="card" id="gate">
    <label for="apikey">API Key</label>
    <input type="password" id="apikey" placeholder="API Key server (dari .env)">
    <button onclick="unlock()">Masuk</button>
    <div class="status" id="gate-status"></div>
  </div>

  <div id="panel">
    <div class="card">
      <label for="qris">QRIS Statis</label>
      <textarea id="qris" placeholder="00020101021126610014COM..."></textarea>
      <div class="hint">Hasil decode gambar QR "Terima Uang" ShopeePay jadi teks mentah.</div>

      <label for="token">Token Partner Portal</label>
      <input type="password" id="token" placeholder="B:xxxxxxxx...">
      <div class="hint" id="token-hint"></div>

      <label for="url">URL Endpoint Transaksi</label>
      <input type="text" id="url" placeholder="https://partner.shopee.co.id/api/.../get-transaction-list">

      <button onclick="save()">Simpan</button>
      <div class="status" id="save-status"></div>
    </div>

    <div class="card">
      <button onclick="testToken()" style="background:#334155">Tes Koneksi</button>
      <div class="status" id="test-status"></div>
    </div>

    <details>
      <summary>Cara ambil Token &amp; URL dari Partner Portal</summary>
      <ol>
        <li>Login ke <code>partner.shopee.co.id</code> di browser biasa.</li>
        <li>Buka DevTools (F12) → tab Network → filter Fetch/XHR.</li>
        <li>Refresh halaman transaksi/mutasi.</li>
        <li>Cari request bernama <code>get-transaction-list</code>.</li>
        <li>Klik kanan → Copy → Copy URL → tempel ke field "URL Endpoint Transaksi".</li>
        <li>Buka tab Payload request itu → cari <code>data.metadata.token</code> → copy nilainya (diawali "B:") → tempel ke field "Token".</li>
      </ol>
    </details>
  </div>
</div>

<script>
const KEY = 'shopeepay_setup_apikey';

function headers() {
  return { 'Content-Type': 'application/json', 'X-Api-Key': localStorage.getItem(KEY) || '' };
}

async function unlock() {
  const key = document.getElementById('apikey').value.trim();
  if (key) localStorage.setItem(KEY, key);
  const ok = await loadCurrent();
  if (ok) {
    document.getElementById('gate').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
  } else {
    showStatus('gate-status', 'err', 'API Key salah');
  }
}

async function loadCurrent() {
  const res = await fetch('/api/setup', { headers: headers() });
  if (!res.ok) return false;
  const json = await res.json();
  document.getElementById('qris').value = json.data.qris_static;
  document.getElementById('url').value = json.data.shopee_transactions_url;
  document.getElementById('token-hint').textContent = json.data.shopee_token_set
    ? 'Sudah terhubung: ' + json.data.shopee_token_masked
    : 'Belum ada token tersimpan.';
  return true;
}

async function save() {
  const body = {
    qris_static: document.getElementById('qris').value.trim(),
    shopee_token: document.getElementById('token').value.trim(),
    shopee_transactions_url: document.getElementById('url').value.trim(),
  };
  const res = await fetch('/api/setup', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const json = await res.json();
  showStatus('save-status', res.ok ? 'ok' : 'err', res.ok ? 'Tersimpan.' : (json.message || 'Gagal simpan'));
  document.getElementById('token').value = '';
  if (res.ok) loadCurrent();
}

async function testToken() {
  const res = await fetch('/token-status', { headers: headers() });
  const json = await res.json();
  const ok = json.data?.token_status === 'valid';
  showStatus('test-status', ok ? 'ok' : 'err', json.data?.message || 'Gagal cek');
}

function showStatus(id, cls, msg) {
  const el = document.getElementById(id);
  el.className = 'status ' + cls;
  el.textContent = msg;
}

if (localStorage.getItem(KEY)) unlock();
</script>
</body>
</html>`);
});

app.get('/token-status', apiKeyAuth, async (req, res) => {
    if (!sessionManager.hasToken()) {
        return res.json({ success: false, data: { token_status: 'missing', message: 'Token belum diisi — buka /setup untuk hubungkan akun.' } });
    }
    if (!sessionManager.getTransactionsUrl()) {
        return res.json({ success: false, data: { token_status: 'unknown', message: 'URL transaksi belum diisi — buka /setup.' } });
    }
    try {
        // Same request shape verifyPayment() uses — this used to POST an empty body and
        // treat any non-throwing HTTP response as "valid", but Shopee returns its own
        // errors with HTTP 200 (an error code/msg in the body, not a 4xx/5xx), so that
        // never actually caught anything. A truthy response.data.msg is Shopee's own way
        // of saying this call failed, whatever the HTTP status was.
        const response = await axios.post(sessionManager.getTransactionsUrl(), {
            data: { metadata: { token: config.get('shopeeToken', 'SHOPEE_TOKEN') } },
        }, { headers: sessionManager.getValidHeaders(), timeout: 5000 });
        if (response.data?.msg) {
            return res.json({ success: false, data: { token_status: 'invalid', message: response.data.msg } });
        }
        res.json({ success: true, data: { token_status: 'valid', message: 'Token Partner Portal aktif' } });
    } catch (err) {
        res.json({ success: false, data: { token_status: 'invalid', message: err.response?.status === 401 ? 'Token expired/ditolak, copy ulang dari DevTools' : err.message } });
    }
});

app.all('/create-qris', apiKeyAuth, (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid (gunakan ?amount=...)' });
    }

    const staticTemplate = config.get('qrisStatic', 'QRIS_STATIC');
    if (!staticTemplate) {
        return res.status(500).json({ success: false, message: 'QRIS belum dikonfigurasi — buka /setup' });
    }

    const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
    const qrisId = Math.random().toString(36).substring(2, 10);
    const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
    const createdAt = new Date();

    qrisStore.set(qrisId, { data: dynamicCode, amount: parseInt(amount, 10), trxId, expiresAt, createdAt, status: 'PENDING' });

    const publicUrl = `${req.protocol}://${req.get('host')}/qr/${qrisId}`;
    logActivity('INFO', `QRIS Dinamis dibuat | TRX-ID: ${trxId} | Nominal: Rp ${amount}`);

    res.json({
        success: true,
        data: {
            qris_id: qrisId,
            trx_id: trxId,
            qris_url: publicUrl,
            qris_code: dynamicCode,
            amount: parseInt(amount, 10),
            expires_at: expiresAt.toISOString(),
            expires_in: '5 menit',
        },
    });
});

app.get('/qr/:id', (req, res) => {
    const qris = qrisStore.get(req.params.id);
    if (!qris) return res.status(404).send('<h3>Gambar QRIS tidak ditemukan atau telah dihapus</h3>');

    if (req.query.format === 'raw' || req.query.raw === '1') {
        if (Date.now() > qris.expiresAt.getTime()) {
            qrisStore.delete(req.params.id);
            return res.status(410).send('QRIS Kedaluwarsa');
        }
        return res.redirect(302, `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qris.data)}`);
    }

    const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(qris.amount);
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qris.data)}`;
    const expiresTimestamp = qris.expiresAt.getTime();

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pembayaran QRIS - ${formattedAmount}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
.card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; width: 100%; max-width: 420px; padding: 28px 24px; text-align: center; }
.badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(238,77,45,0.15); color: #ff7a45; font-weight: 600; font-size: 13px; padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(255,122,69,0.3); margin-bottom: 16px; }
.amount-title { font-size: 14px; color: #94a3b8; margin-bottom: 4px; }
.amount-value { font-size: 28px; font-weight: 700; color: #ff7a45; margin-bottom: 20px; }
.qr-wrapper { background: #fff; padding: 16px; border-radius: 16px; display: inline-block; margin-bottom: 20px; }
.qr-wrapper img { display: block; width: 240px; height: 240px; border-radius: 8px; }
.timer-box { font-size: 14px; color: #cbd5e1; background: #0f172a; padding: 10px 16px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 20px; display: flex; justify-content: space-between; }
.timer-val { font-weight: 700; color: #f59e0b; font-family: monospace; }
.status-badge { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 12px; margin-bottom: 20px; }
.status-pending { background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
.status-paid { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
.status-expired { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.btn-check { width: 100%; background: #ee4d2d; color: #fff; border: none; font-weight: 600; font-size: 15px; padding: 14px; border-radius: 12px; cursor: pointer; }
.btn-check:disabled { background: #475569; cursor: not-allowed; }
.toggle-box { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: #94a3b8; margin-top: 16px; }
</style>
</head>
<body>
<div class="card">
  <div class="badge">QRIS Dinamis — ShopeePay</div>
  <div class="amount-title">Total Pembayaran</div>
  <div class="amount-value">${formattedAmount}</div>
  <div class="qr-wrapper"><img src="${qrImageUrl}" alt="QRIS Code"></div>
  <div class="timer-box"><span>Batas Waktu</span><span class="timer-val" id="timer-text">05:00</span></div>
  <div class="status-badge status-pending" id="status-badge"><span id="status-text">Menunggu Pembayaran</span></div>
  <button class="btn-check" id="btn-check" onclick="checkStatusManual()">Cek Status Pembayaran</button>
  <div class="toggle-box"><input type="checkbox" id="chk-auto" onchange="handleAutoPollChange(this)"><label for="chk-auto">Cek otomatis tiap 8 detik</label></div>
</div>
<script>
const qrisId = "${req.params.id}";
const expiresTimestamp = ${expiresTimestamp};
let pollTimer = null;

function updateCountdown() {
  const remain = Math.max(0, expiresTimestamp - Date.now());
  const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
  document.getElementById('timer-text').textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  if (remain <= 0) {
    document.getElementById('status-badge').className = 'status-badge status-expired';
    document.getElementById('status-text').textContent = 'Kedaluwarsa';
    document.getElementById('btn-check').disabled = true;
    if (pollTimer) clearInterval(pollTimer);
  }
}
setInterval(updateCountdown, 1000);
updateCountdown();

async function checkStatusManual() {
  const res = await fetch('/api/qr-status/' + qrisId);
  const json = await res.json();
  if (json.paid) {
    document.getElementById('status-badge').className = 'status-badge status-paid';
    document.getElementById('status-text').textContent = 'Lunas';
    document.getElementById('btn-check').disabled = true;
    if (pollTimer) clearInterval(pollTimer);
  }
}
function handleAutoPollChange(chk) {
  if (chk.checked) pollTimer = setInterval(checkStatusManual, 8000);
  else if (pollTimer) clearInterval(pollTimer);
}
</script>
</body>
</html>`);
});

// Confirmed against a real capture (2026-09-26): the list sits at data.list, amount is a
// string with "." as an Indonesian thousands separator (not a decimal point — "10.000" means
// ten thousand rupiah, not ten), createTime is UNIX seconds (not ms), and status is a NUMBER
// (3 observed on every completed transaction in that capture, matching data.totalCompletedCount
// — no other status value has been observed yet, so this is confirmed for "completed" but not
// exhaustively verified for other states like pending/cancelled).
function parseShopeeTransactions(rawData) {
    const rawTransactions = rawData?.data?.list || [];
    if (!Array.isArray(rawTransactions)) {
        // Shape doesn't match the confirmed one above — dumping the raw body here (both the
        // live log and /api/logs) is what lets that mapping get corrected again if Shopee ever
        // changes it, instead of crashing on .map with no clue what shape to expect.
        console.log('[ShopeePay] Bentuk respons transaksi tidak dikenali, raw response:', JSON.stringify(rawData));
        logActivity('ERROR', 'Format respons transaksi ShopeePay tidak dikenali — lihat log server untuk raw response, lalu sesuaikan parseShopeeTransactions().', rawData);
        return [];
    }
    return rawTransactions.map((tx) => ({
        amount: parseInt(String(tx.amount ?? tx.gross_amount ?? 0).replace(/\./g, ''), 10),
        status: String(tx.status ?? tx.transaction_status ?? ''),
        time: tx.createTime ? tx.createTime * 1000 : (tx.time || tx.transaction_time || tx.created_at),
        transaction_id: tx.transactionId || tx.id || tx.transaction_id || tx.reference_id,
    }));
}

// Core: cocokin nominal QRIS ke transaksi masuk + claim-lock (identik logic-nya
// sama verifyPayment() di gopay-api-gateaway, cuma sumber datanya beda).
async function verifyPayment(amount, startTime, userAgent, qrisId) {
    if (!sessionManager.hasToken()) throw new Error('Token belum diisi — buka /setup untuk hubungkan akun.');
    if (!sessionManager.getTransactionsUrl()) {
        throw new Error('URL transaksi belum diisi — buka /setup.');
    }

    const now = new Date();
    const startTimeISO = startTime ? new Date(startTime).toISOString() : new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    // Confirmed working (2026-09-26): the portal's own get-transaction-list request carries
    // the token inside data.metadata.token, not as a bearer header (see sessionManager.js's
    // top comment — that's literally where the token was captured from). start_time/end_time
    // are accepted as-is; whether the endpoint actually filters by them or just ignores them
    // and returns recent history regardless hasn't been confirmed either way.
    const response = await axios.post(sessionManager.getTransactionsUrl(), {
        data: {
            metadata: { token: config.get('shopeeToken', 'SHOPEE_TOKEN') },
            start_time: startTimeISO,
            end_time: now.toISOString(),
        },
    }, {
        headers: sessionManager.getValidHeaders(),
        timeout: 10000,
    });

    const transactions = parseShopeeTransactions(response.data);
    const targetAmount = parseInt(amount, 10);
    const filterStartTimeMs = startTime ? new Date(startTime).getTime() : 0;

    for (const tx of transactions) {
        const txTimestamp = new Date(tx.time || 0).getTime();
        // status "3" is the only value confirmed as "completed" so far (see
        // parseShopeeTransactions) — skipping anything else so a pending/cancelled entry
        // can never get claimed as a paid donation.
        if (tx.amount !== targetAmount || txTimestamp < filterStartTimeMs || tx.status !== '3') continue;

        const existingClaim = claimedTransactions.get(tx.transaction_id);
        if (!existingClaim) {
            claimedTransactions.set(tx.transaction_id, { qrisId, claimedAt: Date.now() });
            logActivity('INFO', `TRX ${tx.transaction_id} diklaim oleh QRIS ${qrisId || 'manual-check'}`);
            return tx;
        } else if (qrisId && existingClaim.qrisId === qrisId) {
            return tx;
        }
        // sudah diklaim QRIS lain -> skip, cari transaksi berikutnya
    }
    return null;
}

app.get('/api/qr-status/:id', async (req, res) => {
    const qrisId = req.params.id;
    const qris = qrisStore.get(qrisId);
    if (!qris) return res.json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    if (qris.status === 'PAID') return res.json({ success: true, paid: true, status: 'PAID', transaction: qris.transaction });
    if (Date.now() > qris.expiresAt.getTime()) {
        qrisStore.delete(qrisId);
        return res.json({ success: false, paid: false, status: 'EXPIRED' });
    }

    try {
        const matched = await verifyPayment(qris.amount, qris.createdAt, req.headers['user-agent'], qris.trxId || qrisId);
        if (matched) {
            qris.status = 'PAID';
            qris.transaction = matched;
            qrisStore.set(qrisId, qris);
            logActivity('SUCCESS', `Pembayaran QRIS ${qrisId} terverifikasi lunas Rp ${qris.amount}`);
            return res.json({ success: true, paid: true, status: 'PAID', transaction: matched });
        }
        return res.json({ success: true, paid: false, status: 'PENDING' });
    } catch (err) {
        return res.json({ success: false, paid: false, status: 'PENDING', message: err.message });
    }
});

app.all('/check-payment', apiKeyAuth, async (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    const startTime = req.body?.startTime || req.query?.startTime;
    const scopeId = req.body?.trx_id || req.query?.trx_id || null;
    if (!amount || isNaN(amount)) return res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid' });

    try {
        const matched = await verifyPayment(amount, startTime, req.headers['user-agent'], scopeId);
        if (matched) {
            logActivity('SUCCESS', `Pembayaran terverifikasi lunas Rp ${parseInt(amount, 10)}`, matched);
            return res.json({ success: true, paid: true, transaction: matched });
        }
        return res.json({ success: true, paid: false, message: 'Pembayaran belum ditemukan atau sudah pernah diklaim' });
    } catch (err) {
        logActivity('ERROR', `Gagal periksa pembayaran: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Gagal mengambil data transaksi dari ShopeePay', error: err.message });
    }
});

app.get('/api/logs', apiKeyAuth, (req, res) => res.json({ success: true, logs: activityLogs }));

app.listen(PORT, '0.0.0.0', () => logActivity('SYSTEM', `ShopeePay QRIS Gateway berjalan pada port ${PORT}`));
