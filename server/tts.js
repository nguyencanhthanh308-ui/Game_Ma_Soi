// server/tts.js
// Giong doc du phong cho trinh duyet khong co giong tieng Viet (Coc Coc, Firefox, Chrome ban
// khong co giong Google...). Trinh duyet tai file mp3 tu chinh server nay; server lay ho tu
// dich vu doc cua Google Translate va giu lai trong bo nho, vi loi dan lap lai rat nhieu.

const https = require('https');

const MAX_TEXT = 200; // Google chi nhan cau ngan; client da tu cat cau dai thanh nhieu doan
const MAX_CACHE = 300;
const cache = new Map(); // text -> Buffer mp3, xep theo lan dung gan nhat

function validText(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT;
}

function fetchSpeech(text) {
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=' + encodeURIComponent(text);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('TTS status ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('TTS timeout')));
    req.on('error', reject);
  });
}

async function speech(text) {
  if (cache.has(text)) {
    const hit = cache.get(text);
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const audio = await fetchSpeech(text);
  cache.set(text, audio);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return audio;
}

module.exports = { speech, validText, MAX_TEXT };
