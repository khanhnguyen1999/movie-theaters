// Ghép nối: sảnh chờ, kết nối phòng, cảnh 3D, trình phát YouTube đồng bộ, avatar, chat, cảm xúc.
import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { buildCinema, buildScreen, eyePosition, seatPosition, SCREEN } from './cinema.js';
import { buildControlPanel, textSprite, fmt } from './ui3d.js';
import { initLobby } from './lobby.js';

const $ = (s) => document.querySelector(s);
const socket = io();

/* ---------------- Sảnh chờ ---------------- */
let credentials = null;
initLobby({
  socket,
  onJoined: (res, creds) => {
    credentials = creds;
    $('#hud').hidden = false;
    startCinema(res);
  },
});

/* ---------------- Cảnh 3D ---------------- */
let me, users = new Map(), roomState, clockOffset = 0;
let started = false;

const scene = new THREE.Scene();
const cssScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.rotation.order = 'YXZ';

const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
gl.setPixelRatio(Math.min(devicePixelRatio, 2));
gl.setSize(innerWidth, innerHeight);
gl.setClearColor(0x000000, 0);
const css = new CSS3DRenderer();
css.setSize(innerWidth, innerHeight);
$('#css-layer').appendChild(css.domElement);
$('#gl-layer').appendChild(gl.domElement);

const cinema = buildCinema(scene);
const screen = buildScreen(scene, cssScene);

// Giá đỡ góc nhìn: đặt ở mắt người xem, xoay về phía màn chiếu; bảng điều khiển gắn vào đây
const rig = new THREE.Group();
scene.add(rig);
const look = { yaw: 0, pitch: 0, baseYaw: 0 };

const panel = buildControlPanel({
  togglePlay, back10: () => seekBy(-10), fwd10: () => seekBy(10),
  seekFrac: (f) => seekTo(f * duration()),
  volUp: () => changeVolume(10), volDown: () => changeVolume(-10),
  toggleLights, changeLink: () => toggleManager(), fullscreen: () => toggleVideoMode(),
  react: (emoji) => socket.emit('react', emoji),
});
panel.group.position.set(0, -0.55, -0.62);
panel.group.rotation.x = -0.72;
rig.add(panel.group);

// Vòng đánh dấu ghế khi rê chuột
const seatMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.35, 0.45, 32),
  new THREE.MeshBasicMaterial({ color: 0xff6b9d, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
);
seatMarker.rotation.x = -Math.PI / 2;
seatMarker.visible = false;
scene.add(seatMarker);

function aimAtScreen(seat) {
  const eye = eyePosition(seat);
  const dir = new THREE.Vector3(0, SCREEN.y, SCREEN.z).sub(eye);
  look.baseYaw = Math.atan2(-dir.x, -dir.z);
  return { eye, pitch: Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) };
}

let seatTween = null;
function moveToSeat(seat, instant) {
  const from = rig.position.clone();
  const prevBase = look.baseYaw;
  const { eye, pitch } = aimAtScreen(seat);
  if (instant) {
    rig.position.copy(eye);
    look.yaw = look.baseYaw;
    look.pitch = pitch;
  } else {
    look.yaw += look.baseYaw - prevBase;
    seatTween = { from, to: eye, t: 0 };
  }
  rig.rotation.y = look.baseYaw;
}

/* ---------------- Avatar người kia ---------------- */
const avatars = new Map();

function createAvatar(user) {
  const g = new THREE.Group();
  const color = new THREE.Color(user.color);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 12), bodyMat);
  body.position.y = 0.88;
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.position.y = 1.38;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffe2d0, roughness: 0.7 }));
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.5) })
  );
  hair.rotation.x = 0.35;
  hair.position.z = 0.02;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x221122 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
    eye.position.set(s * 0.06, 0.02, -0.155);
    head.add(eye);
  }
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.7 });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), blushMat);
    b.position.set(s * 0.1, -0.04, -0.15);
    b.rotation.y = Math.PI + s * 0.5;
    head.add(b);
  }
  head.add(skull, hair);
  const label = textSprite(user.name, { font: 48, bg: 'rgba(20,6,16,.7)' });
  label.position.y = 1.78;
  g.add(body, head, label);
  // đèn nhỏ để người kia luôn sáng rõ trong rạp tối
  const glow = new THREE.PointLight(color, 0.8, 1.6);
  glow.position.set(0, 1.3, -0.4);
  g.add(glow);
  scene.add(g);
  const av = { group: g, head, target: { ...user.look }, bubble: null };
  avatars.set(user.id, av);
  placeAvatar(user);
  return av;
}

