import * as THREE from 'three';

/* ============================================================
   FlowPOS landing scene
   Five devices around a "FlowPOS Cloud" hub. Every few seconds
   an order travels: source (till / kiosk / web) → cloud →
   kitchen screen + dashboard, and their screens update live.
   Scrolling flies the camera from device to device.
   ============================================================ */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = {
  bg: 0x070a12, teal: 0x2ee6c5, purple: 0x8b5cf6, pink: 0xf472b6,
  amber: 0xfbbf24, body: 0x161c2c, body2: 0x0f1422,
};

/* ---------- Renderer ---------- */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
scene.fog = new THREE.Fog(C.bg, 20, 46);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 8, 18);

scene.add(new THREE.HemisphereLight(0x8fa4ff, 0x0a0f1c, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(6, 12, 10);
scene.add(key);
const HUB = new THREE.Vector3(0, 3.6, -3);
const tealLight = new THREE.PointLight(C.teal, 30, 18, 2);
tealLight.position.set(-3, 3, -1);
const purpleLight = new THREE.PointLight(C.purple, 30, 18, 2);
purpleLight.position.set(3, 3, -1);
scene.add(tealLight, purpleLight);

/* ---------- Small helpers ---------- */
const now = () => performance.now() / 1000;
const money = (v) => '£' + v.toFixed(2);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function txt(ctx, s, x, y, size, color, weight = 500, align = 'left') {
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

let edgeBucket = null; // collects edge materials per device so they can glow
function box(w, h, d, color = C.body, edgeOpacity = 0.35) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.65 }));
  const mat = new THREE.LineBasicMaterial({ color: C.teal, transparent: true, opacity: edgeOpacity });
  mat.userData.base = edgeOpacity;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat));
  if (edgeBucket) edgeBucket.push(mat);
  return mesh;
}
function place(obj, x, y, z) { obj.position.set(x, y, z); return obj; }
function cyl(r, h, color = C.body) {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.7 })
  );
}

const screens = [];
function makeScreen(w, h, pxW, draw) {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = Math.round((pxW * h) / w);
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  const s = {
    mesh,
    redraw() { draw(ctx, c.width, c.height); tex.needsUpdate = true; },
  };
  s.redraw();
  screens.push(s);
  return s;
}

/* ---------- Live demo data ---------- */
const MENU = [
  { n: 'Flat White', p: 3.2, c: '#2ee6c5' }, { n: 'Croissant', p: 2.8, c: '#fbbf24' },
  { n: 'Burger', p: 9.5, c: '#f472b6' }, { n: 'Fries', p: 3.0, c: '#fb923c' },
  { n: 'Iced Latte', p: 3.6, c: '#60a5fa' }, { n: 'Salad', p: 7.2, c: '#4ade80' },
  { n: 'Brownie', p: 2.9, c: '#a78bfa' }, { n: 'Smoothie', p: 4.5, c: '#f87171' },
  { n: 'Bagel', p: 3.8, c: '#facc15' },
];
const S = {
  nextId: 1042,
  sales: 3482.5,
  orders: 186,
  channels: { Till: 112, Kiosk: 46, Online: 28 },
  chart: Array.from({ length: 24 }, (_, i) => 40 + Math.sin(i / 3) * 14 + i * 2.2 + Math.random() * 8),
  tickets: [],
  till: null, tillSent: 0, readerPaid: 0,
  kiosk: null, kioskDone: 0,
  store: null, storeDone: 0,
};
function randomOrder(source) {
  const pool = [...MENU].sort(() => Math.random() - 0.5);
  const items = pool.slice(0, 1 + Math.floor(Math.random() * 3)).map((m) => ({ ...m, q: 1 + (Math.random() < 0.3 ? 1 : 0) }));
  const total = items.reduce((a, i) => a + i.p * i.q, 0);
  return { id: S.nextId++, table: 1 + Math.floor(Math.random() * 12), items, total, source, born: now() };
}
S.till = randomOrder('Till');
S.kiosk = randomOrder('Kiosk');
S.store = randomOrder('Online');
[190, 85, 30].forEach((age, i) => {
  const o = randomOrder(['Till', 'Kiosk', 'Online'][i]);
  o.born = now() - age;
  S.tickets.push(o);
});

