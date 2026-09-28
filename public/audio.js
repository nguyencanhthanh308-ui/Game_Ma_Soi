// public/audio.js
// - Dan chuyen: dung Web Speech API (giong doc co san cua trinh duyet/OS), khong can file am thanh nao,
//   nen khong dinh ban quyen. Chat luong giong doc phu thuoc vao trinh duyet/thiet bi cua tung nguoi.
// - Nhac nen: chi dung file MP3 do NGUOI DUNG tu them vao public/sounds/bgm-day.mp3 va bgm-night.mp3
//   (xem README). Neu khong co file, tinh nang tu bo qua trong im lang, khong bao loi ra man hinh.

(() => {
  const narratorBtn = $('btn-toggle-narrator');
  const musicBtn = $('btn-toggle-music');
  const bgmDay = $('bgm-day');
  const bgmNight = $('bgm-night');

  const NARRATION = {
    LOBBY: '',
    NIGHT_CUPID: 'Cả làng chìm vào giấc ngủ. Thần tình yêu, hãy dậy và kết nối một đôi.',
    NIGHT_GUARD: 'Bảo vệ hãy dậy và chọn người để che chở đêm nay.',
    NIGHT_WOLVES: 'Bầy Sói hãy dậy và chọn nạn nhân đêm nay.',
    NIGHT_WHITEWOLF: 'Sói trắng hãy dậy. Bạn có thể chọn giết một Sói đồng bọn.',
    NIGHT_SEER: 'Tiên tri hãy dậy và soi một người bạn nghi ngờ.',
    NIGHT_WITCH: 'Phù thủy hãy dậy. Hãy quyết định dùng thuốc giải hoặc thuốc độc.',
    DAY_ANNOUNCE: 'Trời đã sáng, cả làng hãy thức dậy.',
    HUNTER_SHOT: 'Thợ săn hãy chọn người để mang theo trước khi ra đi.',
    DAY_DISCUSSION: 'Cả làng cùng nhau thảo luận để tìm ra Sói.',
    DAY_VOTE: 'Đã đến giờ bỏ phiếu. Hãy chọn người bạn nghi ngờ nhất.',
    DAY_RESOLVE: '',
    GAME_OVER: 'Ván chơi đã kết thúc.',
  };

  const settings = {
    narratorOn: localStorage.getItem('masoi_narrator') !== 'off',
    musicOn: localStorage.getItem('masoi_music') === 'on', // mac dinh TAT (can nguoi dung tu bat, tranh am thanh bat ngo)
  };

  function updateButtons() {
    narratorBtn.textContent = '🔊 Dẫn chuyện: ' + (settings.narratorOn ? 'Bật' : 'Tắt');
    narratorBtn.setAttribute('aria-pressed', String(settings.narratorOn));
    musicBtn.textContent = '🎵 Nhạc nền: ' + (settings.musicOn ? 'Bật' : 'Tắt');
    musicBtn.setAttribute('aria-pressed', String(settings.musicOn));
  }

  function speak(text) {
    if (!settings.narratorOn || !text) return;
    if (!('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'vi-VN';
      utter.rate = 0.95;
      speechSynthesis.cancel(); // ngat cau dan truoc do neu con dang doc do
      speechSynthesis.speak(utter);
    } catch (e) { /* mot so trinh duyet/thiet bi khong ho tro - bo qua */ }
  }

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
    toPlay.play().catch(() => { /* thieu file nhac hoac trinh duyet chan autoplay - bo qua trong im lang */ });
  }

  function stopAllMusic() {
    bgmDay.pause();
    bgmNight.pause();
    currentTrack = null;
  }

  narratorBtn.addEventListener('click', () => {
    settings.narratorOn = !settings.narratorOn;
    localStorage.setItem('masoi_narrator', settings.narratorOn ? 'on' : 'off');
    if (!settings.narratorOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    updateButtons();
  });

  musicBtn.addEventListener('click', () => {
    settings.musicOn = !settings.musicOn;
    localStorage.setItem('masoi_music', settings.musicOn ? 'on' : 'off');
    updateButtons();
    if (settings.musicOn && state.lastGameState) playMusicFor(state.lastGameState.phase);
    else stopAllMusic();
  });

  updateButtons();

  // Goi tu app.js moi khi pha game thay doi
  window.gameAudio = {
    onPhaseChange(phase) {
      speak(NARRATION[phase] || '');
      playMusicFor(phase);
    },
  };
})();