function placeAvatar(user) {
  const av = avatars.get(user.id);
  if (av) av.group.position.copy(seatPosition(user.seat));
}

function removeAvatar(id) {
  const av = avatars.get(id);
  if (!av) return;
  scene.remove(av.group);
  avatars.delete(id);
}

function addUser(u) {
  users.set(u.id, u);
  if (u.id !== me.id) createAvatar(u);
  renderPeople();
}

function renderPeople() {
  $('#people').innerHTML = '';
  for (const u of users.values()) {
    const d = document.createElement('div');
    d.className = 'p';
    d.innerHTML = `<span class="dot" style="background:${u.color}"></span>`;
    d.append(u.name + (u.id === me.id ? ' (bạn)' : ''));
    $('#people').appendChild(d);
  }
}

/* ---------------- Hiệu ứng cảm xúc & bong bóng chat ---------------- */
const floaters = [];

function anchorFor(id) {
  // ở chế độ xem toàn màn hình không thấy avatar, nên cảm xúc của cả hai bay lên ngay trước mắt
  if (id === me.id || videoMode) {
    const side = id === me.id ? -0.35 : 0.35;
    const fwd = new THREE.Vector3(videoMode ? side : 0, videoMode ? -0.35 : -0.15, -1).applyQuaternion(camera.quaternion);
    return camera.position.clone().add(fwd.multiplyScalar(1.3));
  }
  const av = avatars.get(id);
  return av ? av.group.position.clone().add(new THREE.Vector3(0, 1.7, 0)) : null;
}

function spawnReaction(id, emoji) {
  const pos = anchorFor(id);
  if (!pos) return;
  const count = ['❤️', '😘'].includes(emoji) ? 6 : 3;
  for (let i = 0; i < count; i++) {
    const s = textSprite(emoji, { font: 110, padding: 4 });
    s.scale.multiplyScalar(1.4);
    s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.3));
    scene.add(s);
    floaters.push({ obj: s, t: -i * 0.15, life: 2.6, vy: 0.5 + Math.random() * 0.3, phase: Math.random() * 6, base: s.position.clone() });
  }
}

function showBubble(id, text) {
  const av = avatars.get(id);
  if (!av) return;
  if (av.bubble) av.group.remove(av.bubble);
  const b = textSprite(text, { font: 44, bg: 'rgba(255,255,255,.92)', color: '#2a0d1e', maxWidth: 600 });
  b.position.y = 2.05 + b.scale.y / 2;
  av.group.add(b);
  av.bubble = b;
  setTimeout(() => { if (av.bubble === b) { av.group.remove(b); av.bubble = null; } }, 6000);
}

/* ---------------- Trình phát YouTube & đồng bộ ---------------- */
let player = null, playerReady = false, loadedVideoId = null, volume = 80;
const YTS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
let title = '';

const ytReady = new Promise((resolve) => {
  if (window.YT && window.YT.loaded) resolve();
  else window.onYouTubeIframeAPIReady = resolve;
});