/* ---------- Screen drawings ---------- */
function drawTill(ctx, W, H) {
  ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#121b30'; ctx.fillRect(0, 0, W, 40);
  txt(ctx, 'FlowPOS · Till 1', 18, 26, 16, '#e8ecf5', 600);
  const d = new Date();
  txt(ctx, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), W - 18, 26, 15, '#9aa4b8', 500, 'right');
  // product grid
  const gx = 16, gy = 54, tw = 118, th = 92, gap = 9;
  MENU.forEach((m, i) => {
    const x = gx + (i % 3) * (tw + gap), y = gy + Math.floor(i / 3) * (th + gap);
    const active = S.till.items.some((it) => it.n === m.n);
    rr(ctx, x, y, tw, th, 12);
    ctx.fillStyle = active ? m.c + '44' : '#141d33'; ctx.fill();
    ctx.strokeStyle = active ? m.c : '#22304d'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(x + 22, y + 24, 9, 0, Math.PI * 2); ctx.fill();
    txt(ctx, m.n, x + 12, y + th - 30, 15, '#e8ecf5', 600);
    txt(ctx, money(m.p), x + 12, y + th - 11, 14, '#9aa4b8');
  });
  // order panel
  const px = 410, pw = W - px - 16;
  rr(ctx, px, 54, pw, H - 70, 14); ctx.fillStyle = '#121b30'; ctx.fill();
  txt(ctx, `Table ${S.till.table}`, px + 16, 86, 20, '#e8ecf5', 700);
  txt(ctx, `#${S.till.id}`, px + pw - 16, 86, 14, '#9aa4b8', 500, 'right');
  S.till.items.forEach((it, i) => {
    const y = 124 + i * 32;
    txt(ctx, `${it.q}× ${it.n}`, px + 16, y, 15, '#c3cad8');
    txt(ctx, money(it.p * it.q), px + pw - 16, y, 15, '#c3cad8', 500, 'right');
  });
  ctx.fillStyle = '#22304d'; ctx.fillRect(px + 16, H - 128, pw - 32, 1);
  txt(ctx, 'Total', px + 16, H - 98, 16, '#9aa4b8');
  txt(ctx, money(S.till.total), px + pw - 16, H - 98, 20, '#e8ecf5', 700, 'right');
  const sent = now() < S.tillSent;
  rr(ctx, px + 16, H - 78, pw - 32, 46, 12);
  ctx.fillStyle = sent ? '#4ade80' : '#2ee6c5'; ctx.fill();
  txt(ctx, sent ? 'Sent to kitchen ✓' : 'Pay ' + money(S.till.total), px + pw / 2, H - 48, 17, '#061016', 700, 'center');
}

function drawReader(ctx, W, H) {
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, W, H);
  const paid = now() < S.readerPaid;
  txt(ctx, money(S.till.total), W / 2, 70, 34, '#e8ecf5', 700, 'center');
  ctx.strokeStyle = paid ? '#4ade80' : '#2ee6c5'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  if (paid) {
    ctx.beginPath(); ctx.moveTo(W / 2 - 30, 140); ctx.lineTo(W / 2 - 6, 164); ctx.lineTo(W / 2 + 34, 118); ctx.stroke();
    txt(ctx, 'Approved', W / 2, 220, 20, '#4ade80', 600, 'center');
  } else {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(W / 2 - 30, 145, 18 + i * 16, -0.8, 0.8); ctx.stroke();
    }
    txt(ctx, 'Tap to pay', W / 2, 220, 20, '#9aa4b8', 500, 'center');
  }
}

