// Sảnh: lấy danh sách phòng từ API, tìm kiếm, lọc, tạo phòng (kèm link phim tuỳ chọn), vào phòng, xoá phòng.
const $ = (s, root = document) => root.querySelector(s);

function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
  return data;
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export function initLobby({ socket, onJoined }) {
  const nameInput = $('#my-name');
  const dialog = $('#join-dialog');
  const joinForm = $('#join-form');
  const createForm = $('#create-form');
  let rooms = [];
  let selected = null;
  let search = '';
  let filter = 'all';

  nameInput.value = storageGet('cinema-name') || '';
  nameInput.addEventListener('input', () => storageSet('cinema-name', nameInput.value.trim()));

  function requireName() {
    const name = nameInput.value.trim();
    if (name) return name;
    nameInput.focus();
    shake(nameInput.closest('.name-chip'));
    return null;
  }

  // Hiện / ẩn mật khẩu
  document.querySelectorAll('#lobby .pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('on', input.type === 'text');
    });
  });

  /* ---------- Danh sách phòng ---------- */
  async function loadRooms() {
    try {
      ({ rooms } = await api('GET', `/api/rooms?q=${encodeURIComponent(search)}`));
      render();
    } catch (e) {
      showEmpty('Không tải được danh sách phòng', e.message);
    }
  }

  function showEmpty(title, sub) {
    $('#rooms-empty').hidden = false;
    $('.empty-title').textContent = title;
    $('.empty-sub').textContent = sub;
  }

  function render() {
    const grid = $('#rooms-grid');
    const visible = rooms.filter((r) => filter === 'all' || (filter === 'live' ? r.online > 0 : r.online === 0));
    grid.innerHTML = '';
    $('#rooms-count').textContent = rooms.length ? rooms.length : '';
    $('#rooms-empty').hidden = visible.length > 0;
    if (!rooms.length && !search) showEmpty('Chưa có phòng nào mở cửa', 'Mở phòng đầu tiên ở phía trên rồi gửi link cho người ấy nhé.');
    else if (!visible.length) showEmpty('Không có phòng phù hợp', search ? `Không tìm thấy phòng nào khớp “${search}”.` : 'Thử chọn bộ lọc khác xem sao.');

    for (const r of visible) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'room-card';
      const full = r.online >= r.maxPeople;
      card.innerHTML = `
        <div class="poster">
          <span class="status"><i></i><span class="status-text"></span></span>
          <div class="poster-title"><h3></h3><p class="film"></p></div>
        </div>
        <div class="card-foot">
          <span class="seat-dots"></span>
          <span class="seat-count"></span>
          <span class="meta"></span>
        </div>`;
      $('.poster', card).style.backgroundImage = `url(${thumb(r.nowPlaying.videoId)})`;
      const status = $('.status', card);
      status.classList.add(r.online ? (r.playing ? 'playing' : 'live') : 'idle');
      $('.status-text', card).textContent = r.online ? (r.playing ? 'Đang chiếu' : 'Có người') : 'Trống';
      $('h3', card).textContent = r.name;
      $('.film', card).textContent = r.nowPlaying.title || r.nowPlaying.videoId;
      const dots = $('.seat-dots', card);
      for (let i = 0; i < r.maxPeople; i++) {
        const d = document.createElement('i');
        if (i < r.online) d.className = 'on';
        dots.appendChild(d);
      }
      $('.seat-count', card).textContent = full ? 'Đã đủ người' : `${r.online}/${r.maxPeople} ghế`;
      $('.meta', card).textContent = `${r.owner} · ${timeAgo(r.lastActive)}`;
      if (full) card.classList.add('full');
      card.addEventListener('click', () => openJoin(r));
      grid.appendChild(card);
    }
  }

  document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));

  let searchTimer;
  $('#room-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = e.target.value.trim(); loadRooms(); }, 200);
  });

  /* ---------- Vào phòng ---------- */
  function openJoin(room) {
    selected = room;
    $('#join-name').textContent = room.name;
    $('#join-thumb').src = thumb(room.nowPlaying.videoId);
    $('#join-meta').textContent = `${room.online}/${room.maxPeople} người · mở bởi ${room.owner}`;
    $('#join-film').textContent = `🎞️ ${room.nowPlaying.title || room.nowPlaying.videoId}`;
    $('#join-error').textContent = '';
    joinForm.password.value = '';
    joinForm.password.type = 'password';
    dialog.showModal();
    joinForm.password.focus();
  }

  function join(roomId, password) {
    const name = requireName();
    if (!name) return Promise.resolve({ ok: false, error: 'Nhập tên của bạn ở góc trên trước đã.' });
    return new Promise((resolve) => {
      socket.emit('join', { room: roomId, password, name }, (res) => {
        if (res.ok) {
          history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`);
          socket.off('rooms-updated', onRoomsUpdated);
          if (dialog.open) dialog.close();
          $('#lobby').remove();
          onJoined(res, { room: roomId, password, name });
        }
        resolve(res);
      });
    });
  }

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#join-submit').disabled = true;
    const res = await join(selected.id, joinForm.password.value);
    $('#join-submit').disabled = false;
    if (!res.ok) { $('#join-error').textContent = res.error; shake(joinForm.password.closest('.pw')); }
  });
  $('#join-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // bấm ra ngoài để đóng
  $('#join-delete').addEventListener('click', async () => {
    const password = joinForm.password.value;
    if (!password) { $('#join-error').textContent = 'Nhập mật khẩu phòng để xoá.'; return; }
    if (!confirm(`Xoá vĩnh viễn phòng "${selected.name}"? Danh sách phim và lịch sử chat cũng sẽ mất.`)) return;
    try {
      await api('DELETE', `/api/rooms/${encodeURIComponent(selected.id)}`, { password });
      dialog.close();
      loadRooms();
    } catch (err) {
      $('#join-error').textContent = err.message;
    }
  });

  /* ---------- Tạo phòng ---------- */
  const preview = $('#video-preview');
  const hint = $('#video-hint');
  const defaultHint = hint.textContent;
  let previewToken = 0;
  let videoOk = true; // ô link trống cũng hợp lệ

  async function checkVideo() {
    const url = createForm.video.value.trim();
    const token = ++previewToken;
    hint.classList.remove('bad');
    if (!url) {
      preview.hidden = true;
      hint.hidden = false;
      hint.textContent = defaultHint;
      videoOk = true;
      return;
    }
    hint.hidden = false;
    hint.textContent = 'Đang tìm phim…';
    try {
      const v = await api('GET', `/api/video?url=${encodeURIComponent(url)}`);
      if (token !== previewToken) return;
      $('img', preview).src = thumb(v.videoId);
      $('.vp-title', preview).textContent = v.title;
      preview.hidden = false;
      hint.hidden = true;
      videoOk = true;
    } catch (err) {
      if (token !== previewToken) return;
      preview.hidden = true;
      hint.textContent = err.message;
      hint.classList.add('bad');
      videoOk = false;
    }
  }
  let videoTimer;
  createForm.video.addEventListener('input', () => { clearTimeout(videoTimer); videoTimer = setTimeout(checkVideo, 350); });
  $('.vp-clear', preview).addEventListener('click', () => { createForm.video.value = ''; checkVideo(); createForm.video.focus(); });

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = createForm;
    const err = $('#create-error');
    err.textContent = '';
    const owner = requireName();
    if (!owner) { err.textContent = 'Nhập tên của bạn ở góc trên trước đã.'; return; }
    if (!f.name.value.trim()) { err.textContent = 'Đặt tên cho phòng nhé.'; f.name.focus(); return; }
    if (f.password.value.length < 4) { err.textContent = 'Mật khẩu tối thiểu 4 ký tự.'; f.password.focus(); return; }
    clearTimeout(videoTimer);
    await checkVideo();
    if (!videoOk) { err.textContent = 'Link phim chưa đúng — sửa lại hoặc để trống.'; f.video.focus(); return; }

    const btn = $('.cta', f);
    btn.disabled = true;
    try {
      const { room } = await api('POST', '/api/rooms', {
        name: f.name.value, password: f.password.value, maxPeople: Number(f.maxPeople.value), owner, video: f.video.value,
      });
      const res = await join(room.id, f.password.value);
      if (!res.ok) err.textContent = res.error;
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Cập nhật trực tiếp ---------- */
  // Danh sách phòng tự làm mới khi có người vào/ra, đổi phim, tạo/xoá phòng
  const onRoomsUpdated = () => loadRooms();
  socket.on('rooms-updated', onRoomsUpdated);
  const refresher = setInterval(() => (document.getElementById('lobby') ? render() : clearInterval(refresher)), 60_000);

  // Link mời ?room=… mở thẳng vé vào phòng
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    api('GET', `/api/rooms/${encodeURIComponent(invited)}`)
      .then(({ room }) => openJoin(room))
      .catch(() => history.replaceState(null, '', location.pathname));
  }
  loadRooms();

  return { join };
}