async function createPlayer() {
  await ytReady;
  loadedVideoId = roomState.videoId;
  player = new YT.Player(screen.holder, {
    width: 1280, height: 720, videoId: roomState.videoId,
    playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, start: Math.floor(expectedTime()) },
    events: {
      onReady: () => {
        playerReady = true;
        player.setVolume(volume);
        title = player.getVideoData?.()?.title || '';
        syncPlayer(true);
      },
      onStateChange: (e) => {
        if (e.data === YTS.PLAYING) $('#unmute').hidden = true;
        if (e.data === YTS.ENDED && roomState.playing) socket.emit('control', { type: 'ended', time: duration(), videoId: loadedVideoId });
        const data = player.getVideoData?.();
        if (data?.title) title = data.title;
      },
      onError: (e) => toast(`Không phát được video này (mã lỗi ${e.data}). Thử link khác nhé.`),
    },
  });
}

function expectedTime() {
  const s = roomState;
  if (!s) return 0;
  return s.time + (s.playing ? (Date.now() + clockOffset - s.updatedAt) / 1000 : 0);
}
const currentTime = () => (playerReady ? player.getCurrentTime() || 0 : expectedTime());
const duration = () => (playerReady ? player.getDuration() || 0 : 0);

function applyState(s) {
  clockOffset = s.serverNow - Date.now();
  roomState = s;
  if (!playerReady) return;
  if (s.videoId !== loadedVideoId) {
    loadedVideoId = s.videoId;
    title = '';
    if (s.playing) player.loadVideoById(s.videoId, expectedTime());
    else player.cueVideoById(s.videoId, expectedTime());
    return;
  }
  syncPlayer(true);
}

let stuckSince = 0;
function syncPlayer(force) {
  if (!playerReady) return;
  const st = player.getPlayerState();
  const exp = expectedTime();
  if (Math.abs(player.getCurrentTime() - exp) > (force ? 0.6 : 1.5) && st !== YTS.BUFFERING) player.seekTo(exp, true);
  if (roomState.playing && st !== YTS.PLAYING && st !== YTS.BUFFERING) player.playVideo();
  if (!roomState.playing && (st === YTS.PLAYING || st === YTS.BUFFERING)) player.pauseVideo();
  // Trình duyệt chặn tự phát -> hiện nút cho người dùng bấm
  if (roomState.playing && (st === YTS.UNSTARTED || st === YTS.CUED)) {
    stuckSince ||= Date.now();
    if (Date.now() - stuckSince > 2500) $('#unmute').hidden = false;
  } else stuckSince = 0;
}
setInterval(() => started && syncPlayer(false), 1500);
$('#unmute').addEventListener('click', () => { player?.playVideo(); $('#unmute').hidden = true; });

/* ---------------- Hành động điều khiển ---------------- */
function togglePlay() {
  socket.emit('control', { type: roomState.playing ? 'pause' : 'play', time: currentTime() });
}
function seekTo(t) {
  socket.emit('control', { type: 'seek', time: Math.max(0, Math.min(t, duration() || t)) });
}
function seekBy(d) { seekTo(currentTime() + d); }
function setVolume(v) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  player?.setVolume(volume);
  if (volume > 0) player?.unMute();
  $('#volume').value = volume;
  $('#vb-vol').value = volume;
  $('#vol-val').textContent = `${volume}%`;
}
function changeVolume(d) {
  setVolume(volume + d);
  toast(`Âm lượng ${volume}%`);
}
const nowTitle = () => title || roomState?.title || '';

const LIGHTS = [
  { name: 'Tối – chế độ rạp', ambient: 0.04, hemi: 0.08, sconce: 0.8 },
  { name: 'Đèn mờ', ambient: 0.08, hemi: 0.25, sconce: 3 },
  { name: 'Đèn sáng', ambient: 0.35, hemi: 0.8, sconce: 8 },
];
let lightLevel = 1;
function toggleLights() {
  lightLevel = (lightLevel + 1) % LIGHTS.length;
  toast(`💡 ${LIGHTS[lightLevel].name}`);
}

