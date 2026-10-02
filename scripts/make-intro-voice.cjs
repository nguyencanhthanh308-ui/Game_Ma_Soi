// scripts/make-intro-voice.cjs
// Thu san loi dan chuyen cho trang public/intro.html thanh cac file mp3, chay MOT LAN roi
// dung mai. Lam vay thi trang intro khong can mang, khong can server, chay duoc tren moi
// trinh duyet (ke ca Coc Coc, Firefox, Safari), va giong giong het nhau moi lan quay video.
//
// API key chi nam o may ban, khong bao gio di vao trang web.
//
// Cach dung:
//   set ELEVENLABS_API_KEY=sk_...        (PowerShell: $env:ELEVENLABS_API_KEY='sk_...')
//   node scripts/make-intro-voice.cjs
//
// Tham so tuy chon:
//   --voice <id>     chon giong khac (mac dinh la Adam)
//   --model <id>     mac dinh eleven_multilingual_v2, la model doc duoc tieng Viet
//   --list           in danh sach giong trong tai khoan roi thoat
//   --force          ghi de file da co
//
// Luu y: Adam la giong nam TIENG ANH. Doc tieng Viet duoc nhung co chat lo lo cua nguoi
// nuoc ngoai. Nghe thu roi hay thu san ca loat.

const fs = require('fs');
const path = require('path');
const https = require('https');

// Loi dan phai khop voi object SAY trong public/intro.html: ten khoa chinh la ten file mp3.
const LINES = {
  moDau:    'Giữa rừng sâu, có một ngôi làng. Ban ngày yên ả.',
  cauHoi:   'Nhưng khi màn đêm buông xuống, không ai còn chắc người ngồi cạnh mình là ai.',
  vaoLang:  'Chỉ cần một đường link. Ba đến hai mươi người. Không cần tài khoản.',
  vaiTro:   'Mười sáu vai trò. Mỗi người một lá bài riêng, không ai biết lá bài của người khác.',
  baySoi:   'Đêm xuống, cả làng nhắm mắt. Bầy Sói hãy dậy, và chọn lấy con mồi đêm nay.',
  baKenh:   'Bầy Sói bàn bạc riêng. Người đã khuất trò chuyện với nhau. Người sống không nghe được gì.',
  boPhieu:  'Trời sáng. Một người đã không còn thức dậy nữa. Thảo luận, buộc tội, rồi bỏ phiếu.',
  tinhNang: 'Web lo hết phần quản trò: chia vai, dẫn đêm, đếm giờ, gom phiếu. Bạn chỉ việc chơi.',
  chot:     'Trăng Khuyết. Ma Sói Online.',
  moiGoi:   'Thắp lửa, gọi bạn bè, và bước vào ngôi làng.',
};

const ADAM = 'pNInz6obpgDQGcFmaJgB';   // giong Adam co san cua ElevenLabs
const OUT_DIR = path.join(__dirname, '..', 'public', 'sounds', 'intro');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes('--' + name);

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = arg('voice', ADAM);
const MODEL = arg('model', 'eleven_multilingual_v2');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buffer.toString('utf8').slice(0, 300)}`));
        }
        resolve(buffer);
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Qua 30 giay khong thay tra loi')));
    if (body) req.write(body);
    req.end();
  });
}

async function listVoices() {
  const body = await request({
    hostname: 'api.elevenlabs.io', path: '/v1/voices', method: 'GET',
    headers: { 'xi-api-key': KEY },
  });
  JSON.parse(body.toString('utf8')).voices.forEach((v) => {
    console.log(`${v.voice_id}  ${v.name}${v.labels?.description ? '  (' + v.labels.description + ')' : ''}`);
  });
}

function speak(text) {
  const payload = JSON.stringify({
    text,
    model_id: MODEL,
    // stability thap mot chut cho giong co nhan nha, similarity cao de giu dung chat giong
    voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
  });
  return request({
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    method: 'POST',
    headers: {
      'xi-api-key': KEY,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      accept: 'audio/mpeg',
    },
  }, payload);
}

async function main() {
  if (!KEY) {
    console.error('Thieu ELEVENLABS_API_KEY.');
    console.error('PowerShell:  $env:ELEVENLABS_API_KEY = "sk_..."');
    console.error('CMD:         set ELEVENLABS_API_KEY=sk_...');
    process.exit(1);
  }
  if (has('list')) return listVoices();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Giong ${VOICE}, model ${MODEL}`);
  console.log(`Ghi vao ${OUT_DIR}\n`);

  for (const [name, text] of Object.entries(LINES)) {
    const file = path.join(OUT_DIR, name + '.mp3');
    if (fs.existsSync(file) && !has('force')) {
      console.log(`bo qua  ${name}.mp3 (da co, them --force de ghi de)`);
      continue;
    }
    process.stdout.write(`doc     ${name} … `);
    const audio = await speak(text);
    fs.writeFileSync(file, audio);
    console.log(`${(audio.length / 1024).toFixed(0)} KB`);
    await new Promise((r) => setTimeout(r, 400));   // gian ra cho khoi dinh gioi han goi
  }

  console.log('\nXong. Mo lai public/intro.html, thanh duoi se bao "Giọng: file thu sẵn".');
}

main().catch((err) => {
  console.error('\nLoi:', err.message);
  process.exit(1);
});