function drawKds(ctx, W, H) {
  ctx.fillStyle = '#0a0f1c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#121b30'; ctx.fillRect(0, 0, W, 54);
  txt(ctx, 'Kitchen display', 22, 36, 22, '#e8ecf5', 700);
  txt(ctx, `${S.tickets.length} open`, W - 22, 36, 18, '#2ee6c5', 600, 'right');
  const cols = 4, gap = 14, tw = (W - gap * (cols + 1)) / cols, t = now();
  S.tickets.forEach((o, i) => {
    const x = gap + i * (tw + gap), y = 70, th = H - 86;
    const age = t - o.born;
    const col = age < 60 ? '#2ee6c5' : age < 150 ? '#fbbf24' : '#f87171';
    rr(ctx, x, y, tw, th, 14); ctx.fillStyle = '#121b30'; ctx.fill();
    if (age < 1.5) { ctx.strokeStyle = '#2ee6c5'; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.save(); rr(ctx, x, y, tw, 58, 14); ctx.clip();
    ctx.fillStyle = col; ctx.fillRect(x, y, tw, 58); ctx.restore();
    txt(ctx, `#${o.id}`, x + 14, y + 37, 22, '#061016', 700);
    const mm = String(Math.floor(age / 60)).padStart(2, '0'), ss = String(Math.floor(age % 60)).padStart(2, '0');
    txt(ctx, `${mm}:${ss}`, x + tw - 14, y + 37, 20, '#061016', 700, 'right');
    txt(ctx, o.source === 'Till' ? `Table ${o.table}` : o.source, x + 14, y + 90, 16, '#9aa4b8', 600);
    o.items.forEach((it, j) => txt(ctx, `${it.q}× ${it.n}`, x + 14, y + 130 + j * 36, 20, '#e8ecf5', 600));
    rr(ctx, x + 14, y + th - 58, tw - 28, 42, 10); ctx.strokeStyle = '#22304d'; ctx.lineWidth = 2; ctx.stroke();
    txt(ctx, 'Bump', x + tw / 2, y + th - 31, 16, '#9aa4b8', 600, 'center');
  });
}

function drawKiosk(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#141a33'); g.addColorStop(1, '#0a0f1c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  txt(ctx, 'Hello!', 24, 58, 32, '#e8ecf5', 700);
  txt(ctx, 'What can we get you?', 24, 88, 18, '#9aa4b8');
  ['Coffee', 'Food', 'Sweet'].forEach((c, i) => {
    rr(ctx, 24 + i * 108, 108, 98, 36, 18);
    ctx.fillStyle = i === 0 ? '#fbbf24' : '#1b2440'; ctx.fill();
    txt(ctx, c, 24 + i * 108 + 49, 132, 15, i === 0 ? '#061016' : '#c3cad8', 600, 'center');
  });
  const tw = (W - 24 * 2 - 14) / 2, th = 140;
  MENU.slice(0, 6).forEach((m, i) => {
    const x = 24 + (i % 2) * (tw + 14), y = 162 + Math.floor(i / 2) * (th + 14);
    rr(ctx, x, y, tw, th, 16); ctx.fillStyle = '#18213b'; ctx.fill();
    ctx.fillStyle = m.c + '55'; ctx.beginPath(); ctx.arc(x + tw / 2, y + 52, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(x + tw / 2, y + 52, 18, 0, Math.PI * 2); ctx.fill();
    txt(ctx, m.n, x + 14, y + th - 32, 16, '#e8ecf5', 600);
    txt(ctx, money(m.p), x + 14, y + th - 12, 14, '#9aa4b8');
  });
  const done = now() < S.kioskDone;
  rr(ctx, 24, H - 84, W - 48, 60, 30);
  ctx.fillStyle = done ? '#4ade80' : '#fbbf24'; ctx.fill();
  const n = S.kiosk.items.reduce((a, i) => a + i.q, 0);
  txt(ctx, done ? 'Order placed ✓' : `Checkout · ${n} items · ${money(S.kiosk.total)}`, W / 2, H - 47, 17, '#061016', 700, 'center');
}

function drawDashboard(ctx, W, H) {
  ctx.fillStyle = '#0a0f1c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#10172a'; ctx.fillRect(0, 0, 62, H);
  rr(ctx, 15, 16, 32, 32, 9);
  const lg = ctx.createLinearGradient(15, 16, 47, 48); lg.addColorStop(0, '#2ee6c5'); lg.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = lg; ctx.fill();
  for (let i = 0; i < 5; i++) { rr(ctx, 21, 76 + i * 46, 20, 20, 6); ctx.fillStyle = i === 0 ? '#2ee6c5' : '#22304d'; ctx.fill(); }
  txt(ctx, 'Overview', 84, 42, 22, '#e8ecf5', 700);
  txt(ctx, 'Today · All locations', 84, 64, 13, '#9aa4b8');
  const kpis = [['Sales', money(S.sales)], ['Orders', String(S.orders)], ['Avg basket', money(S.sales / S.orders)]];
  const kw = (W - 84 - 16 - 24) / 3;
  kpis.forEach(([k, v], i) => {
    const x = 84 + i * (kw + 12);
    rr(ctx, x, 82, kw, 74, 12); ctx.fillStyle = '#121b30'; ctx.fill();
    txt(ctx, k, x + 14, 106, 13, '#9aa4b8');
    txt(ctx, v, x + 14, 140, 24, '#e8ecf5', 700);
  });
  // line chart
  const cx = 84, cy = 172, cw = W - 84 - 16 - 190, ch = H - cy - 18;
  rr(ctx, cx, cy, cw, ch, 12); ctx.fillStyle = '#121b30'; ctx.fill();
  txt(ctx, 'Sales by hour', cx + 14, cy + 26, 14, '#c3cad8', 600);
  const pts = S.chart.slice(-24), max = Math.max(...pts) * 1.1, min = Math.min(...pts) * 0.8;
  const px = (i) => cx + 14 + (i / (pts.length - 1)) * (cw - 28);
  const py = (v) => cy + ch - 14 - ((v - min) / (max - min)) * (ch - 54);
  const grad = ctx.createLinearGradient(0, cy + 40, 0, cy + ch);
  grad.addColorStop(0, 'rgba(46,230,197,0.35)'); grad.addColorStop(1, 'rgba(46,230,197,0)');
  ctx.beginPath(); ctx.moveTo(px(0), cy + ch - 14);
  pts.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(px(pts.length - 1), cy + ch - 14); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.strokeStyle = '#2ee6c5'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#2ee6c5'; ctx.beginPath(); ctx.arc(px(pts.length - 1), py(pts[pts.length - 1]), 6, 0, Math.PI * 2); ctx.fill();
  // channel bars
  const bx = cx + cw + 12, bw = W - bx - 16;
  rr(ctx, bx, cy, bw, ch, 12); ctx.fillStyle = '#121b30'; ctx.fill();
  txt(ctx, 'By channel', bx + 14, cy + 26, 14, '#c3cad8', 600);
  const total = S.channels.Till + S.channels.Kiosk + S.channels.Online;
  [['Till', '#2ee6c5'], ['Kiosk', '#fbbf24'], ['Online', '#f472b6']].forEach(([k, col], i) => {
    const y = cy + 58 + i * 64, frac = S.channels[k] / total;
    txt(ctx, k, bx + 14, y, 13, '#9aa4b8');
    txt(ctx, String(S.channels[k]), bx + bw - 14, y, 13, '#e8ecf5', 600, 'right');
    rr(ctx, bx + 14, y + 10, bw - 28, 12, 6); ctx.fillStyle = '#1b2440'; ctx.fill();
    rr(ctx, bx + 14, y + 10, Math.max(12, (bw - 28) * frac), 12, 6); ctx.fillStyle = col; ctx.fill();
  });
}

function drawStore(ctx, W, H) {
  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
  txt(ctx, '9:41', 22, 30, 14, '#e8ecf5', 600);
  txt(ctx, 'Bean & Co', 22, 74, 24, '#e8ecf5', 700);
  rr(ctx, W - 58, 50, 36, 36, 10); ctx.fillStyle = '#1b2440'; ctx.fill();
  const n = S.store.items.reduce((a, i) => a + i.q, 0);
  ctx.fillStyle = '#f472b6'; ctx.beginPath(); ctx.arc(W - 24, 52, 10, 0, Math.PI * 2); ctx.fill();
  txt(ctx, String(n), W - 24, 57, 12, '#061016', 700, 'center');
  const g = ctx.createLinearGradient(0, 100, W, 230);
  g.addColorStop(0, '#8b5cf6'); g.addColorStop(1, '#f472b6');
  rr(ctx, 18, 100, W - 36, 130, 18); ctx.fillStyle = g; ctx.fill();
  txt(ctx, 'Order online,', 36, 152, 22, '#fff', 700);
  txt(ctx, 'collect in 10 min', 36, 180, 22, '#fff', 700);
  txt(ctx, 'Same menu as in store', 36, 208, 13, 'rgba(255,255,255,0.85)');
  const cw = (W - 36 - 12) / 2;
  [MENU[0], MENU[2], MENU[4], MENU[6]].forEach((m, i) => {
    const x = 18 + (i % 2) * (cw + 12), y = 250 + Math.floor(i / 2) * 150;
    rr(ctx, x, y, cw, 138, 14); ctx.fillStyle = '#151d35'; ctx.fill();
    ctx.fillStyle = m.c + '55'; rr(ctx, x + 10, y + 10, cw - 20, 64, 10); ctx.fill();
    ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(x + cw / 2, y + 42, 16, 0, Math.PI * 2); ctx.fill();
    txt(ctx, m.n, x + 12, y + 98, 14, '#e8ecf5', 600);
    txt(ctx, money(m.p), x + 12, y + 120, 13, '#9aa4b8');
  });
  const done = now() < S.storeDone;
  rr(ctx, 18, H - 78, W - 36, 54, 27);
  ctx.fillStyle = done ? '#4ade80' : '#f472b6'; ctx.fill();
  txt(ctx, done ? 'Order placed ✓' : `Checkout · ${money(S.store.total)}`, W / 2, H - 45, 17, '#061016', 700, 'center');
}

/* ---------- Device builders (front of each device faces +Z) ---------- */
function buildTill() {
  const g = new THREE.Group();
  const counter = box(3.2, 1.0, 1.4, C.body2, 0.25); counter.position.y = 0.5; g.add(counter);
  const stand = cyl(0.1, 0.4); stand.position.set(-0.35, 1.2, -0.1); g.add(stand);
  const head = new THREE.Group(); head.position.set(-0.35, 1.95, 0); head.rotation.x = -0.18; g.add(head);
  head.add(box(1.82, 1.18, 0.08));
  const tillScreen = makeScreen(1.7, 1.06, 680, drawTill);
  tillScreen.mesh.position.z = 0.045; head.add(tillScreen.mesh);
  // card reader
  const reader = new THREE.Group(); reader.position.set(1.15, 1.32, 0.25); reader.rotation.set(-0.35, -0.35, 0); g.add(reader);
  reader.add(box(0.42, 0.66, 0.07, 0x10141f, 0.5));
  const readerScreen = makeScreen(0.34, 0.42, 240, drawReader);
  readerScreen.mesh.position.set(0, 0.08, 0.04); reader.add(readerScreen.mesh);
  return { group: g, anchorY: 2.7, centerY: 1.75, dist: 4.4 };
}
function buildKds() {
  const g = new THREE.Group();
  const base = cyl(0.55, 0.06); base.position.y = 0.03; g.add(base);
  const pole = cyl(0.06, 2.1); pole.position.y = 1.08; g.add(pole);
  g.add(place(box(2.72, 1.66, 0.1), 0, 2.75, 0));
  const s = makeScreen(2.6, 1.56, 1000, drawKds);
  s.mesh.position.set(0, 2.75, 0.055); g.add(s.mesh);
  return { group: g, anchorY: 3.6, centerY: 2.6, dist: 5.0 };
}
function buildKiosk() {
  const g = new THREE.Group();
  g.add(place(box(1.3, 0.1, 0.8, C.body2), 0, 0.05, 0));
  g.add(place(box(1.18, 3.0, 0.26), 0, 1.6, 0));
  const s = makeScreen(1.0, 1.75, 420, drawKiosk);
  s.mesh.position.set(0, 2.15, 0.135); g.add(s.mesh);
  const pay = box(0.3, 0.2, 0.12, 0x10141f, 0.6); pay.position.set(0.32, 0.9, 0.18); g.add(pay);
  const slot = box(0.5, 0.05, 0.04, 0x05070d, 0.5); slot.position.set(-0.2, 0.9, 0.14); g.add(slot);
  return { group: g, anchorY: 3.4, centerY: 2.0, dist: 5.0 };
}
function buildDashboard() {
  const g = new THREE.Group();
  const top = box(2.6, 0.08, 1.4, C.body2, 0.25); top.position.y = 0.98; g.add(top);
  [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]].forEach(([x, z]) => {
    const leg = cyl(0.04, 0.94); leg.position.set(x, 0.47, z); g.add(leg);
  });
  const lap = box(1.9, 0.05, 1.25); lap.position.set(0, 1.045, 0.05); g.add(lap);
  const hinge = new THREE.Group(); hinge.position.set(0, 1.07, -0.57); hinge.rotation.x = -0.22; g.add(hinge);
  const lid = box(1.9, 1.2, 0.04); lid.position.y = 0.6; hinge.add(lid);
  const s = makeScreen(1.8, 1.1, 760, drawDashboard);
  s.mesh.position.set(0, 0.6, 0.025); hinge.add(s.mesh);
  return { group: g, anchorY: 2.5, centerY: 1.55, dist: 3.7 };
}
function buildStore() {
  const g = new THREE.Group();
  const plinth = cyl(0.55, 0.9, C.body2); plinth.position.y = 0.45; g.add(plinth);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: C.pink }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.9; g.add(ring);
  const phone = new THREE.Group(); phone.position.set(0, 1.62, 0); phone.rotation.x = -0.12; g.add(phone);
  phone.add(box(0.64, 1.26, 0.06, 0x10141f, 0.5));
  const s = makeScreen(0.58, 1.18, 330, drawStore);
  s.mesh.position.z = 0.032; phone.add(s.mesh);
  return { group: g, anchorY: 2.4, centerY: 1.6, dist: 3.0, phone };
}

