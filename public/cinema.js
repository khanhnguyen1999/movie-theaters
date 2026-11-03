// Dựng phòng chiếu 3D: sàn bậc thang, ghế, tường, rèm, màn chiếu, đèn, trần sao.
import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// Tâm màn chiếu đặt gần ngang tầm mắt hàng giữa (~2.1m) để không phải ngước nhìn
export const SCREEN = { width: 13, height: 13 * 9 / 16, y: 4.3, z: -12 };
export const ROWS = 6;
export const COLS = 10;
const ROW_DEPTH = 1.6;
const ROW_RISE = 0.45;
const SEAT_GAP = 1.1;
export const COUPLE_SEATS = [24, 25];

export function seatPosition(index) {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  return new THREE.Vector3((col - (COLS - 1) / 2) * SEAT_GAP, row * ROW_RISE, -3 + row * ROW_DEPTH);
}

export function eyePosition(index) {
  return seatPosition(index).add(new THREE.Vector3(0, 1.2, 0.05));
}

function makeSeat(material, cushionMat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.7), cushionMat);
  base.position.set(0, 0.45, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.15), material);
  back.position.set(0, 0.88, 0.32);
  back.rotation.x = -0.12;
  const armMat = new THREE.MeshStandardMaterial({ color: 0x1a1016, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.7), armMat);
    arm.position.set(side * 0.47, 0.45, 0);
    g.add(arm);
  }
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.4), armMat);
  leg.position.set(0, 0.18, 0.05);
  g.add(base, back, leg);
  return g;
}