function parseYouTube(url) {
  url = url.trim();
  if (/^[\w-]{11}$/.test(url)) return url;
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* ---------------- Bảng quản lý phim ---------------- */
const manager = $('#manager');
let playlist = [];
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function toggleManager(open = manager.hidden) {
  manager.hidden = !open;
  $('#manager-toggle').hidden = open;
  if (open) {
    updateManager();
    setTimeout(() => $('#url-input').focus(), 0);
  }
}
function openManager() { toggleManager(true); }
$('#manager-toggle').addEventListener('click', openManager);
$('#manager-close').addEventListener('click', () => toggleManager(false));

$('#m-play').addEventListener('click', togglePlay);
$('#m-back').addEventListener('click', () => seekBy(-10));
$('#m-fwd').addEventListener('click', () => seekBy(10));
$('#m-restart').addEventListener('click', () => seekTo(0));
$('#m-next').addEventListener('click', () => {
  if (playlist.length) socket.emit('playlist-play', playlist[0].id);
  else toast('Danh sách chờ đang trống');
});
$('#volume').addEventListener('input', (e) => setVolume(e.target.value));

// thanh tua: kéo thì chỉ xem trước thời gian, thả tay mới gửi lệnh tua
function bindSeek(range, curLabel, durLabel) {
  const bar = { seeking: false };
  range.addEventListener('input', () => {
    bar.seeking = true;
    curLabel.textContent = fmt((range.value / 1000) * duration());
  });
  range.addEventListener('change', () => {
    bar.seeking = false;
    seekTo((range.value / 1000) * duration());
  });
  bar.update = () => {
    const d = duration();
    durLabel.textContent = fmt(d);
    if (bar.seeking) return;
    curLabel.textContent = fmt(currentTime());
    range.value = d ? Math.round((currentTime() / d) * 1000) : 0;
  };
  return bar;
}
const managerSeek = bindSeek($('#seek'), $('#time-cur'), $('#time-dur'));

$('#url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parseYouTube($('#url-input').value);
  if (!id) { $('#url-error').textContent = 'Link YouTube không hợp lệ.'; return; }
  $('#url-error').textContent = '';
  $('#url-input').value = '';
  if (e.submitter?.value === 'queue') {
    socket.emit('playlist-add', id);
    toast('Đã thêm vào danh sách chờ');
  } else socket.emit('control', { type: 'load', videoId: id });
});

function renderPlaylist() {
  const ol = $('#queue');
  ol.innerHTML = '';
  $('#queue-count').textContent = playlist.length ? `(${playlist.length})` : '';
  $('#queue-empty').hidden = playlist.length > 0;
  playlist.forEach((item, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = thumb(item.videoId);
    img.alt = '';
    const info = document.createElement('div');
    info.className = 'info';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = item.title || item.videoId;
    const by = document.createElement('div');
    by.className = 'by';
    by.textContent = item.by ? `${item.by} thêm` : '';
    info.append(t, by);
    const acts = document.createElement('div');
    acts.className = 'acts';
    const btn = (label, titleText, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = titleText;
      b.disabled = disabled;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    };
    btn('▶️', 'Chiếu ngay', () => socket.emit('playlist-play', item.id));
    btn('▲', 'Lên', () => socket.emit('playlist-move', { id: item.id, dir: -1 }), i === 0);
    btn('▼', 'Xuống', () => socket.emit('playlist-move', { id: item.id, dir: 1 }), i === playlist.length - 1);
    btn('✕', 'Xoá', () => socket.emit('playlist-remove', item.id));
    li.append(img, info, acts);
    ol.appendChild(li);
  });
}

let lastNowId = null;
function updateManager() {
  if (!roomState || manager.hidden) return;
  if (roomState.videoId !== lastNowId) {
    lastNowId = roomState.videoId;
    $('#now-thumb').src = thumb(roomState.videoId);
  }
  $('#now-title').textContent = nowTitle() || roomState.videoId;
  $('#m-play').textContent = roomState.playing ? '⏸️ Tạm dừng' : '▶️ Phát';
  managerSeek.update();
}
setInterval(updateManager, 250);

/* ---------------- Chế độ xem toàn màn hình ---------------- */
// Camera bay tới trước màn chiếu sao cho video vừa khít khung nhìn; chat và thanh điều khiển 2D vẫn hiện
let videoMode = false;
const videoBar = $('#video-bar');
const barSeek = bindSeek($('#vb-seek'), $('#vb-cur'), $('#vb-dur'));

