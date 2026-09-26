// server/roles.js
// Dinh nghia toan bo vai tro trong game va cong thuc chia vai tro mac dinh.

const TEAM = {
  WOLF: 'wolf',
  VILLAGE: 'village',
};

// Thong tin hien thi cho tung vai tro (dung de gui ve client khi lo vai)
const ROLE_INFO = {
  "villager": {
    "id": "villager",
    "name": "Dân làng",
    "team": "village",
    "icon": "🧑‍🌾",
    "desc": "Không có năng lực ban đêm. Quan sát lời nói và bỏ phiếu tìm Sói.",
    "play": "Thảo luận ban ngày và bỏ phiếu cho người bạn nghi ngờ.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 20
  },
  "werewolf": {
    "id": "werewolf",
    "name": "Sói thường",
    "team": "wolf",
    "icon": "🐺",
    "desc": "Cùng bầy Sói chọn nạn nhân mỗi đêm. Hòa phiếu sẽ chọn ngẫu nhiên trong các mục tiêu nhiều phiếu nhất.",
    "play": "Chọn một nạn nhân khi đến lượt Bầy Sói; ban ngày che giấu danh tính.",
    "win": "Bầy Sói đạt số lượng bằng hoặc lớn hơn những người còn lại, sau khi loại Sói trắng.",
    "maxCount": 20
  },
  "wolfcub": {
    "id": "wolfcub",
    "name": "Sói con",
    "team": "wolf",
    "icon": "🐾",
    "desc": "Tham gia săn cùng bầy Sói. Khi bạn chết, bầy được săn hai lượt vào đêm tiếp theo.",
    "play": "Chọn nạn nhân như Sói thường. Năng lực trả thù tự kích hoạt khi chết.",
    "win": "Bầy Sói đạt số lượng bằng hoặc lớn hơn những người còn lại, sau khi loại Sói trắng.",
    "maxCount": 1
  },
  "whitewolf": {
    "id": "whitewolf",
    "name": "Sói trắng",
    "team": "solo",
    "icon": "❄️",
    "desc": "Săn cùng bầy nhưng có mục tiêu riêng. Một lần mỗi ván, được giết thêm một Sói khác; Bảo vệ có thể chặn đòn này.",
    "play": "Bỏ phiếu cùng bầy, rồi chọn giết đồng bọn hoặc bỏ qua ở lượt Sói trắng.",
    "win": "Trở thành người sống sót cuối cùng.",
    "maxCount": 1
  },
  "seer": {
    "id": "seer",
    "name": "Tiên tri",
    "team": "village",
    "icon": "🔮",
    "desc": "Mỗi đêm kiểm tra một người để biết họ có bị nhìn nhận là Sói hay không. Người hóa sói có thể gây kết quả sai.",
    "play": "Chọn một người khác còn sống ở lượt Tiên tri. Kết quả chỉ gửi riêng cho bạn.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "guard": {
    "id": "guard",
    "name": "Bảo vệ",
    "team": "village",
    "icon": "🛡️",
    "desc": "Bảo vệ một người khỏi Sói cắn mỗi đêm, có thể chọn bản thân; không bảo vệ cùng người hai đêm liên tiếp. Không chặn thuốc độc.",
    "play": "Chọn mục tiêu bảo vệ hoặc bỏ qua khi đến lượt.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "witch": {
    "id": "witch",
    "name": "Phù thủy",
    "team": "village",
    "icon": "🧪",
    "desc": "Có một thuốc cứu và một thuốc độc, mỗi loại dùng một lần trong ván. Mỗi lượt chọn cứu, đầu độc hoặc bỏ qua. Thuốc cứu chỉ cứu nạn nhân lần cắn đầu.",
    "play": "Xem nạn nhân Sói cắn trước khi quyết định. Thuốc độc xuyên qua Bảo vệ và sức chống cắn.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "hunter": {
    "id": "hunter",
    "name": "Thợ săn",
    "team": "village",
    "icon": "🏹",
    "desc": "Khi chết vì bất kỳ nguyên nhân nào, được bắn một người còn sống. Hết giờ không chọn thì bắn ngẫu nhiên.",
    "play": "Khi lượt Thợ săn xuất hiện, chọn người bạn muốn kéo theo.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "cupid": {
    "id": "cupid",
    "name": "Thần tình yêu",
    "team": "village",
    "icon": "💘",
    "desc": "Đêm đầu ghép hai người thành cặp, có thể chọn bản thân. Một người chết thì người kia chết theo. Cặp đôi thắng riêng khi là hai người cuối cùng.",
    "play": "Chọn đúng hai người khác nhau trong lượt đầu tiên.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "lycan": {
    "id": "lycan",
    "name": "Người hóa sói",
    "team": "village",
    "icon": "🌘",
    "desc": "Bạn thuộc phe Làng nhưng Tiên tri luôn nhìn thấy bạn là Sói. Không có hành động ban đêm.",
    "play": "Thuyết phục làng bằng lập luận; kết quả soi bạn có thể gây hiểu nhầm.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "cursed": {
    "id": "cursed",
    "name": "Kẻ bị nguyền",
    "team": "village",
    "icon": "🩸",
    "desc": "Lần đầu bị Sói cắn mà không được cứu hoặc bảo vệ, bạn sống sót và biến thành Sói thường. Thuốc độc vẫn giết bạn.",
    "play": "Trước khi biến đổi chơi cùng Làng; sau đó thẻ vai cập nhật và bạn tham gia săn với Sói.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết. Nếu biến thành Sói, điều kiện thắng chuyển sang phe Sói.",
    "maxCount": 1
  },
  "elder": {
    "id": "elder",
    "name": "Già làng",
    "team": "village",
    "icon": "🌳",
    "desc": "Chịu được một lần Sói cắn không được cứu hoặc bảo vệ; lần cắn tiếp theo sẽ chết. Các nguyên nhân khác giết ngay.",
    "play": "Năng lực tự động. Trong luật của phòng này, cái chết của bạn không tước năng lực của làng.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "toughguy": {
    "id": "toughguy",
    "name": "Người cứng cỏi",
    "team": "village",
    "icon": "💪",
    "desc": "Khi bị Sói cắn, sống thêm qua một ngày và chết vào sáng hôm sau. Thuốc độc, treo cổ và liên kết tình yêu vẫn giết ngay.",
    "play": "Dùng ngày sống thêm để giúp làng. Khi đã bị thương, Bảo vệ không xóa được vết thương.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "prince": {
    "id": "prince",
    "name": "Hoàng tử",
    "team": "village",
    "icon": "👑",
    "desc": "Thoát chết ở lần đầu bị làng bỏ phiếu treo cổ; danh tính được công khai. Những lần sau vẫn bị treo cổ.",
    "play": "Năng lực tự kích hoạt khi bị treo cổ. Vẫn có thể bị giết vào ban đêm.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 1
  },
  "tanner": {
    "id": "tanner",
    "name": "Chán đời",
    "team": "solo",
    "icon": "🃏",
    "desc": "Bạn thắng riêng ngay khi bị làng bỏ phiếu treo cổ. Chết do Sói, độc, súng hoặc tình yêu không giúp bạn thắng.",
    "play": "Thuyết phục làng bỏ phiếu treo cổ mình mà không để lộ mục tiêu.",
    "win": "Bị bỏ phiếu treo cổ; ván kết thúc ngay với chiến thắng của bạn.",
    "maxCount": 1
  },
  "mason": {
    "id": "mason",
    "name": "Hội Tam điểm",
    "team": "village",
    "icon": "🤝",
    "desc": "Biết những người khác cùng Hội Tam điểm ngay khi nhận vai. Không có hành động đặc biệt ban đêm.",
    "play": "Dùng đồng minh đã biết để suy luận và bảo vệ nhau trong thảo luận.",
    "win": "Loại bỏ tất cả Sói, kể cả Sói trắng. Bạn vẫn thắng cùng phe nếu đã chết.",
    "maxCount": 20
  }
};