export function buildCinema(scene) {
  const seats = []; // { index, group, hit }

  // Sàn & tường
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a0d18, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 26), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -1;
  scene.add(floor);

  const stepMat = new THREE.MeshStandardMaterial({ color: 0x3a1120, roughness: 0.9 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffb36b });
  for (let r = 1; r < ROWS; r++) {
    const h = r * ROW_RISE;
    const step = new THREE.Mesh(new THREE.BoxGeometry(13, h, ROW_DEPTH), stepMat);
    step.position.set(0, h / 2, -3 + r * ROW_DEPTH);
    scene.add(step);
    // dải đèn LED dẫn lối ở mép bậc
    const strip = new THREE.Mesh(new THREE.BoxGeometry(13, 0.02, 0.02), stripMat);
    strip.position.set(0, h - 0.02, -3 + r * ROW_DEPTH - ROW_DEPTH / 2 - 0.01);
    scene.add(strip);
  }
  // sàn sau cùng
  const back = new THREE.Mesh(new THREE.BoxGeometry(13, ROWS * ROW_RISE, 4), stepMat);
  back.position.set(0, (ROWS * ROW_RISE) / 2, -3 + ROWS * ROW_DEPTH + 1.2);
  scene.add(back);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e0a14, roughness: 0.85 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x3d0f22, roughness: 0.7 });
  const H = 11;
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, H), wallMat);
    wall.position.set(side * 9.5, H / 2, -1);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
    // tấm ốp tường tiêu âm
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4, 2.6), panelMat);
      p.position.set(side * 9.42, 4.2, -9 + i * 3.4);
      scene.add(p);
      // đèn tường
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc07a });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), lampMat);
      lamp.position.set(side * 9.3, 6.8, -9 + i * 3.4);
      lamp.userData.lamp = true;
      scene.add(lamp);
    }
  }
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(19, H), wallMat);
  backWall.position.set(0, H / 2, 12);
  backWall.rotation.y = Math.PI;
  scene.add(backWall);
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(19, H), new THREE.MeshStandardMaterial({ color: 0x0c0508 }));
  frontWall.position.set(0, H / 2, SCREEN.z - 0.3);
  scene.add(frontWall);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(19, 26), new THREE.MeshStandardMaterial({ color: 0x07030a }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, -1);
  scene.add(ceiling);

  // Trần sao lấp lánh
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 500; i++) starPos.push((Math.random() - 0.5) * 18, H - 0.05, -13 + Math.random() * 25);
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xfff1d6, size: 0.06, transparent: true, opacity: 0.9 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Sân khấu, rèm
  const stage = new THREE.Mesh(new THREE.BoxGeometry(19, 0.6, 2), new THREE.MeshStandardMaterial({ color: 0x14070c }));
  stage.position.set(0, 0.3, SCREEN.z + 0.7);
  scene.add(stage);
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x8a0c26, roughness: 0.6 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, H - 0.6, 10), curtainMat);
      fold.position.set(side * (SCREEN.width / 2 + 0.4 + i * 0.3), (H - 0.6) / 2 + 0.6, SCREEN.z + 0.2 + (i % 2) * 0.12);
      scene.add(fold);
    }
  }
  // diềm rèm phủ từ sát mép trên màn chiếu lên tới trần
  const valanceBottom = SCREEN.y + SCREEN.height / 2 + 0.35;
  const valance = new THREE.Mesh(new THREE.BoxGeometry(19, H - valanceBottom, 0.4), curtainMat);
  valance.position.set(0, (H + valanceBottom) / 2, SCREEN.z + 0.3);
  scene.add(valance);

  // Khung màn chiếu
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN.width + 0.4, SCREEN.height + 0.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 })
  );
  bezel.position.set(0, SCREEN.y, SCREEN.z - 0.06);
  scene.add(bezel);

  // Ghế
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x9e1430, roughness: 0.75 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0xb81a3a, roughness: 0.8 });
  const coupleMat = new THREE.MeshStandardMaterial({ color: 0xe0518a, roughness: 0.7 });
  const coupleCushion = new THREE.MeshStandardMaterial({ color: 0xff6b9d, roughness: 0.75 });
  const hitGeo = new THREE.BoxGeometry(0.95, 1.3, 0.9);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (let i = 0; i < ROWS * COLS; i++) {
    const couple = COUPLE_SEATS.includes(i);
    const g = makeSeat(couple ? coupleMat : seatMat, couple ? coupleCushion : cushionMat);
    g.position.copy(seatPosition(i));
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.y = 0.65;
    hit.userData.seatIndex = i;
    g.add(hit);
    scene.add(g);
    seats.push({ index: i, group: g, hit });
  }

  // Ánh sáng
  const ambient = new THREE.AmbientLight(0xffe0ef, 0.08);
  const hemi = new THREE.HemisphereLight(0x553355, 0x110508, 0.25);
  scene.add(ambient, hemi);
  const sconces = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb070, 3, 9, 2);
      l.position.set(side * 8.6, 6.5, -8 + i * 7);
      scene.add(l);
      sconces.push(l);
    }
  }
  // ánh sáng hắt ra từ màn chiếu
  const screenLight = new THREE.PointLight(0xb8d4ff, 0, 30, 1.2);
  screenLight.position.set(0, SCREEN.y, SCREEN.z + 3);
  scene.add(screenLight);

  // Tia máy chiếu
  const beamLen = 12 - SCREEN.z - 0.5;
  const beamGeo = new THREE.CylinderGeometry(0.05, SCREEN.width * 0.42, beamLen, 32, 1, true);
  beamGeo.rotateX(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xc8dcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  const projector = new THREE.Vector3(0, 8.3, 11.8);
  const target = new THREE.Vector3(0, SCREEN.y, SCREEN.z);
  beam.position.copy(projector).lerp(target, 0.5);
  beam.lookAt(projector);
  scene.add(beam);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe6f0ff }));
  lens.position.copy(projector);
  scene.add(lens);

  return { seats, stars, ambient, hemi, sconces, screenLight, beam };
}

/** Màn chiếu: iframe YouTube trong CSS3D + mặt phẳng "khoét lỗ" trong WebGL */
export function buildScreen(scene, cssScene) {
  const PX_W = 1280;
  const PX_H = 720;
  const wrapper = document.createElement('div');
  wrapper.style.width = PX_W + 'px';
  wrapper.style.height = PX_H + 'px';
  wrapper.style.background = '#000';
  const holder = document.createElement('div');
  holder.id = 'yt-holder';
  wrapper.appendChild(holder);

  const cssObj = new CSS3DObject(wrapper);
  cssObj.position.set(0, SCREEN.y, SCREEN.z);
  cssObj.scale.setScalar(SCREEN.width / PX_W);
  cssScene.add(cssObj);

  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.width, SCREEN.height),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending, side: THREE.DoubleSide })
  );
  hole.position.copy(cssObj.position);
  scene.add(hole);
  return { holder, hole };
}
