// Máy chủ rạp phim: REST API quản lý phòng (lưu SQLite) + Socket.IO đồng bộ phim, chat, cảm xúc.
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const DEFAULT_VIDEO = { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film' };
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);
const PEOPLE_LIMIT = { min: 2, max: 8 };

const app = express();
app.set('trust proxy', 1); // chạy sau proxy của Fly.io: lấy đúng IP người dùng cho việc chặn dò mật khẩu
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

/* ---------------- Tiện ích ---------------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}
function checkPassword(row, password) {
  const a = Buffer.from(hashPassword(password, row.salt), 'hex');
  const b = Buffer.from(row.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Chặn dò mật khẩu: tối đa 8 lần sai mỗi phút cho mỗi IP
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 60_000) return false;
  return f.count >= 8;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 60_000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'phong';
}

// Lấy tên video qua oEmbed của YouTube (không cần API key)
async function fetchTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return '';
    return String((await res.json()).title || '').slice(0, 200);
  } catch {
    return '';
  }
}

const isVideoId = (id) => /^[\w-]{11}$/.test(id || '');

// Nhận link YouTube dạng watch?v=, youtu.be/, shorts/, embed/, live/ hoặc mã video 11 ký tự
function parseYouTube(input) {
  input = String(input || '').trim();
  if (isVideoId(input)) return input;
  const m = input.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* ---------------- Phòng đang hoạt động (trong bộ nhớ) ---------------- */
/** roomId -> { id, name, maxPeople, users: Map<socketId,user>, state, playlist } */
const live = new Map();

function currentTime(state) {
  return state.playing ? state.time + (Date.now() - state.updatedAt) / 1000 : state.time;
}
function publicState(r) {
  return { ...r.state, time: currentTime(r.state), updatedAt: Date.now(), serverNow: Date.now() };
}
function userList(r) {
  return [...r.users.values()];
}

// Mở phòng từ DB vào bộ nhớ khi có người vào đầu tiên
function openRoom(row) {
  let r = live.get(row.id);
  if (!r) {
    r = {
      id: row.id,
      name: row.name,
      maxPeople: row.max_people,
      users: new Map(),
      state: { videoId: row.video_id, title: row.title, playing: false, time: row.time, updatedAt: Date.now() },
      playlist: db.getPlaylist(row.id),
    };
    live.set(row.id, r);
  }
  return r;
}
function persistState(r) {
  db.saveState(r.id, { ...r.state, time: currentTime(r.state) });
}
function persistPlaylist(r) {
  db.savePlaylist(r.id, r.playlist);
}

// Báo cho các máy đang ở sảnh tải lại danh sách phòng (gộp nhiều thay đổi liên tiếp)
let roomsTimer = null;
function roomsChanged() {
  clearTimeout(roomsTimer);
  roomsTimer = setTimeout(() => io.emit('rooms-updated'), 300);
}

function roomSummary(row) {
  const r = live.get(row.id);
  const videoId = r ? r.state.videoId : row.video_id;
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    maxPeople: row.max_people,
    online: r ? r.users.size : 0,
    playing: r ? r.state.playing : false,
    nowPlaying: { videoId, title: r ? r.state.title : row.title },
    createdAt: row.created_at,
    lastActive: row.last_active,
  };
}

/* ---------------- REST API ---------------- */
app.get('/api/rooms', (req, res) => {
  const raw = String(req.query.q || '').trim();
  const search = raw ? slugify(raw).replace(/-/g, ' ') : '';
  let rooms = db.listRooms().map(roomSummary);
  if (search) {
    rooms = rooms.filter((r) => slugify(`${r.name} ${r.owner} ${r.id}`).replace(/-/g, ' ').includes(search));
  }
  rooms.sort((a, b) => b.online - a.online || b.lastActive - a.lastActive);
  res.json({ rooms });
});

app.get('/api/rooms/:id', (req, res) => {
  const row = db.getRoom(req.params.id);
  if (!row) return res.status(404).json({ error: 'Phòng không tồn tại.' });
  res.json({ room: roomSummary(row) });
});

// Xem trước link phim trước khi tạo phòng
app.get('/api/video', async (req, res) => {
  const videoId = parseYouTube(req.query.url);
  if (!videoId) return res.status(400).json({ error: 'Link YouTube không hợp lệ.' });
  const title = await fetchTitle(videoId);
  if (!title) return res.status(404).json({ error: 'Không tìm thấy video hoặc video không cho phép nhúng.' });
  res.json({ videoId, title });
});