/* ---------- Layout: arc of devices around the hub ---------- */
const R = 7.6;
const devices = {};
const LAYOUT = [
  ['till', buildTill, -64],
  ['kds', buildKds, -32],
  ['store', buildStore, 0],
  ['kiosk', buildKiosk, 32],
  ['dashboard', buildDashboard, 64],
];
const ringGeo = new THREE.RingGeometry(1.5, 1.56, 72);
LAYOUT.forEach(([name, build, deg]) => {
  edgeBucket = [];
  const d = build();
  const edges = edgeBucket;
  edgeBucket = null;
  const a = THREE.MathUtils.degToRad(deg);
  d.group.position.set(R * Math.sin(a), 0, HUB.z + R * Math.cos(a));
  d.group.rotation.y = Math.atan2(Math.sin(a) * 0.55, Math.cos(a) + 0.7);
  scene.add(d.group);

  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.45 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(d.group.position.x, 0.01, d.group.position.z);
  scene.add(ring);

  d.group.updateMatrixWorld(true);
  const start = new THREE.Vector3(0, d.anchorY, 0).applyMatrix4(d.group.matrixWorld);
  const mid = start.clone().lerp(HUB, 0.5).add(new THREE.Vector3(0, 2.4, 0));
  const curve = new THREE.QuadraticBezierCurve3(start, mid, HUB.clone());
  const tubeMat = new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.18, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.018, 6, false), tubeMat));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: C.teal }));
  cap.position.copy(start); scene.add(cap);

  devices[name] = { ...d, edges, ring, tubeMat, curve, flash: 0 };
});

