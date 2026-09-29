// public/audio.js
// - Dan chuyen: dung Web Speech API (giong doc co san cua trinh duyet/OS), khong can file am thanh nao,
//   nen khong dinh ban quyen. Chat luong giong doc phu thuoc vao trinh duyet/thiet bi cua tung nguoi.
// - Am bao (bat dau game, man dem, troi sang, goi vai...): tong hop bang Web Audio ngay trong code,
//   nen van nghe duoc ca tren may khong co giong doc tieng Viet.
// Music loops are bundled WAV assets synthesized by scripts/generate-music.cjs.

(() => {
  const narratorBtn = $('btn-toggle-narrator');
  const musicBtn = $('btn-toggle-music');
  const bgmDay = $('bgm-day');
  const bgmNight = $('bgm-night');

  // Loi goi vai khi pha bat dau
  const NARRATION = {
    NIGHT_CUPID: 'Thần tình yêu, hãy dậy và kết nối một đôi.',
    NIGHT_GUARD: 'Bảo vệ hãy dậy và chọn người để che chở đêm nay.',
    NIGHT_WOLVES: 'Bầy Sói hãy dậy và chọn nạn nhân đêm nay.',
    NIGHT_WHITEWOLF: 'Sói trắng hãy dậy. Bạn có thể chọn giết một Sói đồng bọn.',
    NIGHT_SEER: 'Tiên tri hãy dậy và soi một người bạn nghi ngờ.',
    NIGHT_WITCH: 'Phù thủy hãy dậy. Hãy quyết định cứu người, sau đó chọn dùng thuốc độc.',
    HUNTER_SHOT: 'Thợ săn hãy chọn người để mang theo trước khi ra đi.',
    DAY_DISCUSSION: 'Cả làng cùng nhau thảo luận để tìm ra Sói.',
    DAY_VOTE: 'Đã đến giờ bỏ phiếu. Hãy chọn người bạn nghi ngờ nhất.',
  };
  // Loi cho vai vua xong luot nham mat lai, doc truoc khi goi vai tiep theo
  const CLOSE = {
    NIGHT_CUPID: 'Thần tình yêu hãy nhắm mắt.',
    NIGHT_GUARD: 'Bảo vệ hãy nhắm mắt.',
    NIGHT_WOLVES: 'Bầy Sói hãy nhắm mắt.',
    NIGHT_WHITEWOLF: 'Sói trắng hãy nhắm mắt.',
    NIGHT_SEER: 'Tiên tri hãy nhắm mắt.',
    NIGHT_WITCH: 'Phù thủy hãy nhắm mắt.',
  };
  const LINE_START = 'Trò chơi bắt đầu. Hãy xem vai trò bí mật của mình và đừng để ai thấy.';
  const LINE_NIGHTFALL = 'Màn đêm buông xuống. Cả làng hãy nhắm mắt đi ngủ.';
  const LINE_DAWN = 'Trời đã sáng, cả làng hãy thức dậy.';

  const settings = {
    narratorOn: readSetting('masoi_narrator') !== 'off',
    musicOn: readSetting('masoi_music') === 'on', // mac dinh TAT (can nguoi dung tu bat, tranh am thanh bat ngo)
  };
  function readSetting(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function saveSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* che do an danh: bo qua */ }
  }

  function updateButtons() {
    narratorBtn.textContent = '🔊 Dẫn chuyện: ' + (settings.narratorOn ? 'Bật' : 'Tắt');
    narratorBtn.setAttribute('aria-pressed', String(settings.narratorOn));
    musicBtn.textContent = '🎵 Nhạc nền: ' + (settings.musicOn ? 'Bật' : 'Tắt');
    musicBtn.setAttribute('aria-pressed', String(settings.musicOn));
  }

  // ---------- Giong doc ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  function refreshVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) {
    refreshVoices();
    synth.addEventListener?.('voiceschanged', refreshVoices);
  }
  function vietnameseVoice() {
    const vi = voices.filter((v) => /^vi\b|^vi[-_]/i.test(v.lang));
    return vi.find((v) => v.localService) || vi[0] || null;
  }
  // Edge tra ve giong cuc bo (tieng Anh) truoc, giong online tieng Viet toi sau qua voiceschanged.
  // Vi vay phai cho toi khi thay giong tieng Viet (toi da 3 giay), khong chi cho danh sach khac rong.
  function waitForVietnameseVoice() {
    if (!synth) return Promise.resolve(null);
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        refreshVoices();
        const voice = vietnameseVoice();
        if (voice || Date.now() - started > 3000) resolve(voice);
        else setTimeout(poll, 150);
      };
      poll();
    });
  }

  let noVoiceWarned = false;
  function warnNoVoice() {
    if (noVoiceWarned) return;
    noVoiceWarned = true;
    toast('Máy này chưa có giọng đọc tiếng Việt nên chỉ phát âm báo. Mở trò chơi bằng Microsoft Edge để nghe dẫn chuyện.');
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- Hang doi cau doc ----------
  // Moi lan chi dua MOT cau cho trinh duyet, thay vi xep ca loat vao speechSynthesis:
  //  - sang pha moi thi huy loi dan cu, tranh doc nham vai khi luot da chuyen;
  //  - go ket duoc khi trinh duyet khong bao 'end' cho mot cau.
  let queue = [];
  let current = null; // cau dang doc; giu tham chieu vi Chrome hay thu gom rac utterance giua chung
  let drained = null; // goi khi hang doi het, de nha khoa dan chuyen cho tab khac
  let watchdog = null;
  let nextTimer=null;
  let generation=0;
  let unlocked=false;
  let pendingNarration=null;

  function finishQueue() {
    clearTimeout(watchdog);
    clearTimeout(nextTimer);
    current = null;
    queue = [];
    const done = drained;
    drained = null;
    done?.();
  }
  function speakNext() {
    clearTimeout(watchdog);
    const item = queue.shift();
    if (!item || !settings.narratorOn) return finishQueue();
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.voice = item.voice;
    utter.lang = item.voice.lang;
    utter.rate = 0.95;
    let ended = false;
    const next = () => {
      if (ended || current !== utter) return;
      ended = true;
      // Goi speak() ngay trong nhip vua ket thuc/cancel thi Chrome hay nuot mat cau moi
      clearTimeout(watchdog);
      nextTimer=setTimeout(speakNext, 60);
    };
    utter.onend = next;
    utter.onerror = next;
    current = utter;
    utter.onstart=()=>{if(current===utter&&item.key)saveSetting('masoi_narrated',item.key);};
    synth.resume();
    synth.speak(utter);
    // Khoang 12 ky tu/giay, cong them thoi gian tai giong online. Qua han thi coi nhu ket va bo qua.
    watchdog = setTimeout(() => { if(current===utter){synth.cancel();next();} }, 5000 + item.text.length * 120);
  }
  function playLines(lines, voice, delayMs, key) {
    return new Promise((resolve) => {
      drained = resolve;
      queue = lines.map((text) => ({ text, voice, key }));
      nextTimer=setTimeout(() => { if (!current) speakNext(); }, Math.max(80, delayMs));
    });
  }
  function stopSpeaking() {
    generation++;
    const owned=!!current;
    finishQueue();
    if(owned)synth?.cancel();
  }

  // ---------- Chi mot tab doc moi lan ----------
  // Moi tab trong cung trinh duyet dung chung MOT bo doc. Mo nhieu tab (vi du tu choi thu voi
  // nhieu nguoi tren mot may) thi cac tab cung doc va huy cau cua nhau, lam bo doc bi treo.
  // Dung Web Locks de chi mot tab duoc doc tai mot thoi diem, va moi lan doi pha chi doc mot lan.
  let latestKey = null;
  function narrateExclusive(key, cueName, lines) {
    lines = lines.filter(Boolean);
    if (!settings.narratorOn || (!lines.length && !cueName)) return;
    pendingNarration={key,cueName,lines};
    if(document.hidden||!unlocked)return;
    stopSpeaking();
    const token=generation;
    latestKey = key;
    queue = []; // Chi giu loi dan cua luot hien tai.
    const run = async () => {
      if (token!==generation || document.hidden || key !== latestKey) return;
      if (key && readSetting('masoi_narrated') === key) return; // tab khac da doc lan doi pha nay
      const wait = cue(cueName);
      if (!lines.length) return sleep(wait);
      const voice = await waitForVietnameseVoice();
      if (!settings.narratorOn || document.hidden || token!==generation || key !== latestKey) return;
      // Khong co giong tieng Viet thi giong tieng Anh se doc sai het, nen chi giu am bao.
      if (!voice) { warnNoVoice(); return sleep(wait); }
      await playLines(lines, voice, wait, key);
    };
    if (navigator.locks?.request) navigator.locks.request('masoi-narrator', run).catch(() => {});
    else run();
  }

  // ---------- Am bao tong hop ----------
  let ctx = null;
  function audioContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Mot not nhac co bao (attack ngan, tat dan) de khong bi tieng "tach"
  function note(freq, at, dur, { type = 'sine', gain = 0.16, slideTo = null } = {}) {
    const c = audioContext();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  // Moi am bao tra ve thoi luong (ms) de giong doc bat dau sau khi am bao ket thuc
  const CUES = {
    start() { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.14, 0.5, { type: 'triangle' })); return 900; },
    night() {
      note(392, 0, 1.4, { slideTo: 196, gain: 0.14 });
      note(98, 0.1, 1.6, { gain: 0.1 });
      note(440, 0.9, 1.3, { type: 'triangle', slideTo: 330, gain: 0.07 }); // tieng hu xa
      return 1500;
    },
    dawn() { [784, 988, 1175, 1568].forEach((f, i) => note(f, i * 0.11, 0.35, { type: 'triangle', gain: 0.12 })); note(1568, 0.5, 0.6, { slideTo: 2093, gain: 0.06 }); return 1100; },
    call() { note(880, 0, 0.9, { gain: 0.12 }); note(1320, 0, 0.6, { gain: 0.05 }); return 600; },
    over() { [784, 659, 523, 392].forEach((f, i) => note(f, i * 0.18, 0.6, { type: 'triangle' })); return 1200; },
  };
  function cue(name) {
    if (!settings.narratorOn || !CUES[name]) return 0;
    return CUES[name]() || 0;
  }

  // ---------- Nhac nen ----------
  let currentTrack = null; // 'day' | 'night' | null
  function playMusicFor(phase) {
    if (!settings.musicOn) return;
    const isNight = phase.startsWith('NIGHT_');
    const wanted = isNight ? 'night' : 'day';
    if (wanted === currentTrack) return;
    currentTrack = wanted;
    const toPlay = wanted === 'night' ? bgmNight : bgmDay;
    const toPause = wanted === 'night' ? bgmDay : bgmNight;
    toPause.pause();
    toPlay.volume = 0.35;
    toPlay.play().catch(() => { currentTrack = null; });
  }

  function stopAllMusic() {
    bgmDay.pause();
    bgmNight.pause();
    currentTrack = null;
  }

  // ---------- Ghep am bao + loi dan theo tung lan doi pha ----------
  function dawnLines(gs) {
    const deaths = gs?.lastDeaths || [];
    if (!deaths.length) return [LINE_DAWN, 'Đêm qua bình yên, không ai mất.'];
    return [LINE_DAWN, `Đêm qua, ${deaths.map((d) => d.name).join(', ')} đã ra đi.`];
  }
  function narrate(phase, prevPhase, gs) {
    // Mo trang giua van (vua tai lai) thi im lang, tranh am thanh bat ngo
    if (!prevPhase || phase === 'LOBBY') return;
    const isNight = phase.startsWith('NIGHT_');
    const wasNight = prevPhase.startsWith('NIGHT_');
    let cueName = null;
    let lines = [];
    if (phase === 'GAME_OVER') {
      const w = gs?.winner;
      // WINNER_LABEL la const cap cao nhat trong app.js: dung chung pham vi toan cuc nhung khong nam tren window
      const labels = typeof WINNER_LABEL !== 'undefined' ? WINNER_LABEL : {};
      const title = (w && labels[w.winner]?.title) || '';
      cueName = 'over';
      lines = ['Ván chơi đã kết thúc.', title, w?.reason];
    } else if (phase === 'ROLE_REVEAL') {
      cueName = 'start';
      lines = [LINE_START, 'Đọc xong vai trò, hãy bấm sẵn sàng.'];
    } else if (prevPhase === 'LOBBY') {
      cueName = 'start';
      lines = [LINE_START, isNight ? LINE_NIGHTFALL : '', NARRATION[phase]];
    } else if (isNight && !wasNight) {
      cueName = 'night';
      lines = [LINE_NIGHTFALL, NARRATION[phase]];
    } else if (isNight) {
      cueName = 'call';
      lines = [CLOSE[prevPhase], NARRATION[phase]];
    } else if (phase === 'DAY_ANNOUNCE') {
      cueName = 'dawn';
      lines = [wasNight ? CLOSE[prevPhase] : '', ...dawnLines(gs)];
    } else if (NARRATION[phase]) {
      cueName = 'call';
      lines = [NARRATION[phase]];
    }
    if (!cueName) return;
    // Moi tab nhan cung game_state; phaseEndsAt do server dat nen giong nhau o moi tab va khac nhau
    // giua cac lan vao pha, ke ca khi choi lai van moi trong cung phong.
    narrateExclusive(`${gs?.roomCode}:${phase}:${gs?.phaseEndsAt}:${gs?.actionRound}:${gs?.actionVersion}`, cueName, lines);
  }

  narratorBtn.addEventListener('click', () => {
    unlocked=true;
    settings.narratorOn = !settings.narratorOn;
    saveSetting('masoi_narrator', settings.narratorOn ? 'on' : 'off');
    updateButtons();
    if (!settings.narratorOn) return stopSpeaking();
    // Dang trong mot cu click nen day la luc chac chan duoc phep phat am thanh.
    // Khoa rieng theo thoi diem bam de tab nay luon doc, ke ca khi tab khac vua doc cung pha.
    narrateExclusive(`toggle:${Date.now()}`, 'call', [NARRATION[state.lastGameState?.phase] || 'Đã bật tiếng dẫn chuyện.']);
  });

  musicBtn.addEventListener('click', () => {
    settings.musicOn = !settings.musicOn;
    saveSetting('masoi_music', settings.musicOn ? 'on' : 'off');
    updateButtons();
    if (settings.musicOn && state.lastGameState) playMusicFor(state.lastGameState.phase);
    else stopAllMusic();
  });

  updateButtons();
  // Trinh duyet chi cho phat am thanh sau mot thao tac cua nguoi dung: tan dung moi lan
  // cham/bam phim de mo khoa Web Audio va giong doc, de cac lan doi pha sau phat duoc.
  function unlock() {
    const first=!unlocked;
    unlocked=true;
    if (settings.narratorOn) audioContext();
    if (settings.musicOn && state.lastGameState) playMusicFor(state.lastGameState.phase);
    if(first&&pendingNarration){const p=pendingNarration;narrateExclusive(p.key,p.cueName,p.lines);}
  }
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopSpeaking();
    else if(pendingNarration){const p=pendingNarration;narrateExclusive(p.key,p.cueName,p.lines);}
  });

  // Goi tu app.js moi khi pha game thay doi
  window.gameAudio = {
    onPhaseChange(phase, prevPhase, gs) {
      pendingNarration=null;stopSpeaking();
      narrate(phase, prevPhase, gs);
      playMusicFor(phase);
    },
  };
})();
