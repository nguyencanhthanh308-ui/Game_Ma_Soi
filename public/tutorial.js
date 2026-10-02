// public/tutorial.js
// Popup huong dan, mo duoc o moi man hinh ke ca dang choi do. Danh sach vai tro lay tu
// roleCatalog ma app.js da tai san tu /api/roles, nen luat o day luon khop voi
// server/roles.js va khong goi mang them lan nua.
(() => {
  const modal = document.getElementById('tutorial');
  const openBtn = document.getElementById('btn-tutorial');
  const closeBtn = document.getElementById('btn-tutorial-close');
  const box = document.getElementById('tut-roles');
  const errorLine = document.getElementById('tut-roles-error');
  const filters = document.getElementById('tut-filters');
  if (!modal || !openBtn) return;

  const TEAM_NAME = { village: 'PHE LÀNG', wolf: 'PHE SÓI', solo: 'THẮNG RIÊNG' };
  let roles = [];
  let filter = 'all';

  function render() {
    box.innerHTML = '';
    roles.filter((r) => filter === 'all' || r.team === filter).forEach((role) => {
      const card = document.createElement('article');
      card.className = 'tut-role ' + role.team;
      card.innerHTML = `
        <div class="top">
          <span class="ico"></span><h4></h4>
          <span class="tag ${role.team}">${TEAM_NAME[role.team] || role.team}</span>
        </div>
        <dl>
          <dt>NĂNG LỰC</dt><dd class="d"></dd>
          <dt>CÁCH CHƠI</dt><dd class="p"></dd>
          <dt>THẮNG KHI</dt><dd class="w"></dd>
        </dl>`;
      // Gan bang textContent: mo ta vai la du lieu tu server, khong phai the HTML
      card.querySelector('.ico').textContent = role.icon || '';
      card.querySelector('h4').textContent = role.name;
      card.querySelector('.d').textContent = role.desc;
      card.querySelector('.p').textContent = role.play;
      card.querySelector('.w').textContent = role.win;
      box.appendChild(card);
    });
  }

  // app.js tai /api/roles ngay luc mo trang. Thuong la xong truoc khi nguoi dung bam
  // Huong dan, nhung neu chua kip (hoac hong) thi tu goi lay lan nua.
  function loadRoles() {
    if (roles.length) return Promise.resolve();
    const cached = typeof roleCatalog !== 'undefined' ? roleCatalog : null;
    if (cached && Object.keys(cached).length) {
      roles = Object.values(cached);
      return Promise.resolve();
    }
    return fetch('/api/roles')
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { roles = Object.values(data); });
  }

  let lastFocus = null;
  function open() {
    lastFocus = document.activeElement;
    modal.classList.remove('hidden');
    // Khoa cuon cua trang nen, de cuon trong popup khong keo ca trang phia sau
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
    loadRoles()
      .then(() => { errorLine.classList.add('hidden'); render(); })
      .catch(() => errorLine.classList.remove('hidden'));
  }
  function close() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    lastFocus?.focus();
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  // Bam ra ngoai khung cung dong, giong moi popup khac
  modal.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter = btn.dataset.team;
    filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
})();