/* ---------- Hub ---------- */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();
const glowSprite = (color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
};

const hub = new THREE.Group(); hub.position.copy(HUB); scene.add(hub);
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.7, 1),
  new THREE.MeshStandardMaterial({ color: 0x1a1240, emissive: C.purple, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4, flatShading: true })
);
hub.add(core);
const shell = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.15, 1)),
  new THREE.LineBasicMaterial({ color: C.teal, transparent: true, opacity: 0.7 })
);
hub.add(shell);
const rings = [0, 1, 2].map((i) => {
  const r = new THREE.Mesh(
    new THREE.TorusGeometry(1.6 + i * 0.35, 0.012, 8, 128),
    new THREE.MeshBasicMaterial({ color: i === 1 ? C.purple : C.teal, transparent: true, opacity: 0.55 })
  );
  r.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.6, 0);
  hub.add(r);
  return r;
});
const hubGlow = glowSprite(C.purple, 6, 0.55); hub.add(hubGlow);
const hubGlow2 = glowSprite(C.teal, 3, 0.5); hub.add(hubGlow2);
// label
{
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  txt(ctx, 'FLOWPOS CLOUD', 256, 60, 40, '#e8ecf5', 700, 'center');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.85 }));
  label.scale.set(2.6, 0.49, 1); label.position.y = -2.0;
  hub.add(label);
  document.fonts?.ready.then(() => { ctx.clearRect(0, 0, 512, 96); txt(ctx, 'FLOWPOS CLOUD', 256, 60, 40, '#e8ecf5', 700, 'center'); t.needsUpdate = true; });
}
let hubPulse = 0;

