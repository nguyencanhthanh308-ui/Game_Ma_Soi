// server/ice.js
// Danh sach may chu ICE (STUN/TURN) cho WebRTC.
//
// Vi sao can TURN: voice/camera noi THANG giua cac trinh duyet. STUN chi giup mot may biet
// dia chi cong khai cua minh; neu mot ben nam sau NAT kho (hay gap o mang 4G dung chung IP
// cua nha mang, wifi cong ty) thi hai may khong the noi thang duoc, du ca hai deu vao phong.
// Luc do can may chu TURN lam trung gian chuyen tiep. Hai nguoi cung wifi/cung nha mang
// thuong noi thang duoc, nguoi o mang khac thi khong - dung trieu chung "o gan thi thay, o xa thi khong".
//
// Cau hinh TURN qua bien moi truong (chon mot trong ba, theo thu tu uu tien):
//   1. Cloudflare Realtime TURN (khuyen dung, mien phi 1.000 GB/thang):
//        CF_TURN_KEY_ID, CF_TURN_API_TOKEN
//   2. coturn tu cai, dung "use-auth-secret":
//        TURN_URLS, TURN_SECRET
//   3. TURN co tai khoan co dinh:
//        TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL
// Khong cau hinh gi thi chi co STUN (noi duoc trong phan lon mang nha, khong phai tat ca).

const crypto = require('crypto');

const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
// Lam moi truoc khi het han mot khoang, de nguoi dang choi khong bi rot giua van
const REFRESH_MARGIN_SECONDS = 2 * 60 * 60;

const splitUrls = (value) => String(value || '').split(',').map((u) => u.trim()).filter(Boolean);

// Tai khoan tam thoi cho coturn (chuan "TURN REST API"): ten = han dung, mat khau = HMAC-SHA1 cua ten.
function coturnCredentials(secret, nowMs, ttl = CREDENTIAL_TTL_SECONDS) {
  const username = `${Math.floor(nowMs / 1000) + ttl}:masoi`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

function createIceProvider({ env = process.env, fetchFn = globalThis.fetch, now = Date.now, log = console } = {}) {
  let cache = null; // { value, expiresAt }
  let warned = false;

  function source() {
    if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return 'cloudflare';
    if (env.TURN_URLS && env.TURN_SECRET) return 'coturn';
    if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) return 'static';
    return 'none';
  }

  async function fromCloudflare() {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN trả về ${res.status}`);
    const data = await res.json();
    const turn = (data.iceServers || []).filter((s) => s.username && s.credential);
    if (!turn.length) throw new Error('Cloudflare TURN không trả về máy chủ TURN nào');
    return turn;
  }

  async function resolveTurn() {
    switch (source()) {
      case 'cloudflare': return fromCloudflare();
      case 'coturn': return [{ urls: splitUrls(env.TURN_URLS), ...coturnCredentials(env.TURN_SECRET, now()) }];
      case 'static': return [{ urls: splitUrls(env.TURN_URLS), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
      default: return [];
    }
  }

  // Tra ve { iceServers, relay, source }. Loi TURN thi van tra STUN de voice van chay duoc o mang de.
  async function getIceServers() {
    const nowSec = now() / 1000;
    if (cache && cache.expiresAt - REFRESH_MARGIN_SECONDS > nowSec) return cache.value;
    let turn = [];
    try {
      turn = await resolveTurn();
    } catch (err) {
      if (!warned) { log.warn?.('[ice] Không lấy được máy chủ TURN, tạm dùng STUN: ' + err.message); warned = true; }
      // Khong luu cache loi: lan sau thu lai
      return { iceServers: STUN_SERVERS, relay: false, source: 'none' };
    }
    const value = { iceServers: [...STUN_SERVERS, ...turn], relay: turn.length > 0, source: turn.length ? source() : 'none' };
    cache = { value, expiresAt: nowSec + CREDENTIAL_TTL_SECONDS };
    return value;
  }

  return { getIceServers, source };
}

module.exports = { createIceProvider, coturnCredentials, STUN_SERVERS, CREDENTIAL_TTL_SECONDS };
