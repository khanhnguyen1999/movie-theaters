// Bảng điều khiển 3D đặt trước ghế: thanh tiến trình + các nút bấm vẽ bằng CanvasTexture.
import * as THREE from 'three';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

class Button3D {
  constructor({ label, width = 0.12, height = 0.12, onClick, hint }) {
    this.label = label;
    this.hint = hint;
    this.onClick = onClick;
    this.hover = false;
    this.active = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(256 * (width / height));
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true })
    );
    this.mesh.userData.button = this;
    this.draw();
  }
  setLabel(label) {
    if (label !== this.label) { this.label = label; this.draw(); }
  }
  setHover(v) {
    if (v !== this.hover) { this.hover = v; this.draw(); this.mesh.scale.setScalar(v ? 1.08 : 1); }
  }
  setActive(v) {
    if (v !== this.active) { this.active = v; this.draw(); }
  }
  draw() {
    const { canvas: c } = this;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    roundRect(ctx, 8, 8, c.width - 16, c.height - 16, 60);
    ctx.fillStyle = this.active ? 'rgba(255,107,157,.95)' : this.hover ? 'rgba(255,107,157,.55)' : 'rgba(40,14,34,.85)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,170,200,.6)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${this.label.length > 2 ? 90 : 130}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(this.label, c.width / 2, c.height / 2 + 8);
    this.texture.needsUpdate = true;
  }
}

/** Thanh tiến trình: nhấp để tua */
class ProgressBar {
  constructor({ width, height, onSeek }) {
    this.width = width;
    this.onSeek = onSeek;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 96;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true })
    );
    this.mesh.userData.progress = this;
    this.key = '';
    this.hoverFrac = null;
    this.update(0, 0, '');
  }
  update(current, duration, title) {
    const key = `${Math.floor(current)}|${Math.floor(duration)}|${title}|${this.hoverFrac?.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width;
    ctx.clearRect(0, 0, W, 96);
    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const t = title.length > 48 ? title.slice(0, 47) + '…' : title;
    ctx.fillText(t || 'Đang tải…', 12, 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt(current)} / ${fmt(duration)}`, W - 12, 4);
    roundRect(ctx, 12, 52, W - 24, 26, 13);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fill();
    const frac = duration ? Math.min(1, current / duration) : 0;
    if (frac > 0) {
      roundRect(ctx, 12, 52, Math.max(26, (W - 24) * frac), 26, 13);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#ff6b9d');
      grad.addColorStop(1, '#ffb36b');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    if (this.hoverFrac != null) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(12 + (W - 24) * this.hoverFrac - 2, 46, 4, 38);
    }
    this.texture.needsUpdate = true;
  }
  fracFromUv(uv) {
    const px = uv.x * 1024;
    return Math.min(1, Math.max(0, (px - 12) / (1024 - 24)));
  }
}

export function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function buildControlPanel(actions) {
  const group = new THREE.Group();
  const W = 1.0;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.08, 0.42),
    new THREE.MeshBasicMaterial({ color: 0x14060f, transparent: true, opacity: 0.82 })
  );
  bg.position.z = -0.002;
  group.add(bg);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.12, 0.46),
    new THREE.MeshBasicMaterial({ color: 0xff6b9d, transparent: true, opacity: 0.25 })
  );
  glow.position.z = -0.004;
  group.add(glow);

  const progress = new ProgressBar({ width: W, height: W * 96 / 1024, onSeek: actions.seekFrac });
  progress.mesh.position.set(0, 0.14, 0);
  group.add(progress.mesh);

  const defs = [
    { key: 'back', label: '⏪', onClick: actions.back10 },
    { key: 'play', label: '▶️', onClick: actions.togglePlay },
    { key: 'fwd', label: '⏩', onClick: actions.fwd10 },
    { key: 'voldown', label: '🔉', onClick: actions.volDown },
    { key: 'volup', label: '🔊', onClick: actions.volUp },
    { key: 'lights', label: '💡', onClick: actions.toggleLights },
    { key: 'link', label: '🔗', onClick: actions.changeLink },
    { key: 'full', label: '⛶', onClick: actions.fullscreen },
  ];
  const reacts = ['❤️', '😂', '😮', '😢', '🍿', '😘'];
  const buttons = {};
  const all = [];
  const size = 0.1;
  const gap = (W - defs.length * size) / (defs.length - 1);
  defs.forEach((d, i) => {
    const b = new Button3D({ label: d.label, width: size, height: size, onClick: d.onClick });
    b.mesh.position.set(-W / 2 + size / 2 + i * (size + gap), 0.0, 0.001);
    group.add(b.mesh);
    buttons[d.key] = b;
    all.push(b);
  });
  const rSize = 0.085;
  const rGap = 0.03;
  const rW = reacts.length * rSize + (reacts.length - 1) * rGap;
  reacts.forEach((emoji, i) => {
    const b = new Button3D({ label: emoji, width: rSize, height: rSize, onClick: () => actions.react(emoji) });
    b.mesh.position.set(-rW / 2 + rSize / 2 + i * (rSize + rGap), -0.13, 0.001);
    group.add(b.mesh);
    all.push(b);
  });

  return { group, buttons, all, progress };
}

/** Sprite chữ / emoji dùng cho tên, bong bóng chat, cảm xúc */
export function textSprite(text, { font = 64, color = '#fff', bg = null, padding = 18, maxWidth = 900 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontStr = `${font}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.font = fontStr;
  // xuống dòng đơn giản
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  lines.push(line);
  const w = Math.min(maxWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + padding * 2;
  const h = lines.length * font * 1.25 + padding * 2;
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  ctx.font = fontStr;
  if (bg) {
    roundRect(ctx, 0, 0, c.width, c.height, Math.min(40, c.height / 2));
    ctx.fillStyle = bg;
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, padding + font * 1.25 * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const scale = 0.0016;
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  return sprite;
}