/* ---------- Floor + dust ---------- */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64),
  new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.95, metalness: 0.1 })
);
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const grid = new THREE.GridHelper(80, 80, 0x1d6b63, 0x162038);
grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = 0.005;
scene.add(grid);

const DUST = 700;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 40;
  dustPos[i * 3 + 1] = Math.random() * 14;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 40 - 3;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x7dd3fc, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
}));
scene.add(dust);

/* ---------- Order packets ---------- */
const packets = [];
function spawnPacket(name, toHub, color, onArrive) {
  const group = new THREE.Group();
  const head = glowSprite(color, 0.8);
  const trail = Array.from({ length: 10 }, (_, i) => glowSprite(color, 0.55 - i * 0.04, 0.6 - i * 0.055));
  group.add(head, ...trail);
  scene.add(group);
  packets.push({ curve: devices[name].curve, toHub, t: 0, speed: reduceMotion ? 0.4 : 0.6, head, trail, group, onArrive });
}
function updatePackets(dt) {
  for (let i = packets.length - 1; i >= 0; i--) {
    const p = packets[i];
    p.t = Math.min(1, p.t + dt * p.speed);
    const u = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2; // ease in-out
    const at = (v) => p.curve.getPoint(p.toHub ? v : 1 - v);
    p.head.position.copy(at(u));
    p.trail.forEach((s, j) => s.position.copy(at(Math.max(0, u - (j + 1) * 0.015))));
    if (p.t >= 1) {
      scene.remove(p.group);
      p.group.children.forEach((s) => s.material.dispose());
      packets.splice(i, 1);
      p.onArrive?.();
    }
  }
}