function toggleVideoMode(on = !videoMode) {
  if (on === videoMode) return;
  videoMode = on;
  document.body.classList.toggle('video-mode', on);
  videoBar.hidden = !on;
  seatMarker.visible = false;
  if (on) {
    updateVideoBar();
    barReserve = videoBar.offsetHeight + 22;
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) document.exitFullscreen();
}
// thoát toàn màn hình của trình duyệt (Esc) thì về lại rạp
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && videoMode) toggleVideoMode(false);
});

function updateVideoBar() {
  if (!roomState || !videoMode) return;
  $('#vb-play').textContent = roomState.playing ? '⏸️' : '▶️';
  $('#vb-play').title = roomState.playing ? 'Tạm dừng (Space)' : 'Phát (Space)';
  $('#vb-title').textContent = nowTitle();
  barSeek.update();
}
setInterval(updateVideoBar, 250);

$('#vb-play').addEventListener('click', togglePlay);
$('#vb-back').addEventListener('click', () => seekBy(-10));
$('#vb-fwd').addEventListener('click', () => seekBy(10));
$('#vb-vol').addEventListener('input', (e) => setVolume(e.target.value));
$('#vb-list').addEventListener('click', () => toggleManager());
$('#vb-exit').addEventListener('click', () => toggleVideoMode(false));
$('#manager-full').addEventListener('click', () => toggleVideoMode());
document.querySelectorAll('#video-bar .reacts button').forEach((b) =>
  b.addEventListener('click', () => socket.emit('react', b.textContent)));

// Đặt camera để video vừa khít phần màn hình phía trên thanh điều khiển (không bị che phụ đề).
// Chỉ dịch camera xuống thay vì lệch khung chiếu, vì CSS3DRenderer không hỗ trợ setViewOffset.
const videoCamPos = new THREE.Vector3();
let barReserve = 0;
setInterval(() => { if (videoMode) barReserve = videoBar.offsetHeight + 22; }, 250);
function videoCameraPosition() {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const availH = Math.max(innerHeight * 0.5, innerHeight - barReserve);
  const d = Math.max(
    (SCREEN.height * innerHeight) / (availH * 2 * tan),
    SCREEN.width / 2 / (tan * camera.aspect)
  );
  const unitsPerPx = (2 * d * tan) / innerHeight;
  const shift = ((innerHeight - availH) / 2) * unitsPerPx;
  return videoCamPos.set(0, SCREEN.y - shift, SCREEN.z + d);
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function chatLine(html, cls = 'm') {
  const d = document.createElement('div');
  d.className = cls;
  if (typeof html === 'string') d.textContent = html; else d.append(...html);
  $('#chat-log').appendChild(d);
  $('#chat-log').scrollTop = 1e9;
}

/* ---------------- Sự kiện mạng ---------------- */
const ACTION_TEXT = { play: 'đã phát phim ▶️', pause: 'đã tạm dừng ⏸️', seek: 'đã tua phim', load: 'đã đổi phim 🎞️' };
socket.on('state', (s) => {
  applyState(s);
  if (s.action === 'next') toast('⏭️ Đang chiếu phim kế tiếp trong danh sách');
  if (s.by && s.by !== me?.name && ACTION_TEXT[s.action]) toast(`${s.by} ${ACTION_TEXT[s.action]}`);
});
socket.on('user-joined', (u) => {
  addUser(u);
  chatLine(`${u.name} đã vào rạp 💕`, 'sys');
  toast(`${u.name} đã vào rạp 💕`);
});
socket.on('user-left', (id) => {
  const u = users.get(id);
  users.delete(id);
  removeAvatar(id);
  renderPeople();
  if (u) chatLine(`${u.name} đã rời rạp`, 'sys');
});
socket.on('seat', ({ id, seat }) => {
  const u = users.get(id);
  if (!u) return;
  u.seat = seat;
  if (id === me.id) moveToSeat(seat, false); else placeAvatar(u);
});
socket.on('look', ({ id, yaw, pitch }) => {
  const av = avatars.get(id);
  if (av) av.target = { yaw, pitch };
});
socket.on('playlist', (list) => { playlist = list; renderPlaylist(); });
socket.on('react', ({ id, emoji }) => spawnReaction(id, emoji));
function chatMessage({ name, color, text }) {
  const b = document.createElement('b');
  b.textContent = name + ':';
  b.style.color = color || '#fff';
  chatLine([b, document.createTextNode(text)]);
}
socket.on('chat', (m) => {
  chatMessage(m);
  if (m.id !== me.id) showBubble(m.id, m.text);
});
socket.on('room-deleted', () => {
  started = false;
  alert('Phòng này vừa bị xoá. Quay về sảnh nhé.');
  location.href = '/';
});
socket.on('disconnect', () => started && toast('Mất kết nối, đang thử lại…'));
socket.on('connect', () => {
  if (!started || !credentials) return;
  // Kết nối lại sau khi rớt mạng: vào lại phòng
  socket.emit('join', credentials, (res) => {
    if (!res.ok) { alert(`Không vào lại được phòng: ${res.error}`); location.reload(); return; }
    for (const id of [...avatars.keys()]) removeAvatar(id);
    users.clear();
    me = res.you;
    res.users.forEach(addUser);
    moveToSeat(me.seat, true);
    applyState(res.state);
    playlist = res.playlist || [];
    renderPlaylist();
    toast('Đã kết nối lại');
  });
});

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#chat-input').value.trim();
  if (text) socket.emit('chat', text);
  $('#chat-input').value = '';
});
$('#leave-room').addEventListener('click', () => { location.href = '/'; });
$('#copy-link').addEventListener('click', async () => {
  const link = `${location.origin}/?room=${encodeURIComponent(credentials.room)}`;
  try { await navigator.clipboard.writeText(link); toast('Đã sao chép link mời (gửi kèm mật khẩu riêng nhé)'); }
  catch { prompt('Link mời:', link); }
});