function getRoleInfo(roleId) {
  return ROLE_INFO[roleId] || null;
}

function isWolfTeam(roleId) {
  const info = ROLE_INFO[roleId];
  return !!info && (info.team === TEAM.WOLF || roleId === 'whitewolf');
}

// Cong thuc de xuat so luong vai tro theo tong so nguoi choi.
// Duoc thiet ke chinh cho 12-15 nguoi nhung van hop ly voi cac so luong khac.
function getDefaultRoleConfig(n) {
  const config = Object.fromEntries(Object.keys(ROLE_INFO).map(id => [id, 0]));

  if (n >= 6) {
    config.seer = 1;
    config.witch = 1;
  }
  if (n >= 8) {
    config.guard = 1;
    config.hunter = 1;
  }
  if (n >= 9) {
    config.cupid = 1;
    config.wolfcub = 1;
  }
  if (n >= 11) {
    config.whitewolf = 1;
  }

  const specialWolves = config.wolfcub + config.whitewolf;
  const wolvesTotal = n >= 3 && n < 5 ? 1 : Math.max(2, Math.round(n / 3.2));
  config.werewolf = Math.max(0, wolvesTotal - specialWolves);

  const used =
    config.werewolf +
    config.wolfcub +
    config.whitewolf +
    config.seer +
    config.guard +
    config.witch +
    config.hunter +
    config.cupid;

  config.villager = Math.max(0, n - used);

  return config;
}