/* ---------- The order story ---------- */
const feed = document.getElementById('feed');
function pushFeed(o) {
  const li = document.createElement('li');
  li.innerHTML = `<span><b>#${o.id}</b> · ${o.source}</span><em>${money(o.total)}</em>`;
  feed.prepend(li);
  while (feed.children.length > 4) feed.lastChild.remove();
}
const SOURCES = [
  { name: 'till', label: 'Till', color: C.teal },
  { name: 'kiosk', label: 'Kiosk', color: C.amber },
  { name: 'store', label: 'Online', color: C.pink },
];
let sourceIdx = 0;
function newOrder() {
  const src = SOURCES[sourceIdx++ % SOURCES.length];
  const o = randomOrder(src.label);
  const t = now();
  if (src.name === 'till') { S.till = o; S.tillSent = t + 1.6; S.readerPaid = t + 1.6; }
  if (src.name === 'kiosk') { S.kiosk = o; S.kioskDone = t + 1.6; }
  if (src.name === 'store') { S.store = o; S.storeDone = t + 1.6; }
  devices[src.name].flash = 1;
  spawnPacket(src.name, true, src.color, () => {
    hubPulse = 1;
    pushFeed(o);
    spawnPacket('kds', false, src.color, () => {
      o.born = now();
      S.tickets.push(o);
      if (S.tickets.length > 4) S.tickets.shift();
      devices.kds.flash = 1;
    });
    spawnPacket('dashboard', false, src.color, () => {
      S.sales += o.total; S.orders += 1; S.channels[o.source] += 1;
      const last = S.chart[S.chart.length - 1];
      S.chart.push(Math.max(20, last + (Math.random() - 0.35) * 10));
      devices.dashboard.flash = 1;
    });
  });
}
// keep the "Sent / Approved" state visible a little longer for the next order on that device
setTimeout(newOrder, 900);
setInterval(newOrder, reduceMotion ? 4200 : 2600);

/* ---------- Camera shots + scroll ---------- */
const sections = [...document.querySelectorAll('[data-shot]')];
const isMobile = () => innerWidth < 860;
const UP = new THREE.Vector3(0, 1, 0);
let shots = [];

function shotFor(name) {
  const mobile = isMobile();
  if (name === 'hero') {
    return mobile
      ? { pos: new THREE.Vector3(0, 12, 30), target: new THREE.Vector3(0, 6.5, -2) }
      : { pos: new THREE.Vector3(1, 7.8, 18.5), target: new THREE.Vector3(-5.2, 1.8, -1) };
  }
  if (name === 'cta') {
    return mobile
      ? { pos: new THREE.Vector3(0, 16, 30), target: new THREE.Vector3(0, 7.5, -2) }
      : { pos: new THREE.Vector3(0, 13, 18), target: new THREE.Vector3(0, 6.2, -2) };
  }
  const d = devices[name];
  const ry = d.group.rotation.y;
  const fwd = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)); // direction the device faces
  const center = d.group.position.clone().add(new THREE.Vector3(0, d.centerY, 0));
  const aspect = innerWidth / innerHeight;
  const dist = d.dist * (mobile ? THREE.MathUtils.clamp(0.78 / aspect, 1.1, 2.2) : 1.2);
  const pos = center.clone().addScaledVector(fwd, dist).add(new THREE.Vector3(0, dist * 0.22, 0));
  const target = center.clone();
  // camera right vector; slide the frame so the device sits beside the text card
  const right = new THREE.Vector3().crossVectors(fwd.clone().negate(), UP).normalize();
  const pan = mobile
    ? new THREE.Vector3(0, -dist * 0.2, 0)
    : right.clone().multiplyScalar(-dist * 0.24);
  pos.add(pan); target.add(pan);
  return { pos, target };
}
function buildShots() { shots = sections.map((s) => shotFor(s.dataset.shot)); }
buildShots();