/* ---------------- Điều khiển chuột / chạm ---------------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null, hovered = null, hoverSeat = null;
const canvas = gl.domElement;

function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const uiHits = raycaster.intersectObjects([...panel.all.map((b) => b.mesh), panel.progress.mesh], false);
  if (uiHits.length) return { ui: uiHits[0] };
  const seatHits = raycaster.intersectObjects(cinema.seats.map((s) => s.hit), false);
  if (seatHits.length) return { seat: seatHits[0].object.userData.seatIndex };
  return {};
}

function updateHover(e) {
  const hit = pick(e);
  const btn = hit.ui?.object.userData.button || null;
  if (hovered && hovered !== btn) hovered.setHover(false);
  hovered = btn;
  btn?.setHover(true);
  panel.progress.hoverFrac = hit.ui?.object.userData.progress ? panel.progress.fracFromUv(hit.ui.uv) : null;
  const free = hit.seat != null && ![...users.values()].some((u) => u.seat === hit.seat);
  hoverSeat = free ? hit.seat : null;
  seatMarker.visible = free;
  if (free) seatMarker.position.copy(seatPosition(hit.seat)).add(new THREE.Vector3(0, 0.56, 0));
  canvas.style.cursor = btn || panel.progress.hoverFrac != null || free ? 'pointer' : drag ? 'grabbing' : 'grab';
}

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!started || videoMode) return;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    const k = e.pointerType === 'touch' ? 0.006 : 0.004;
    look.yaw = THREE.MathUtils.clamp(look.yaw + dx * k, look.baseYaw - 1.7, look.baseYaw + 1.7);
    look.pitch = THREE.MathUtils.clamp(look.pitch + dy * k, -1.2, 0.8);
  }
  updateHover(e);
});
canvas.addEventListener('pointerup', (e) => {
  const wasClick = drag && drag.moved < 6;
  drag = null;
  if (!started || !wasClick) return;
  if (videoMode) return togglePlay(); // nhấp vào video để phát/tạm dừng
  const hit = pick(e);
  if (hit.ui?.object.userData.button) {
    const b = hit.ui.object.userData.button;
    b.setActive(true);
    setTimeout(() => b.setActive(false), 150);
    b.onClick();
  } else if (hit.ui?.object.userData.progress) {
    panel.progress.onSeek(panel.progress.fracFromUv(hit.ui.uv));
  } else if (hit.seat != null && hit.seat !== me.seat && ![...users.values()].some((u) => u.seat === hit.seat)) {
    socket.emit('seat', hit.seat);
  }
});
function recenter() {
  const { pitch } = aimAtScreen(me.seat);
  look.yaw = look.baseYaw;
  look.pitch = pitch;
}
canvas.addEventListener('dblclick', () => started && (videoMode ? toggleVideoMode(false) : recenter()));
canvas.addEventListener('wheel', (e) => {
  if (videoMode) return;
  camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, 30, 80);
  camera.updateProjectionMatrix();
}, { passive: true });

addEventListener('keydown', (e) => {
  if (started && e.key === 'Escape' && !manager.hidden) { toggleManager(false); e.target.blur?.(); return; }
  if (!started || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowLeft') seekBy(-10);
  else if (e.code === 'ArrowRight') seekBy(10);
  else if (e.code === 'ArrowUp') changeVolume(10);
  else if (e.code === 'ArrowDown') changeVolume(-10);
  else if (e.key === 'l' || e.key === 'L') openManager();
  else if (e.key === 'm' || e.key === 'M') toggleManager();
  else if (e.key === 'f' || e.key === 'F') toggleVideoMode();
  else if (e.key === 'Escape' && videoMode) toggleVideoMode(false);
  else if (e.key === 'r' || e.key === 'R') recenter();
  else if (e.key === 'Enter') $('#chat-input').focus();
});

// Kiểm tra kích thước mỗi khung hình: không phải lúc nào đổi kích thước cũng phát sự kiện resize,
// mà lớp WebGL và lớp CSS3D lệch nhau là video lệch khỏi khung màn chiếu
let viewW = innerWidth, viewH = innerHeight;
function fitViewport() {
  if (innerWidth === viewW && innerHeight === viewH) return;
  viewW = innerWidth; viewH = innerHeight;
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  gl.setSize(viewW, viewH);
  css.setSize(viewW, viewH);
}

/* ---------------- Vòng lặp vẽ ---------------- */
const clock = new THREE.Clock();
let lastLookSent = 0, lastLook = '';
let vm = 0; // 0 = ngồi trong rạp, 1 = xem toàn màn hình
const seatEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const seatQuat = new THREE.Quaternion();
const IDENTITY_QUAT = new THREE.Quaternion();
const lampMats = [];
const LAMP_COLOR = new THREE.Color(0xffc07a);
scene.traverse((o) => o.userData.lamp && lampMats.push(o.material));