app.post('/api/rooms', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const owner = String(req.body?.owner || '').trim().slice(0, 20);
  const password = String(req.body?.password || '');
  const maxPeople = Math.round(Number(req.body?.maxPeople) || 2);
  const videoInput = String(req.body?.video || '').trim();
  if (!name) return res.status(400).json({ error: 'Cần đặt tên phòng.' });
  if (!owner) return res.status(400).json({ error: 'Cần nhập tên của bạn.' });
  if (password.length < 4) return res.status(400).json({ error: 'Mật khẩu tối thiểu 4 ký tự.' });
  if (maxPeople < PEOPLE_LIMIT.min || maxPeople > PEOPLE_LIMIT.max) {
    return res.status(400).json({ error: `Số người từ ${PEOPLE_LIMIT.min} đến ${PEOPLE_LIMIT.max}.` });
  }
  if (db.countRooms() >= MAX_ROOMS) return res.status(429).json({ error: 'Máy chủ đã đủ số phòng, hãy xoá bớt phòng cũ.' });

  // Link phim là tuỳ chọn; bỏ trống thì chiếu phim mẫu
  let video = DEFAULT_VIDEO;
  if (videoInput) {
    const videoId = parseYouTube(videoInput);
    if (!videoId) return res.status(400).json({ error: 'Link YouTube không hợp lệ.' });
    video = { videoId, title: (await fetchTitle(videoId)) || videoId };
  }

  const id = `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;
  const salt = crypto.randomBytes(16).toString('hex');
  db.createRoom({ id, name, owner, salt, hash: hashPassword(password, salt), maxPeople, ...video });
  roomsChanged();
  res.status(201).json({ room: roomSummary(db.getRoom(id)) });
});

app.delete('/api/rooms/:id', (req, res) => {
  const row = db.getRoom(req.params.id);
  if (!row) return res.status(404).json({ error: 'Phòng không tồn tại.' });
  if (tooManyFailures(req.ip)) return res.status(429).json({ error: 'Sai quá nhiều lần, thử lại sau 1 phút.' });
  if (!checkPassword(row, String(req.body?.password || ''))) {
    recordFailure(req.ip);
    return res.status(403).json({ error: 'Sai mật khẩu.' });
  }
  db.deleteRoom(row.id);
  io.to(row.id).emit('room-deleted');
  io.in(row.id).disconnectSockets(true);
  live.delete(row.id);
  roomsChanged();
  res.json({ ok: true });
});

/* ---------------- Socket.IO ---------------- */
const COLORS = ['#ff6b9d', '#6bc5ff', '#ffd36b', '#8dff6b', '#c58dff', '#ff9a6b', '#6bffd8', '#ff6b6b'];

io.on('connection', (socket) => {
  let roomId = null;
  const ip = socket.handshake.headers['fly-client-ip'] || socket.handshake.address;

  function fail(cb, message) {
    if (typeof cb === 'function') cb({ ok: false, error: message });
  }

  socket.on('join', ({ room, password, name } = {}, cb) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return fail(cb, 'Cần nhập tên của bạn.');
    if (roomId) return fail(cb, 'Bạn đã ở trong phòng.');
    const row = db.getRoom(String(room || ''));
    if (!row) return fail(cb, 'Phòng không tồn tại hoặc đã bị xoá.');
    if (tooManyFailures(ip)) return fail(cb, 'Sai quá nhiều lần, thử lại sau 1 phút.');
    if (!checkPassword(row, String(password || ''))) {
      recordFailure(ip);
      return fail(cb, 'Sai mật khẩu.');
    }
    const r = openRoom(row);
    if (r.users.size >= r.maxPeople) return fail(cb, `Phòng đã đủ ${r.maxPeople} người.`);

    const takenSeats = new Set(userList(r).map((u) => u.seat));
    const preferred = [24, 25, 23, 26, 22, 27, 34, 35]; // ghế đôi giữa hàng thứ 3 trước
    const seat = preferred.find((s) => !takenSeats.has(s)) ?? [...Array(60).keys()].find((s) => !takenSeats.has(s));
    const usedColors = new Set(userList(r).map((u) => u.color));
    const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[0];
    const user = { id: socket.id, name, seat, color, look: { yaw: 0, pitch: 0 } };
    r.users.set(socket.id, user);
    roomId = r.id;
    socket.join(r.id);
    db.touchRoom(r.id);

    cb({
      ok: true,
      room: { id: r.id, name: r.name },
      you: user,
      users: userList(r),
      state: publicState(r),
      playlist: r.playlist,
      history: db.recentMessages(r.id),
      maxPeople: r.maxPeople,
    });
    socket.to(r.id).emit('user-joined', user);
    roomsChanged();
  });

  function currentRoom() {
    return roomId ? live.get(roomId) : null;
  }
  function broadcastState(r, by, action) {
    persistState(r);
    io.to(r.id).emit('state', { ...publicState(r), by, action });
    if (action === 'load' || action === 'next' || action === 'play' || action === 'pause') roomsChanged();
  }
  function broadcastPlaylist(r) {
    persistPlaylist(r);
    io.to(r.id).emit('playlist', r.playlist);
  }
  function loadVideo(r, item) {
    Object.assign(r.state, { videoId: item.videoId, title: item.title, playing: true, time: 0, updatedAt: Date.now() });
  }

  socket.on('control', async (msg = {}) => {
    const r = currentRoom();
    if (!r) return;
    const s = r.state;
    const time = Math.max(0, Number(msg.time) || 0);
    switch (msg.type) {
      case 'play':
        Object.assign(s, { playing: true, time, updatedAt: Date.now() });
        break;
      case 'pause':
        Object.assign(s, { playing: false, time, updatedAt: Date.now() });
        break;
      case 'seek':
        Object.assign(s, { time, updatedAt: Date.now() });
        break;
      case 'load':
        if (!isVideoId(msg.videoId)) return;
        loadVideo(r, { videoId: msg.videoId, title: await fetchTitle(msg.videoId) });
        break;
      case 'ended': {
        // mọi máy đều báo hết phim -> chỉ xử lý lần đầu cho đúng video đang chiếu
        if (msg.videoId !== s.videoId || !s.playing) return;
        const next = r.playlist.shift();
        if (next) {
          loadVideo(r, next);
          broadcastPlaylist(r);
          return broadcastState(r, null, 'next');
        }
        Object.assign(s, { playing: false, time, updatedAt: Date.now() });
        break;
      }
      default:
        return;
    }
    broadcastState(r, r.users.get(socket.id)?.name, msg.type);
  });

  socket.on('playlist-add', async (videoId) => {
    const r = currentRoom();
    if (!r || !isVideoId(videoId) || r.playlist.length >= 50) return;
    const by = r.users.get(socket.id)?.name;
    const item = { id: crypto.randomUUID(), videoId, title: await fetchTitle(videoId), by };
    if (live.get(r.id) !== r) return; // phòng bị xoá trong lúc chờ lấy tên phim
    r.playlist.push(item);
    broadcastPlaylist(r);
  });

  socket.on('playlist-remove', (id) => {
    const r = currentRoom();
    if (!r) return;
    r.playlist = r.playlist.filter((i) => i.id !== id);
    broadcastPlaylist(r);
  });

  socket.on('playlist-play', (id) => {
    const r = currentRoom();
    const item = r?.playlist.find((i) => i.id === id);
    if (!item) return;
    r.playlist = r.playlist.filter((i) => i !== item);
    loadVideo(r, item);
    broadcastPlaylist(r);
    broadcastState(r, r.users.get(socket.id)?.name, 'load');
  });

  socket.on('playlist-move', ({ id, dir } = {}) => {
    const r = currentRoom();
    const i = r?.playlist.findIndex((x) => x.id === id) ?? -1;
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= r.playlist.length) return;
    [r.playlist[i], r.playlist[j]] = [r.playlist[j], r.playlist[i]];
    broadcastPlaylist(r);
  });

  socket.on('seat', (seat) => {
    const r = currentRoom();
    if (!r || !Number.isInteger(seat) || seat < 0 || seat > 200) return;
    if (userList(r).some((u) => u.seat === seat && u.id !== socket.id)) return;
    r.users.get(socket.id).seat = seat;
    io.to(r.id).emit('seat', { id: socket.id, seat });
  });

  socket.on('look', (look = {}) => {
    const r = currentRoom();
    if (!r) return;
    const u = r.users.get(socket.id);
    u.look = { yaw: Number(look.yaw) || 0, pitch: Number(look.pitch) || 0 };
    socket.to(r.id).volatile.emit('look', { id: socket.id, ...u.look });
  });

  socket.on('react', (emoji) => {
    const r = currentRoom();
    if (!r) return;
    io.to(r.id).emit('react', { id: socket.id, emoji: String(emoji).slice(0, 4) });
  });

  socket.on('chat', (text) => {
    const r = currentRoom();
    text = String(text || '').trim().slice(0, 300);
    if (!r || !text) return;
    const u = r.users.get(socket.id);
    const msg = { id: socket.id, name: u.name, color: u.color, text, at: Date.now() };
    db.addMessage(r.id, msg);
    io.to(r.id).emit('chat', msg);
  });

  socket.on('disconnect', () => {
    const r = currentRoom();
    if (!r) return;
    r.users.delete(socket.id);
    io.to(r.id).emit('user-left', socket.id);
    if (r.users.size === 0 && live.get(r.id) === r) {
      // Không còn ai: dừng phim, lưu vị trí đang xem rồi đóng phòng khỏi bộ nhớ
      r.state = { ...r.state, playing: false, time: currentTime(r.state), updatedAt: Date.now() };
      persistState(r);
      live.delete(r.id);
    }
    roomsChanged();
  });
});

server.listen(PORT, () => console.log(`🎬 Rạp phim đôi đang chạy: http://localhost:${PORT}`));

// Khi bị tắt (deploy bản mới, máy tự ngủ): lưu vị trí đang xem của các phòng rồi mới thoát
function shutdown() {
  for (const r of live.values()) {
    r.state = { ...r.state, playing: false, time: currentTime(r.state) };
    persistState(r);
  }
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