let scrollF = 0;
function readScroll() {
  const mid = scrollY + innerHeight / 2;
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2);
  if (mid <= centers[0]) return 0;
  for (let i = 0; i < centers.length - 1; i++) {
    if (mid < centers[i + 1]) return i + (mid - centers[i]) / (centers[i + 1] - centers[i]);
  }
  return centers.length - 1;
}
const smooth = (x) => x * x * (3 - 2 * x);
const camTarget = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
{
  scrollF = readScroll();
  const s = shots[Math.round(scrollF)];
  camera.position.copy(s.pos); camTarget.copy(s.target);
}

// section dots + reveal
const dotsNav = document.querySelector('.dots');
const dots = sections.map((s, i) => {
  if (!s.id) s.id = i === 0 ? 'intro' : 's' + i;
  const a = document.createElement('a');
  a.href = '#' + s.id; a.setAttribute('aria-label', s.dataset.label || s.id);
  dotsNav.appendChild(a);
  return a;
});
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.isIntersecting && e.target.classList.add('in'));
}, { threshold: 0.35 });
sections.forEach((s) => io.observe(s));

// gentle mouse parallax
const mouse = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  buildShots();
});

/* ---------- Loop ---------- */
const clock = new THREE.Clock();
let redrawAcc = 0;
let activeIdx = -1;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // camera
  scrollF = readScroll();
  const i = Math.min(Math.floor(scrollF), shots.length - 1);
  const j = Math.min(i + 1, shots.length - 1);
  const k = smooth(THREE.MathUtils.clamp((scrollF - i - 0.2) / 0.6, 0, 1));
  desiredPos.lerpVectors(shots[i].pos, shots[j].pos, k);
  desiredTarget.lerpVectors(shots[i].target, shots[j].target, k);
  if (!reduceMotion && !isMobile()) desiredPos.add(new THREE.Vector3(mouse.x * 0.8, -mouse.y * 0.5, 0));
  const ease = reduceMotion ? 1 : 1 - Math.exp(-dt * 4);
  camera.position.lerp(desiredPos, ease);
  camTarget.lerp(desiredTarget, ease);
  camera.lookAt(camTarget);

  // active section
  const nearest = Math.round(scrollF);
  if (nearest !== activeIdx) {
    activeIdx = nearest;
    dots.forEach((d, n) => d.classList.toggle('active', n === nearest));
  }
  const activeName = sections[nearest]?.dataset.shot;

  // devices glow
  Object.entries(devices).forEach(([name, d]) => {
    d.flash = Math.max(0, d.flash - dt * 1.5);
    const focus = name === activeName ? 1 : 0;
    d.edges.forEach((m) => { m.opacity = m.userData.base + d.flash * 0.6 + focus * 0.25; });
    d.ring.material.opacity = 0.35 + focus * 0.4 + d.flash * 0.4;
    d.tubeMat.opacity = 0.14 + focus * 0.2 + d.flash * 0.3;
  });
  if (!reduceMotion) devices.store.phone.position.y = 1.62 + Math.sin(t * 1.4) * 0.05;

  // hub
  hubPulse = Math.max(0, hubPulse - dt * 1.8);
  const spin = reduceMotion ? 0 : dt;
  shell.rotation.y += spin * 0.25; shell.rotation.x += spin * 0.1;
  core.rotation.y -= spin * 0.4;
  rings.forEach((r, n) => { r.rotation.z += spin * (0.2 + n * 0.12) * (n % 2 ? -1 : 1); });
  hub.position.y = HUB.y + (reduceMotion ? 0 : Math.sin(t * 0.8) * 0.12);
  hub.scale.setScalar(1 + hubPulse * 0.18);
  core.material.emissiveIntensity = 0.6 + hubPulse * 1.4;
  hubGlow.material.opacity = 0.5 + hubPulse * 0.4;

  // dust drift
  if (!reduceMotion) {
    const p = dustGeo.attributes.position;
    for (let n = 0; n < DUST; n++) {
      let y = p.getY(n) + dt * 0.15;
      if (y > 14) y = 0;
      p.setY(n, y);
    }
    p.needsUpdate = true;
  }

  updatePackets(dt);

  // screens (cheap 2D redraw a few times a second)
  redrawAcc += dt;
  if (redrawAcc > 0.25) { redrawAcc = 0; screens.forEach((s) => s.redraw()); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
document.fonts?.ready.then(() => screens.forEach((s) => s.redraw()));
requestAnimationFrame(frame);
