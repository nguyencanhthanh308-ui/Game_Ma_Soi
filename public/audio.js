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
  // Danh sach giong (nhat la giong online cua Edge) tai bat dong bo: lan goi dau getVoices()
  // thuong tra ve mang rong. Cho toi da 2 giay truoc khi ket luan la khong co giong.
  function voicesReady() {
    if (!synth || voices.length) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        refreshVoices();
        if (voices.length || Date.now() - started > 2000) resolve();
        else setTimeout(poll, 150);
      };
      poll();
    });
  }
  function vietnameseVoice() {
    const vi = voices.filter((v) => /^vi\b|^vi[-_]/i.test(v.lang));
    return vi.find((v) => /natural|online/i.test(v.name)) || vi[0] || null;
  }

  let noVoiceWarned = false;
  function warnNoVoice() {
    if (noVoiceWarned) return;
    noVoiceWarned = true;
    toast('Máy này chưa có giọng đọc tiếng Việt nên chỉ phát âm báo. Mở game bằng Microsoft Edge để nghe dẫn chuyện.');
  }

  // Giu tham chieu toi cac cau dang doc: Chrome co loi thu gom rac utterance giua chung,
  // lam cau bi cat hoac im lang.
  let activeUtterances = [];
  let speakToken = 0;
  async function speak(lines, delayMs = 0) {
    lines = lines.filter(Boolean);
    if (!settings.narratorOn || !lines.length) return;
    if (!synth) return warnNoVoice();
    const token = ++speakToken;
    await voicesReady();
    if (token !== speakToken) return; // da co pha moi hon, bo cau cu
    const voice = vietnameseVoice();
    // Khong co giong tieng Viet thi giong tieng Anh se doc sai het, thanh ra khong doc gi.
    if (!voice) return warnNoVoice();
    synth.cancel();
    // Goi speak() ngay sau cancel() trong cung mot nhip thi Chrome hay nuot mat cau moi.
    setTimeout(() => {
      if (token !== speakToken || !settings.narratorOn) return;
      synth.resume();
      activeUtterances = lines.map((text) => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.voice = voice;
        utter.lang = voice.lang;
        utter.rate = 0.95;
        synth.speak(utter);
        return utter;
      });
    }, Math.max(80, delayMs));
  }
  function stopSpeaking() {
    speakToken++;
    activeUtterances = [];
    synth?.cancel();
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
    let wait = 0;
    let lines = [];
    if (phase === 'GAME_OVER') {
      const w = gs?.winner;
      // WINNER_LABEL la const cap cao nhat trong app.js: dung chung pham vi toan cuc nhung khong nam tren window
      const labels = typeof WINNER_LABEL !== 'undefined' ? WINNER_LABEL : {};
      const title = (w && labels[w.winner]?.title) || '';
      wait = cue('over');
      lines = ['Ván chơi đã kết thúc.', title, w?.reason];
    } else if (prevPhase === 'LOBBY') {
      wait = cue('start');
      lines = [LINE_START, isNight ? LINE_NIGHTFALL : '', NARRATION[phase]];
    } else if (isNight && !wasNight) {
      wait = cue('night');
      lines = [LINE_NIGHTFALL, NARRATION[phase]];
    } else if (isNight) {
      wait = cue('call');
      lines = [CLOSE[prevPhase], NARRATION[phase]];
    } else if (phase === 'DAY_ANNOUNCE') {
      wait = cue('dawn');
      lines = [wasNight ? CLOSE[prevPhase] : '', ...dawnLines(gs)];
    } else if (NARRATION[phase]) {
      wait = cue('call');
      lines = [NARRATION[phase]];
    }
    speak(lines, wait);
  }

  narratorBtn.addEventListener('click', () => {
    settings.narratorOn = !settings.narratorOn;
    saveSetting('masoi_narrator', settings.narratorOn ? 'on' : 'off');
    updateButtons();
    if (!settings.narratorOn) return stopSpeaking();
    // Dang trong mot cu click nen day la luc chac chan duoc phep phat am thanh
    const wait = cue('call');
    speak([NARRATION[state.lastGameState?.phase] || 'Đã bật tiếng dẫn chuyện.'], wait);
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
    if (settings.narratorOn) audioContext();
    if (settings.musicOn && state.lastGameState) playMusicFor(state.lastGameState.phase);
  }
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  // Goi tu app.js moi khi pha game thay doi
  window.gameAudio = {
    onPhaseChange(phase, prevPhase, gs) {
      narrate(phase, prevPhase, gs);
      playMusicFor(phase);
    },
  };
})();