function animate() {
  requestAnimationFrame(animate);
  fitViewport();
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (seatTween) {
    seatTween.t = Math.min(1, seatTween.t + dt / 0.9);
    const k = seatTween.t * seatTween.t * (3 - 2 * seatTween.t);
    rig.position.lerpVectors(seatTween.from, seatTween.to, k);
    rig.position.y += Math.sin(k * Math.PI) * 0.4;
    if (seatTween.t >= 1) seatTween = null;
  }
  vm = THREE.MathUtils.clamp(vm + (videoMode ? dt : -dt) / 0.8, 0, 1);
  const vk = vm * vm * (3 - 2 * vm);
  seatEuler.set(look.pitch, look.yaw, 0);
  seatQuat.setFromEuler(seatEuler);
  camera.position.lerpVectors(rig.position, videoCameraPosition(), vk);
  camera.quaternion.slerpQuaternions(seatQuat, IDENTITY_QUAT, vk);

  // gửi hướng nhìn cho người kia ~10 lần/giây
  const lk = `${look.yaw.toFixed(2)}|${look.pitch.toFixed(2)}`;
  if (started && lk !== lastLook && t - lastLookSent > 0.1) {
    socket.emit('look', { yaw: look.yaw, pitch: look.pitch });
    lastLook = lk; lastLookSent = t;
  }

  // avatar: xoay đầu mượt, thở nhẹ
  for (const av of avatars.values()) {
    av.head.rotation.y += (av.target.yaw - av.head.rotation.y) * Math.min(1, dt * 8);
    av.head.rotation.x += (THREE.MathUtils.clamp(av.target.pitch, -0.7, 0.6) - av.head.rotation.x) * Math.min(1, dt * 8);
    av.group.children[0].scale.y = 1 + Math.sin(t * 1.6) * 0.015;
  }

  // ánh sáng: khi phim chạy đèn rạp dịu xuống, màn chiếu hắt sáng lập loè
  const playing = roomState?.playing && player?.getPlayerState?.() === YTS.PLAYING;
  const L = LIGHTS[lightLevel];
  // xem toàn màn hình thì tắt hẳn đèn rạp cho đỡ chói quanh viền
  const dimK = (playing ? 0.35 : 1) * (1 - 0.9 * vk);
  const lerp = (a, b) => a + (b - a) * Math.min(1, dt * 2);
  cinema.ambient.intensity = lerp(cinema.ambient.intensity, L.ambient * dimK);
  cinema.hemi.intensity = lerp(cinema.hemi.intensity, L.hemi * dimK);
  for (const s of cinema.sconces) s.intensity = lerp(s.intensity, L.sconce * dimK);
  for (const m of lampMats) m.color.copy(LAMP_COLOR).multiplyScalar(0.3 + 0.7 * dimK);
  const flicker = playing ? 7 + Math.sin(t * 3.1) * 1.5 + Math.sin(t * 7.3) * 1 : 1.5;
  cinema.screenLight.intensity = lerp(cinema.screenLight.intensity, flicker);
  cinema.beam.material.opacity = lerp(cinema.beam.material.opacity, playing && !videoMode ? 0.045 + Math.sin(t * 5) * 0.006 : 0.0);
  cinema.stars.material.opacity = 0.65 + Math.sin(t * 1.3) * 0.25;

  // cảm xúc bay lên
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t < 0) { f.obj.visible = false; continue; }
    f.obj.visible = true;
    const p = f.t / f.life;
    f.obj.position.set(f.base.x + Math.sin(f.t * 3 + f.phase) * 0.12, f.base.y + f.t * f.vy, f.base.z);
    f.obj.material.opacity = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.6) / 0.4);
    if (p >= 1) { scene.remove(f.obj); f.obj.material.map.dispose(); f.obj.material.dispose(); floaters.splice(i, 1); }
  }

  const playBtn = panel.buttons.play;
  playBtn.setLabel(roomState?.playing ? '⏸️' : '▶️');
  panel.progress.update(currentTime(), duration(), nowTitle());

  gl.render(scene, camera);
  css.render(cssScene, camera);
}

// Trước khi vào phòng: đặt camera ở hàng cuối làm nền
moveToSeat(54, true);
animate();

function startCinema(res) {
  me = res.you;
  roomState = res.state;
  clockOffset = res.state.serverNow - Date.now();
  $('#room-label').textContent = res.room.name;
  document.title = `${res.room.name} · Rạp Phim Đôi`;
  if (res.history?.length) {
    chatLine(`— ${res.history.length} tin nhắn trước đó —`, 'sys');
    res.history.forEach(chatMessage);
  }
  res.users.forEach(addUser);
  moveToSeat(me.seat, true);
  started = true;
  playlist = res.playlist || [];
  renderPlaylist();
  $('#manager-toggle').hidden = false;
  createPlayer();
  chatLine(`Chào ${me.name}! Phòng tối đa ${res.maxPeople} người. Gửi link mời + mật khẩu cho người ấy nhé 💌`, 'sys');
}
