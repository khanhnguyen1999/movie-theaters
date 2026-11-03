// Lưu trữ bằng SQLite: phòng, trạng thái phim, danh sách chờ, lịch sử chat.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'cinema.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner       TEXT NOT NULL,
    salt        TEXT NOT NULL,
    hash        TEXT NOT NULL,
    max_people  INTEGER NOT NULL DEFAULT 2,
    video_id    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    time        REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_active INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlist (
    id        TEXT PRIMARY KEY,
    room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    pos       INTEGER NOT NULL,
    video_id  TEXT NOT NULL,
    title     TEXT NOT NULL DEFAULT '',
    added_by  TEXT,
    added_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS playlist_room ON playlist(room_id, pos);
  CREATE TABLE IF NOT EXISTS messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    color   TEXT,
    text    TEXT NOT NULL,
    at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id, at);
`);

const q = {
  insertRoom: db.prepare(`INSERT INTO rooms (id, name, owner, salt, hash, max_people, video_id, title, time, created_at, last_active)
    VALUES (@id, @name, @owner, @salt, @hash, @maxPeople, @videoId, @title, 0, @now, @now)`),
  getRoom: db.prepare('SELECT * FROM rooms WHERE id = ?'),
  listRooms: db.prepare('SELECT id, name, owner, max_people, video_id, title, created_at, last_active FROM rooms ORDER BY last_active DESC LIMIT 200'),
  countRooms: db.prepare('SELECT COUNT(*) AS n FROM rooms'),
  deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
  saveState: db.prepare('UPDATE rooms SET video_id = @videoId, title = @title, time = @time, last_active = @now WHERE id = @id'),
  touchRoom: db.prepare('UPDATE rooms SET last_active = ? WHERE id = ?'),

  getPlaylist: db.prepare('SELECT id, video_id AS videoId, title, added_by AS "by" FROM playlist WHERE room_id = ? ORDER BY pos'),
  clearPlaylist: db.prepare('DELETE FROM playlist WHERE room_id = ?'),
  insertItem: db.prepare(`INSERT INTO playlist (id, room_id, pos, video_id, title, added_by, added_at)
    VALUES (@id, @roomId, @pos, @videoId, @title, @by, @now)`),

  insertMessage: db.prepare('INSERT INTO messages (room_id, name, color, text, at) VALUES (?, ?, ?, ?, ?)'),
  recentMessages: db.prepare('SELECT name, color, text, at FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY at DESC LIMIT ?) ORDER BY at'),
  pruneMessages: db.prepare('DELETE FROM messages WHERE room_id = ? AND id NOT IN (SELECT id FROM messages WHERE room_id = ? ORDER BY at DESC LIMIT 500)'),
};

module.exports = {
  close: () => db.close(),
  createRoom: (room) => q.insertRoom.run({ ...room, now: Date.now() }),
  getRoom: (id) => q.getRoom.get(id),
  listRooms: () => q.listRooms.all(),
  countRooms: () => q.countRooms.get().n,
  deleteRoom: (id) => q.deleteRoom.run(id),
  saveState: (id, s) => q.saveState.run({ id, videoId: s.videoId, title: s.title || '', time: s.time, now: Date.now() }),
  touchRoom: (id) => q.touchRoom.run(Date.now(), id),

  getPlaylist: (roomId) => q.getPlaylist.all(roomId),
  // Danh sách chờ ngắn (≤50), ghi lại cả danh sách trong một transaction cho đơn giản
  savePlaylist: db.transaction((roomId, items) => {
    q.clearPlaylist.run(roomId);
    const now = Date.now();
    items.forEach((it, pos) => q.insertItem.run({ id: it.id, roomId, pos, videoId: it.videoId, title: it.title || '', by: it.by || null, now }));
  }),

  addMessage: (roomId, m) => {
    q.insertMessage.run(roomId, m.name, m.color || null, m.text, m.at);
    if (Math.random() < 0.05) q.pruneMessages.run(roomId, roomId);
  },
  recentMessages: (roomId, limit = 50) => q.recentMessages.all(roomId, limit),
};