// Vai tro chi duoc phep toi da 1 nguoi
const SINGLE_ONLY_ROLES = Object.keys(ROLE_INFO).filter(id => ROLE_INFO[id].maxCount === 1);

function validateRoleConfig(config, n) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['Cấu hình vai trò không hợp lệ'];
  let total = 0;
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(ROLE_INFO, key)) {
      errors.push(`Vai tro khong hop le: ${key}`);
      continue;
    }
    const val = config[key];
    if (!Number.isSafeInteger(val) || val < 0 || val > n) { errors.push(`Số lượng ${ROLE_INFO[key].name} phải là số nguyên từ 0 đến ${n}`); continue; }
    if (val < 0) errors.push(`So luong "${ROLE_INFO[key].name}" khong the am`);
    if (SINGLE_ONLY_ROLES.includes(key) && val > 1) {
      errors.push(`Vai tro "${ROLE_INFO[key].name}" chi duoc phep toi da 1 nguoi`);
    }
    total += val;
  }
  if (total !== n) {
    errors.push(`Tong so vai tro (${total}) phai bang so nguoi choi (${n})`);
  }
  // Never coerce values from a rejected configuration (JSON objects may override valueOf/toString).
  if (errors.length) return errors;
  const wolfTotal = (config.werewolf || 0) + (config.wolfcub || 0) + (config.whitewolf || 0);
  if (wolfTotal < 1) {
    errors.push('Can it nhat 1 Soi trong game');
  }
  if (wolfTotal * 2 >= n) {
    errors.push('So luong Soi qua nhieu so voi Dan lang, hay giam bot');
  }
  return errors;
}

// Chuyen config {roleId: count} thanh mang cac roleId (de xao va gan cho tung nguoi choi)
function expandRoleConfig(config) {
  const list = [];
  for (const [roleId, count] of Object.entries(config)) {
    for (let i = 0; i < count; i++) list.push(roleId);
  }
  return list;
}

module.exports = {
  TEAM,
  ROLE_INFO,
  getRoleInfo,
  isWolfTeam,
  getDefaultRoleConfig,
  validateRoleConfig,
  expandRoleConfig,
  SINGLE_ONLY_ROLES,
};
