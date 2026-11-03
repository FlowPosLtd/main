import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

/* ============================================================
   FlowPOS interactive tour
   Seven devices stand in a ring around the "FlowPOS Cloud".
   The visitor walks through stages (store → checkout → kitchen →
   EPOS → kiosk → payment link → subscription → dashboard) and
   each button press sends a real-looking order or payment
   through the 3D world. Background orders keep the world alive.
   ============================================================ */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const LITE = coarse || innerWidth < 760; // phones/tablets: lighter effects
const C = {
  bg: 0x06080f, teal: 0x2ee6c5, purple: 0x8b5cf6, pink: 0xf472b6,
  amber: 0xfbbf24, sky: 0x60a5fa, green: 0x4ade80, body: 0x161c2c, body2: 0x0f1422,
};
const hot = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // HDR colour for bloom

/* ---------- Renderer ---------- */
const canvas = document.getElementById('scene');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
}
const GL = !!renderer;
if (GL) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
}
if (!coarse) document.body.classList.add('pointer-device');

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.bg);
scene.fog = new THREE.Fog(C.bg, 22, 58);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 140);
camera.position.set(0, 10, 26);

scene.add(new THREE.HemisphereLight(0x8fa4ff, 0x0a0f1c, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(6, 12, 10);
scene.add(key);
const HUB = new THREE.Vector3(0, 3.8, -3);
const tealLight = new THREE.PointLight(C.teal, 40, 20, 2);
tealLight.position.set(-4, 3, -1);
const purpleLight = new THREE.PointLight(C.purple, 40, 20, 2);
purpleLight.position.set(4, 3, -1);
scene.add(tealLight, purpleLight);

/* ---------- Helpers ---------- */
const now = () => performance.now() / 1000;
const money = (v) => '£' + v.toFixed(2);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
let FONT = 'Manrope';
function txt(ctx, s, x, y, size, color, weight = 600, align = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function check(ctx, x, y, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#04110f'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - r * 0.42, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.34); ctx.lineTo(x + r * 0.45, y - r * 0.3); ctx.stroke();
}
function spinner(ctx, x, y, r, color) {
  const a = now() * 6;
  ctx.strokeStyle = color; ctx.lineWidth = r * 0.25; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, r, a, a + 4.2); ctx.stroke();
}

let edgeBucket = null;
function box(w, h, d, color = C.body, edgeOpacity = 0.35) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.7 }));
  const mat = new THREE.LineBasicMaterial({ color: hot(C.teal, 1.4), transparent: true, opacity: edgeOpacity });
  mat.userData.base = edgeOpacity;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat));
  if (edgeBucket) edgeBucket.push(mat);
  return mesh;
}
function place(obj, x, y, z) { obj.position.set(x, y, z); return obj; }
function cyl(r, h, color = C.body) {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 32),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.75 })
  );
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();
function glowSprite(color, size, opacity = 1, k = 1.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: hot(color, k), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

const screens = [];
function makeScreen(w, h, pxW, draw) {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = Math.round((pxW * h) / w);
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = GL ? renderer.capabilities.getMaxAnisotropy() : 1;
  // kept just under the bloom threshold so screen text stays crisp
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: 0xe4e4e4 }));
  const s = { mesh, redraw() { draw(ctx, c.width, c.height); tex.needsUpdate = true; } };
  s.redraw();
  screens.push(s);
  return s;
}
const redrawScreens = () => screens.forEach((s) => s.redraw());

/* ---------- Demo data + state ---------- */
const MENU = [
  { n: 'Flat White', p: 3.2, c: '#2ee6c5' }, { n: 'Croissant', p: 2.8, c: '#fbbf24' },
  { n: 'Burger', p: 9.5, c: '#f472b6' }, { n: 'Fries', p: 3.0, c: '#fb923c' },
  { n: 'Iced Latte', p: 3.6, c: '#60a5fa' }, { n: 'Salad', p: 7.2, c: '#4ade80' },
  { n: 'Brownie', p: 2.9, c: '#a78bfa' }, { n: 'Smoothie', p: 4.5, c: '#f87171' },
  { n: 'Bagel', p: 3.8, c: '#facc15' },
];
const byName = (n) => MENU.find((m) => m.n === n);
const STORE_ITEMS = ['Flat White', 'Burger', 'Iced Latte', 'Brownie'].map(byName);
const POS_ITEMS = ['Flat White', 'Croissant', 'Burger', 'Fries', 'Salad', 'Bagel'].map(byName);
const KIOSK_ITEMS = ['Smoothie', 'Bagel', 'Croissant', 'Iced Latte'].map(byName);
const LINKS = [['Birthday cake', 45], ['Catering deposit', 120], ['Private event', 250]];
const PLANS = [['Coffee Club', 15, 'month'], ['Bakery Box', 9.5, 'week'], ['Lunch Pass', 45, 'month']];
const NAMES = ['Amira K.', 'Tom R.', 'Priya S.', 'Jon B.', 'Leah M.', 'Sam O.', 'Nina F.', 'Ravi P.'];

const S = {
  nextId: 1062,
  sales: 3482.5, orders: 186,
  channels: { POS: 112, Kiosk: 46, Online: 28, Links: 19, Subs: 41 },
  chart: Array.from({ length: 24 }, (_, i) => 40 + Math.sin(i / 3) * 14 + i * 2.2 + Math.random() * 8),
  tickets: [],
  // online store + checkout (the phone)
  cart: [], phone: 'browse', phoneOrder: null,
  // EPOS + reader
  posCart: [], pos: 'idle', posOrder: null,
  // kiosk
  kioskCart: [], kiosk: 'browse', kioskOrder: null,
  // payment link
  linkPick: 1, link: null, linkState: 'none', nextLink: 208,
  // subscriptions
  planPick: 0, subs: { members: 248, feed: [], mine: null, renewedAt: 0 },
  // what the visitor did
  demo: { total: 0, count: 0, done: new Set() },
  inflight: 0, // visitor orders still flying to the kitchen
};
const cartTotal = (cart) => cart.reduce((a, i) => a + i.p * i.q, 0);
const cartCount = (cart) => cart.reduce((a, i) => a + i.q, 0);
const qtyIn = (cart, n) => cart.find((i) => i.n === n)?.q || 0;
function addTo(cart, m) {
  const line = cart.find((i) => i.n === m.n);
  if (line) line.q += 1; else cart.push({ ...m, q: 1 });
}
function nextDate(period, from = new Date()) {
  const d = new Date(from);
  if (period === 'week') d.setDate(d.getDate() + 7);
  else if (period === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}
const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function randomItems() {
  const pool = [...MENU].sort(() => Math.random() - 0.5);
  return pool.slice(0, 1 + Math.floor(Math.random() * 3)).map((m) => ({ ...m, q: Math.random() < 0.3 ? 2 : 1 }));
}
function makeOrder(source, channel, items, mine = false) {
  return { kind: 'order', id: S.nextId++, table: 1 + Math.floor(Math.random() * 12), items, total: cartTotal(items), source, channel, mine, born: now() };
}
let nameIdx = 0;
function renewal(plan) {
  const [name, price, period] = plan || pick(PLANS);
  nameIdx = (nameIdx + 1) % NAMES.length;
  return { who: NAMES[nameIdx], plan: name, total: price, period, next: nextDate(period) };
}
S.subs.feed = [renewal(), renewal(), renewal()];
[200, 90, 35].forEach((age, i) => {
  const o = makeOrder(['EPOS', 'Kiosk', 'Online'][i], ['POS', 'Kiosk', 'Online'][i], randomItems());
  o.born = now() - age;
  S.tickets.push(o);
});

/* ---------- Screen drawings ---------- */
function drawStore(ctx, W, H) {
  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
  txt(ctx, '9:41', 22, 30, 14, '#e8ecf5', 700);
  txt(ctx, 'Bean & Co', 22, 74, 24, '#e8ecf5', 800);
  rr(ctx, W - 58, 50, 36, 36, 10); ctx.fillStyle = '#1b2440'; ctx.fill();
  const n = cartCount(S.cart);
  if (n) {
    ctx.fillStyle = '#f472b6'; ctx.beginPath(); ctx.arc(W - 24, 52, 11, 0, Math.PI * 2); ctx.fill();
    txt(ctx, String(n), W - 24, 57, 12, '#061016', 800, 'center');
  }
  const st = S.phone;
  if (st === 'browse') {
    const g = ctx.createLinearGradient(0, 100, W, 210);
    g.addColorStop(0, '#8b5cf6'); g.addColorStop(1, '#f472b6');
    rr(ctx, 18, 98, W - 36, 104, 18); ctx.fillStyle = g; ctx.fill();
    txt(ctx, 'Order online,', 34, 140, 21, '#fff', 800);
    txt(ctx, 'collect in 15 min', 34, 166, 21, '#fff', 800);
    txt(ctx, 'Same menu as in store', 34, 188, 12, 'rgba(255,255,255,0.85)', 600);
    const cw = (W - 36 - 12) / 2;
    STORE_ITEMS.forEach((m, i) => {
      const x = 18 + (i % 2) * (cw + 12), y = 216 + Math.floor(i / 2) * 160;
      const q = qtyIn(S.cart, m.n);
      rr(ctx, x, y, cw, 148, 14); ctx.fillStyle = q ? m.c + '26' : '#151d35'; ctx.fill();
      if (q) { ctx.strokeStyle = m.c; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = m.c + '55'; rr(ctx, x + 10, y + 10, cw - 20, 66, 10); ctx.fill();
      ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(x + cw / 2, y + 43, 17, 0, Math.PI * 2); ctx.fill();
      txt(ctx, m.n, x + 12, y + 100, 14, '#e8ecf5', 700);
      txt(ctx, money(m.p), x + 12, y + 122, 13, '#9aa4b8');
      ctx.fillStyle = q ? m.c : '#26304d'; ctx.beginPath(); ctx.arc(x + cw - 22, y + 116, 14, 0, Math.PI * 2); ctx.fill();
      txt(ctx, q ? '×' + q : '+', x + cw - 22, y + 121, q ? 12 : 18, q ? '#061016' : '#e8ecf5', 800, 'center');
    });
    rr(ctx, 18, H - 72, W - 36, 52, 26);
    ctx.fillStyle = n ? '#f472b6' : '#1b2440'; ctx.fill();
    txt(ctx, n ? `Checkout · ${money(cartTotal(S.cart))}` : 'Tap + to add items', W / 2, H - 40, 16, n ? '#061016' : '#9aa4b8', 800, 'center');
    return;
  }
  if (st === 'checkout' || st === 'paying') {
    txt(ctx, 'Checkout', 22, 124, 20, '#e8ecf5', 800);
    rr(ctx, 18, 140, W - 36, 210, 16); ctx.fillStyle = '#121b30'; ctx.fill();
    S.cart.slice(0, 4).forEach((it, i) => {
      const y = 174 + i * 34;
      ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(38, y - 5, 6, 0, Math.PI * 2); ctx.fill();
      txt(ctx, `${it.q}× ${it.n}`, 52, y, 14, '#c3cad8', 600);
      txt(ctx, money(it.p * it.q), W - 34, y, 14, '#c3cad8', 600, 'right');
    });
    txt(ctx, 'Total', 34, 334, 15, '#9aa4b8', 600);
    txt(ctx, money(cartTotal(S.cart)), W - 34, 334, 19, '#e8ecf5', 800, 'right');
    const collect = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    [['Collect at', collect], ['Pay with', 'Visa •••• 4242']].forEach(([k, v], i) => {
      const y = 368 + i * 58;
      rr(ctx, 18, y, W - 36, 48, 12); ctx.fillStyle = '#121b30'; ctx.fill();
      txt(ctx, k, 34, y + 30, 13, '#9aa4b8', 600);
      txt(ctx, v, W - 34, y + 30, 14, '#e8ecf5', 700, 'right');
    });
    rr(ctx, 18, H - 80, W - 36, 56, 28); ctx.fillStyle = '#000'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (st === 'paying') { spinner(ctx, W / 2 - 58, H - 52, 10, '#fff'); txt(ctx, 'Processing…', W / 2 + 12, H - 46, 17, '#fff', 800, 'center'); }
    else txt(ctx, `Pay ${money(cartTotal(S.cart))}`, W / 2, H - 46, 18, '#fff', 800, 'center');
    return;
  }
  // confirmed / ready
  const ready = st === 'ready';
  check(ctx, W / 2, 190, 46, ready ? '#4ade80' : '#2ee6c5');
  txt(ctx, ready ? 'Ready to collect!' : 'Order confirmed', W / 2, 278, 22, '#e8ecf5', 800, 'center');
  txt(ctx, `#${S.phoneOrder?.id ?? ''} · ${money(S.phoneOrder?.total ?? 0)}`, W / 2, 304, 15, '#9aa4b8', 600, 'center');
  const steps = ['Paid', 'In the kitchen', 'Ready'];
  steps.forEach((s, i) => {
    const y = 360 + i * 54, done = i === 0 || (i === 1) || ready;
    const active = !ready && i === 1;
    ctx.fillStyle = done ? (active ? '#fbbf24' : '#4ade80') : '#26304d';
    ctx.beginPath(); ctx.arc(46, y, 10, 0, Math.PI * 2); ctx.fill();
    if (i < 2) { ctx.fillStyle = '#26304d'; ctx.fillRect(44, y + 12, 4, 30); }
    txt(ctx, s, 70, y + 5, 15, done ? '#e8ecf5' : '#6b7690', 700);
  });
  rr(ctx, 18, H - 72, W - 36, 52, 26); ctx.fillStyle = '#1b2440'; ctx.fill();
  txt(ctx, ready ? 'Show this at the counter' : 'We’ll tell you when it’s ready', W / 2, H - 40, 14, '#c3cad8', 700, 'center');
}

/* EPOS sale screen — copies the FlowPOS EPOS app (light theme, DashboardScreen.kt). */
const E = { purple: '#7C3AED', eat: '#780AEB', take: '#4CAF50', tile: '#F3E8FF', g100: '#F5F5F5', g200: '#E0E0E0', g400: '#999999', g500: '#666666', ink: '#333333', pill: '#AFAFAF', warnBg: '#FFF3E0', warn: '#E65100' };
function drawTill(ctx, W, H) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // top bar
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, 44); ctx.fillStyle = E.g200; ctx.fillRect(0, 44, W, 1.5);
  rr(ctx, 10, 8, 214, 28, 14); ctx.fillStyle = E.g100; ctx.fill();
  txt(ctx, '⌕  Search products...', 22, 27, 12, E.g400, 500);
  [['Main Till', 234, 82], ['Tables', 324, 64]].forEach(([l, x, w]) => {
    rr(ctx, x, 8, w, 28, 14); ctx.strokeStyle = E.pill; ctx.lineWidth = 1.2; ctx.stroke();
    txt(ctx, l, x + w / 2, 27, 12, E.ink, 500, 'center');
  });
  rr(ctx, W - 92, 8, 82, 28, 14); ctx.fillStyle = E.purple; ctx.fill();
  txt(ctx, '◷ Orders', W - 51, 27, 12, '#fff', 600, 'center');
  // category rail
  const rw = 118;
  ctx.fillStyle = E.g200; ctx.fillRect(rw, 45, 1.5, H - 45);
  txt(ctx, 'Categories', 10, 68, 14, E.ink, 800);
  rr(ctx, 8, 78, rw - 16, 40, 10); ctx.fillStyle = E.purple; ctx.fill();
  txt(ctx, '+ Add Misc Item', rw / 2, 103, 11, '#fff', 700, 'center');
  [['Coffee', '#2ee6c5'], ['Food', '#f472b6'], ['Bakery', '#fbbf24'], ['Drinks', '#60a5fa'], ['Sides', '#fb923c']].forEach(([l, c], i) => {
    const y = 124 + i * 46;
    rr(ctx, 8, y, rw - 16, 40, 10); ctx.fillStyle = c + '33'; ctx.fill();
    if (i === 0) { ctx.strokeStyle = E.purple; ctx.lineWidth = 2; ctx.stroke(); }
    txt(ctx, l, 18, y + 25, 12, E.ink, 700);
  });
  // product grid
  const cw = 232, gx = rw + 10, gw = W - rw - cw - 20;
  const cols = 3, gap = 5, tw = (gw - gap * (cols - 1)) / cols, th = 72;
  MENU.forEach((m, i) => {
    const x = gx + (i % cols) * (tw + gap), y = 54 + Math.floor(i / cols) * (th + gap);
    const q = qtyIn(S.posCart, m.n);
    rr(ctx, x, y, tw, th, 8); ctx.fillStyle = E.tile; ctx.fill();
    ctx.strokeStyle = q ? E.purple : E.g200; ctx.lineWidth = q ? 2.5 : 1.2; ctx.stroke();
    txt(ctx, m.n, x + 8, y + 20, 12, E.ink, 800);
    txt(ctx, money(m.p), x + 8, y + th - 20, 12, E.purple, 800);
    txt(ctx, 'inc. VAT 20%', x + 8, y + th - 8, 8, E.g500, 500);
    if (q) { ctx.fillStyle = E.purple; ctx.beginPath(); ctx.arc(x + tw - 14, y + 16, 10, 0, Math.PI * 2); ctx.fill(); txt(ctx, String(q), x + tw - 14, y + 20, 11, '#fff', 800, 'center'); }
  });
  // cart panel
  const px = W - cw;
  ctx.fillStyle = '#fff'; ctx.fillRect(px, 45, cw, H - 45);
  ctx.fillStyle = E.g200; ctx.fillRect(px, 45, 1.5, H - 45);
  let y0 = 46;
  const shown = S.pos === 'approved' && S.posOrder ? S.posOrder : null;
  if (shown || S.pos === 'charging') {
    ctx.fillStyle = E.warnBg; ctx.fillRect(px + 1.5, y0, cw, 26);
    txt(ctx, `✎ Order #${shown ? shown.id : S.nextId}`, px + 12, y0 + 18, 12, E.warn, 700);
    y0 += 26;
  }
  const lines = shown ? shown.items : S.posCart;
  if (!lines.length) txt(ctx, 'Add items to your cart', px + cw / 2, 160, 12, E.g400, 500, 'center');
  lines.slice(0, 5).forEach((it, i) => {
    const y = y0 + 12 + i * 40;
    txt(ctx, it.n, px + 12, y + 14, 12, E.ink, 700);
    txt(ctx, money(it.p * it.q), px + cw - 12, y + 14, 12, E.ink, 700, 'right');
    [['−', px + 20], ['+', px + 66]].forEach(([g, cx]) => { ctx.strokeStyle = E.g200; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, y + 27, 8, 0, Math.PI * 2); ctx.stroke(); txt(ctx, g, cx, y + 31, 11, E.purple, 700, 'center'); });
    txt(ctx, String(it.q), px + 43, y + 31, 12, E.ink, 700, 'center');
    ctx.fillStyle = E.g100; ctx.fillRect(px + 10, y + 38, cw - 20, 1);
  });
  const total = cartTotal(lines);
  const sy = H - 132;
  ctx.fillStyle = E.g200; ctx.fillRect(px + 10, sy, cw - 20, 1.2);
  [['Subtotal', total], ['Tax', total / 6]].forEach(([l, v], i) => {
    txt(ctx, l, px + 12, sy + 20 + i * 18, 11, E.g500, 500);
    txt(ctx, money(v), px + cw - 12, sy + 20 + i * 18, 11, E.g500, 500, 'right');
  });
  txt(ctx, 'Total Amount', px + 12, sy + 62, 14, E.ink, 800);
  txt(ctx, money(total), px + cw - 12, sy + 62, 14, E.ink, 800, 'right');
  const by = H - 54, bw2 = (cw - 30) / 2;
  if (S.pos === 'idle') {
    [['Eat In', E.eat, px + 10], ['Take Away', E.take, px + 20 + bw2]].forEach(([l, c, x]) => {
      rr(ctx, x, by, bw2, 42, 8); ctx.fillStyle = total ? c : E.g200; ctx.fill();
      txt(ctx, l, x + bw2 / 2, by + 26, 13, total ? '#fff' : E.g400, 600, 'center');
    });
  } else {
    rr(ctx, px + 10, by, cw - 20, 42, 8); ctx.fillStyle = S.pos === 'approved' ? E.take : E.purple; ctx.fill();
    if (S.pos === 'charging') spinner(ctx, px + 34, by + 21, 8, '#fff');
    txt(ctx, S.pos === 'approved' ? 'Paid ✓ Sent to kitchen' : 'Card payment · tap on reader', px + cw / 2 + (S.pos === 'charging' ? 10 : 0), by + 26, 12, '#fff', 700, 'center');
  }
}

function drawReader(ctx, W, H) {
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, W, H);
  if (S.pos === 'idle') {
    rr(ctx, W / 2 - 26, 70, 52, 52, 14);
    const g = ctx.createLinearGradient(W / 2 - 26, 70, W / 2 + 26, 122); g.addColorStop(0, '#2ee6c5'); g.addColorStop(1, '#8b5cf6');
    ctx.fillStyle = g; ctx.fill();
    txt(ctx, 'Ready', W / 2, 180, 22, '#9aa4b8', 700, 'center');
    return;
  }
  const amount = S.pos === 'approved' ? S.posOrder?.total ?? 0 : cartTotal(S.posCart);
  txt(ctx, money(amount), W / 2, 66, 32, '#e8ecf5', 800, 'center');
  if (S.pos === 'approved') {
    check(ctx, W / 2, 142, 34, '#4ade80');
    txt(ctx, 'Approved', W / 2, 220, 20, '#4ade80', 700, 'center');
  } else {
    const p = (now() * 1.6) % 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(46,230,197,${0.35 + 0.65 * (1 - Math.abs(p - i / 3))})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(W / 2 - 30, 145, 18 + i * 16, -0.8, 0.8); ctx.stroke();
    }
    txt(ctx, 'Tap to pay', W / 2, 220, 20, '#e8ecf5', 700, 'center');
  }
}

function drawKds(ctx, W, H) {
  ctx.fillStyle = '#0a0f1c'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#121b30'; ctx.fillRect(0, 0, W, 54);
  txt(ctx, 'Kitchen display', 22, 36, 22, '#e8ecf5', 800);
  txt(ctx, `${S.tickets.filter((t) => !t.ready).length} open`, W - 22, 36, 18, '#2ee6c5', 700, 'right');
  const cols = 4, gap = 14, tw = (W - gap * (cols + 1)) / cols, t = now();
  S.tickets.slice(0, 4).forEach((o, i) => {
    const x = gap + i * (tw + gap), y = 70, th = H - 86;
    const age = t - o.born;
    const col = o.ready ? '#4ade80' : age < 60 ? '#2ee6c5' : age < 150 ? '#fbbf24' : '#f87171';
    rr(ctx, x, y, tw, th, 14); ctx.fillStyle = o.mine ? '#1f1530' : '#121b30'; ctx.fill();
    if (o.mine || age < 1.5) { ctx.strokeStyle = o.mine ? '#f472b6' : '#2ee6c5'; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.save(); rr(ctx, x, y, tw, 58, 14); ctx.clip();
    ctx.fillStyle = col; ctx.fillRect(x, y, tw, 58); ctx.restore();
    txt(ctx, `#${o.id}`, x + 14, y + 37, 22, '#061016', 800);
    const mm = String(Math.floor(age / 60)).padStart(2, '0'), ss = String(Math.floor(age % 60)).padStart(2, '0');
    txt(ctx, o.ready ? 'READY' : `${mm}:${ss}`, x + tw - 14, y + 37, 20, '#061016', 800, 'right');
    txt(ctx, o.source === 'EPOS' ? (o.mode ? `EPOS · ${o.mode}` : `EPOS · Table ${o.table}`) : o.source, x + 14, y + 90, 16, '#9aa4b8', 700);
    if (o.mine) {
      rr(ctx, x + tw - 104, y + 72, 90, 26, 13); ctx.fillStyle = '#f472b6'; ctx.fill();
      txt(ctx, 'YOURS', x + tw - 59, y + 90, 13, '#061016', 800, 'center');
    }
    o.items.slice(0, 4).forEach((it, j) => txt(ctx, `${it.q}× ${it.n}`, x + 14, y + 132 + j * 36, 20, '#e8ecf5', 700));
    rr(ctx, x + 14, y + th - 58, tw - 28, 42, 10);
    if (o.ready) { ctx.fillStyle = '#4ade80'; ctx.fill(); } else { ctx.strokeStyle = '#22304d'; ctx.lineWidth = 2; ctx.stroke(); }
    txt(ctx, o.ready ? 'Done ✓' : 'Bump', x + tw / 2, y + th - 31, 16, o.ready ? '#061016' : '#9aa4b8', 700, 'center');
  });
}

function drawKiosk(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#141a33'); g.addColorStop(1, '#0a0f1c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (S.kiosk === 'placed') {
    check(ctx, W / 2, 230, 60, '#4ade80');
    txt(ctx, 'Order placed!', W / 2, 340, 30, '#e8ecf5', 800, 'center');
    txt(ctx, 'Your number', W / 2, 400, 18, '#9aa4b8', 600, 'center');
    txt(ctx, String((S.kioskOrder?.id ?? 63) % 100), W / 2, 490, 84, '#fbbf24', 800, 'center');
    txt(ctx, 'Watch the screen for your number', W / 2, H - 60, 16, '#9aa4b8', 600, 'center');
    return;
  }
  txt(ctx, 'Hello!', 24, 58, 32, '#e8ecf5', 800);
  txt(ctx, 'What can we get you?', 24, 88, 18, '#9aa4b8');
  const tw = (W - 24 * 2 - 14) / 2, th = 170;
  KIOSK_ITEMS.forEach((m, i) => {
    const x = 24 + (i % 2) * (tw + 14), y = 116 + Math.floor(i / 2) * (th + 14);
    const q = qtyIn(S.kioskCart, m.n);
    rr(ctx, x, y, tw, th, 16); ctx.fillStyle = q ? m.c + '2e' : '#18213b'; ctx.fill();
    if (q) { ctx.strokeStyle = m.c; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.fillStyle = m.c + '55'; ctx.beginPath(); ctx.arc(x + tw / 2, y + 62, 40, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(x + tw / 2, y + 62, 22, 0, Math.PI * 2); ctx.fill();
    txt(ctx, m.n, x + 14, y + th - 36, 17, '#e8ecf5', 700);
    txt(ctx, money(m.p), x + 14, y + th - 14, 15, '#9aa4b8');
    if (q) txt(ctx, '×' + q, x + tw - 14, y + 30, 18, '#e8ecf5', 800, 'right');
  });
  const n = cartCount(S.kioskCart);
  rr(ctx, 24, H - 84, W - 48, 60, 30);
  ctx.fillStyle = n ? '#fbbf24' : '#1b2440'; ctx.fill();
  txt(ctx, n ? `Pay · ${n} item${n > 1 ? 's' : ''} · ${money(cartTotal(S.kioskCart))}` : 'Tap an item to start', W / 2, H - 47, 18, n ? '#061016' : '#9aa4b8', 800, 'center');
}

function drawPaylink(ctx, W, H) {
  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#121b30'; ctx.fillRect(0, 0, W, 44);
  txt(ctx, 'Inbox', 20, 29, 17, '#e8ecf5', 800);
  const st = S.linkState;
  if (st === 'none' || st === 'sending') {
    txt(ctx, st === 'sending' ? 'Receiving…' : 'Up to date', W - 20, 29, 13, '#9aa4b8', 600, 'right');
    [['Bean & Co', 'Your receipt #1049'], ['Bean & Co', 'Thanks for visiting!']].forEach(([a, b], i) => {
      const y = 62 + i * 76;
      rr(ctx, 16, y, W - 32, 64, 12); ctx.fillStyle = '#111827'; ctx.fill();
      txt(ctx, a, 32, y + 28, 14, '#9aa4b8', 700);
      txt(ctx, b, 32, y + 48, 13, '#6b7690', 600);
    });
    if (st === 'sending') spinner(ctx, W / 2, 300, 18, '#60a5fa');
    else txt(ctx, 'No payment requests', W / 2, 300, 15, '#6b7690', 600, 'center');
    return;
  }
  txt(ctx, st === 'paid' ? 'Paid' : '1 new', W - 20, 29, 14, st === 'paid' ? '#4ade80' : '#60a5fa', 700, 'right');
  const x = 18, y = 60, w = W - 36, h = H - 78;
  rr(ctx, x, y, w, h, 16); ctx.fillStyle = '#121b30'; ctx.fill();
  ctx.strokeStyle = st === 'paid' ? '#4ade80' : '#60a5fa'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(x + 32, y + 34, 16, 0, Math.PI * 2); ctx.fill();
  txt(ctx, 'B', x + 32, y + 40, 16, '#061016', 800, 'center');
  txt(ctx, 'Bean & Co', x + 58, y + 30, 16, '#e8ecf5', 800);
  txt(ctx, 'Payment request · ' + S.link.id, x + 58, y + 50, 13, '#9aa4b8');
  txt(ctx, 'AMOUNT', x + w / 2, y + 100, 12, '#9aa4b8', 700, 'center');
  txt(ctx, money(S.link.total), x + w / 2, y + 148, 44, '#e8ecf5', 800, 'center');
  txt(ctx, S.link.desc, x + w / 2, y + 178, 15, '#c3cad8', 600, 'center');
  if (st === 'paid') {
    check(ctx, x + w / 2, y + h - 110, 26, '#4ade80');
    txt(ctx, 'Paid · thank you!', x + w / 2, y + h - 52, 17, '#4ade80', 800, 'center');
  } else {
    rr(ctx, x + 24, y + h - 92, w - 48, 50, 25); ctx.fillStyle = '#60a5fa'; ctx.fill();
    txt(ctx, st === 'paying' ? 'Paying…' : 'Pay Now', x + w / 2, y + h - 60, 18, '#061016', 800, 'center');
  }
  txt(ctx, 'Secure one-off payment link', x + w / 2, y + h - 16, 12, '#9aa4b8', 600, 'center');
}

/* Tenant dashboard look (dark theme): same tokens as the FlowPOS tenant dashboard. */
const T = {
  bg: '#0D0D0F', card: '#131315', lift: '#1C1C1F', line: '#212124', line2: '#2C2C30',
  ink: '#F0F0F3', sec: '#B2B2B8', ter: '#97979F',
  purple: '#7628EB', ptext: '#B598E1', s1: '#A07DD4', s2: '#69B0BF', s3: '#7E9CCE', ok: '#64C4A4',
};
const tCard = (ctx, x, y, w, h) => { rr(ctx, x, y, w, h, 12); ctx.fillStyle = T.card; ctx.fill(); ctx.strokeStyle = T.line; ctx.lineWidth = 1.5; ctx.stroke(); };
function tIcon(ctx, x, y, color) { rr(ctx, x, y, 13, 13, 3.5); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke(); }
function tSidebar(ctx, H, active, w = 196) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
  ctx.fillStyle = T.line; ctx.fillRect(w - 1.5, 0, 1.5, H);
  rr(ctx, 16, 18, 30, 30, 8); ctx.fillStyle = T.purple; ctx.fill();
  txt(ctx, 'B', 31, 39, 15, '#fff', 700, 'center');
  txt(ctx, 'Bean & Co', 56, 31, 14, T.ink, 600);
  txt(ctx, 'Owner · 2 locations', 56, 46, 11, T.ter, 500);
  const nav = [[null, ['Home']], ['SALES', ['Orders', 'Customers', 'Payments']], ['MONEY', ['Subscriptions', 'Payment links', 'Payouts']],
    ['ONLINE STORE', ['Store', 'Analytics']], ['POINT OF SALE', ['Overview', 'Employees']]];
  let y = 78;
  nav.forEach(([label, items]) => {
    if (label) { y += 10; txt(ctx, label, 22, y + 10, 10, T.ter, 600); y += 20; }
    items.forEach((it) => {
      const on = it === active;
      if (on) { rr(ctx, 10, y, w - 20, 26, 7); ctx.fillStyle = 'rgba(118,40,235,0.18)'; ctx.fill(); }
      tIcon(ctx, 20, y + 6.5, on ? T.ptext : T.sec);
      txt(ctx, it, 42, y + 18, 13, on ? T.ptext : T.ink, on ? 600 : 500);
      y += 28;
    });
  });
}

function drawSubs(ctx, W, H) {
  FONT = 'Inter';
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  txt(ctx, 'Subscriptions', 22, 42, 22, T.ink, 600);
  rr(ctx, W - 134, 20, 112, 32, 8); ctx.fillStyle = T.purple; ctx.fill();
  txt(ctx, '+ New plan', W - 78, 41, 13, '#fff', 600, 'center');
  const mrr = S.subs.members * 15;
  const kw = (W - 44 - 12) / 2;
  [['Active subscribers', String(S.subs.members)], ['Monthly recurring', '£' + mrr.toLocaleString('en-GB')]].forEach(([k, v], i) => {
    const x = 22 + i * (kw + 12);
    tCard(ctx, x, 66, kw, 78);
    txt(ctx, k, x + 16, 92, 13, T.ter, 500);
    txt(ctx, v, x + 16, 128, 26, T.ink, 600);
  });
  const ty = 158, th = H - ty - 16;
  tCard(ctx, 22, ty, W - 44, th);
  const cols = [38, 190, 340, W - 40];
  ['CUSTOMER', 'PLAN', 'NEXT PAYMENT', 'STATUS'].forEach((c, i) => txt(ctx, c, cols[i], ty + 26, 10, T.ter, 600, i === 3 ? 'right' : 'left'));
  ctx.fillStyle = T.line; ctx.fillRect(22, ty + 38, W - 44, 1.5);
  const fresh = now() < S.subs.renewedAt;
  const rows = [];
  const mine = S.subs.mine;
  if (mine) rows.push({ who: 'You', plan: mine.plan, total: mine.total, period: mine.period, next: mine.next, mine: true });
  rows.push(...S.subs.feed);
  rows.slice(0, 4).forEach((r, i) => {
    const y = ty + 40 + i * 52;
    if (r.mine) { ctx.fillStyle = 'rgba(118,40,235,0.12)'; ctx.fillRect(23, y, W - 46, 51); ctx.fillStyle = T.purple; ctx.fillRect(23, y, 3, 51); }
    txt(ctx, r.who, cols[0], y + 22, 14, T.ink, 600);
    txt(ctx, r.mine ? 'tour demo' : 'card •••• ' + (4100 + i * 37), cols[0], y + 40, 11, T.ter, 500);
    txt(ctx, r.plan, cols[1], y + 22, 13, T.ink, 500);
    txt(ctx, `${money(r.total)} / ${r.period}`, cols[1], y + 40, 11, T.ter, 500);
    txt(ctx, fmtDate(r.next), cols[2], y + 31, 13, T.sec, 500);
    const renewed = r.mine && fresh;
    const label = renewed ? 'Renewed' : 'Active';
    ctx.font = `600 11px ${FONT}`; const pw = ctx.measureText(label).width + 20;
    rr(ctx, cols[3] - pw, y + 16, pw, 22, 11); ctx.fillStyle = renewed ? 'rgba(118,40,235,0.25)' : 'rgba(100,196,164,0.15)'; ctx.fill();
    txt(ctx, label, cols[3] - pw / 2, y + 31, 11, renewed ? T.ptext : T.ok, 600, 'center');
    if (i < 3) { ctx.fillStyle = T.line; ctx.fillRect(22, y + 51, W - 44, 1); }
  });
  FONT = 'Manrope';
}

const WEEK = { epos: [42, 38, 51, 47, 55, 61], online: [12, 15, 11, 18, 16, 20], manual: [3, 2, 4, 3, 5, 4] };
function drawDashboard(ctx, W, H) {
  FONT = 'Inter';
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  tSidebar(ctx, H, 'Home');
  const mx = 220, mw = W - mx - 22;
  txt(ctx, 'Home', mx, 50, 24, T.ink, 600);
  rr(ctx, W - 22 - 128, 26, 128, 34, 8); ctx.fillStyle = T.purple; ctx.fill();
  txt(ctx, 'Payment link', W - 22 - 64, 48, 13, '#fff', 600, 'center');
  rr(ctx, W - 22 - 128 - 10 - 108, 26, 108, 34, 8); ctx.fillStyle = T.lift; ctx.fill(); ctx.strokeStyle = T.line2; ctx.lineWidth = 1.5; ctx.stroke();
  txt(ctx, '+ New order', W - 22 - 128 - 10 - 54, 48, 13, T.ink, 600, 'center');

  // headline figures
  const my = 76, mh = 110, split = mx + mw * 0.6;
  tCard(ctx, mx, my, mw, mh);
  txt(ctx, 'Today’s revenue', mx + 20, my + 30, 13, T.ter, 500);
  txt(ctx, 'Yesterday £3,105.20', split - 20, my + 30, 13, T.ter, 500, 'right');
  txt(ctx, money(S.sales), mx + 20, my + 72, 32, T.ink, 600);
  if (S.demo.count) {
    const label = `+${money(S.demo.total)} from your tour`;
    ctx.font = `600 12px ${FONT}`; const pw = ctx.measureText(label).width + 22;
    rr(ctx, mx + 20, my + 82, pw, 22, 11); ctx.fillStyle = 'rgba(118,40,235,0.22)'; ctx.fill();
    txt(ctx, label, mx + 20 + pw / 2, my + 97, 12, T.ptext, 600, 'center');
  } else txt(ctx, `${S.orders} orders today`, mx + 20, my + 96, 13, T.ter, 500);
  ctx.fillStyle = T.line; ctx.fillRect(split, my + 16, 1.5, mh - 32);
  txt(ctx, 'Balance', split + 20, my + 30, 13, T.ter, 500);
  txt(ctx, money(1240.55 + (S.sales - 3482.5) * 0.97), split + 20, my + 72, 32, T.ink, 600);
  txt(ctx, 'Payouts →', split + 20, my + 96, 13, T.ptext, 600);

  // range bar
  const ry = 200;
  rr(ctx, mx, ry, 132, 32, 8); ctx.fillStyle = T.lift; ctx.fill(); ctx.strokeStyle = T.line2; ctx.lineWidth = 1.5; ctx.stroke();
  txt(ctx, 'Last 7 days  ▾', mx + 14, ry + 21, 13, T.ink, 500);
  txt(ctx, '↻ Refresh', W - 22, ry + 21, 13, T.ter, 500, 'right');

  // cards
  const gy = ry + 46, gh = H - gy - 20, gap = 14, cw = (mw - gap * 2) / 3;
  const cardHead = (x, title, link) => {
    txt(ctx, title, x + 18, gy + 30, 15, T.ink, 600);
    if (link) txt(ctx, link, x + cw - 18, gy + 30, 12, T.ptext, 600, 'right');
  };
  // Overall sales
  let x = mx;
  tCard(ctx, x, gy, cw, gh); cardHead(x, 'Overall sales');
  txt(ctx, money(S.sales * 5.8), x + 18, gy + 66, 22, T.ink, 600);
  const pts = S.chart.slice(-24), max = Math.max(...pts) * 1.1, min = Math.min(...pts) * 0.75;
  const cx0 = x + 18, cx1 = x + cw - 18, cy0 = gy + 90, cy1 = gy + gh - 40;
  for (let i = 0; i < 4; i++) { ctx.fillStyle = T.line; ctx.fillRect(cx0, cy0 + ((cy1 - cy0) * i) / 3, cx1 - cx0, 1); }
  const px = (i) => cx0 + (i / (pts.length - 1)) * (cx1 - cx0);
  const py = (v) => cy1 - ((v - min) / (max - min)) * (cy1 - cy0);
  const grad = ctx.createLinearGradient(0, cy0, 0, cy1);
  grad.addColorStop(0, 'rgba(160,125,212,0.35)'); grad.addColorStop(1, 'rgba(160,125,212,0)');
  ctx.beginPath(); ctx.moveTo(px(0), cy1); pts.forEach((v, i) => ctx.lineTo(px(i), py(v))); ctx.lineTo(px(pts.length - 1), cy1); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.strokeStyle = T.s1; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = T.s1; ctx.beginPath(); ctx.arc(px(pts.length - 1), py(pts[pts.length - 1]), 5, 0, Math.PI * 2); ctx.fill();
  ['00:00', '12:00', 'Now'].forEach((l, i) => txt(ctx, l, cx0 + ((cx1 - cx0) * i) / 2, gy + gh - 16, 11, T.ter, 500, ['left', 'center', 'right'][i]));

  // Orders (stacked bars)
  x = mx + cw + gap;
  tCard(ctx, x, gy, cw, gh); cardHead(x, 'Orders', 'All orders →');
  const today = { epos: S.channels.POS + S.channels.Kiosk - 100, online: S.channels.Online - 8, manual: 4 };
  const days = [...WEEK.epos.map((e, i) => ({ epos: e, online: WEEK.online[i], manual: WEEK.manual[i] })), today];
  const total = days.reduce((a, d) => a + d.epos + d.online + d.manual, 0);
  txt(ctx, String(total), x + 18, gy + 66, 22, T.ink, 600);
  const bmax = Math.max(...days.map((d) => d.epos + d.online + d.manual)) * 1.1;
  const bx0 = x + 22, bw = (cw - 44) / days.length, by1 = gy + gh - 56, bh = by1 - (gy + 92);
  days.forEach((d, i) => {
    let y = by1;
    [['epos', T.s1], ['online', T.s2], ['manual', T.s3]].forEach(([k, col]) => {
      const h = (d[k] / bmax) * bh;
      ctx.fillStyle = col; ctx.globalAlpha = i === days.length - 1 ? 1 : 0.75;
      rr(ctx, bx0 + i * bw + bw * 0.18, y - h, bw * 0.64, Math.max(2, h - 2), 3); ctx.fill();
      y -= h;
    });
    ctx.globalAlpha = 1;
    txt(ctx, ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], bx0 + i * bw + bw / 2, by1 + 18, 11, i === days.length - 1 ? T.ink : T.ter, 500, 'center');
  });
  [['EPOS', T.s1], ['Online', T.s2], ['Manual', T.s3]].forEach(([l, col], i) => {
    const lx = x + 18 + i * 76;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx + 4, gy + gh - 18, 4, 0, Math.PI * 2); ctx.fill();
    txt(ctx, l, lx + 13, gy + gh - 14, 11, T.sec, 500);
  });

  // Payment source
  x = mx + (cw + gap) * 2;
  tCard(ctx, x, gy, cw, gh); cardHead(x, 'Payment source', 'Payments →');
  const src = [['Card reader', S.channels.POS + S.channels.Kiosk], ['Online checkout', S.channels.Online], ['Payment links', S.channels.Links], ['Subscriptions', S.channels.Subs]];
  const sum = src.reduce((a, [, v]) => a + v, 0);
  src.forEach(([l, v], i) => {
    const y = gy + 72 + i * ((gh - 96) / 4);
    txt(ctx, l, x + 18, y, 13, T.sec, 500);
    txt(ctx, `${Math.round((v / sum) * 100)}%`, x + cw - 18, y, 13, T.ink, 600, 'right');
    rr(ctx, x + 18, y + 12, cw - 36, 8, 4); ctx.fillStyle = T.lift; ctx.fill();
    rr(ctx, x + 18, y + 12, Math.max(8, (cw - 36) * (v / sum)), 8, 4); ctx.fillStyle = [T.s1, T.s2, T.s3, T.ok][i]; ctx.fill();
  });
  FONT = 'Manrope';
}

/* ---------- Device builders (front faces +Z) ---------- */
function buildTill() {
  const g = new THREE.Group();
  const counter = box(3.2, 1.0, 1.4, C.body2, 0.25); counter.position.y = 0.5; g.add(counter);
  const stand = cyl(0.1, 0.4); stand.position.set(-0.35, 1.2, -0.1); g.add(stand);
  const head = new THREE.Group(); head.position.set(-0.35, 1.95, 0); head.rotation.x = -0.18; g.add(head);
  head.add(box(1.82, 1.18, 0.08));
  const s = makeScreen(1.7, 1.06, 820, drawTill);
  s.mesh.position.z = 0.045; head.add(s.mesh);
  const reader = new THREE.Group(); reader.position.set(1.15, 1.32, 0.25); reader.rotation.set(-0.35, -0.35, 0); g.add(reader);
  reader.add(box(0.42, 0.66, 0.07, 0x10141f, 0.5));
  const rs = makeScreen(0.34, 0.42, 240, drawReader);
  rs.mesh.position.set(0, 0.08, 0.04); reader.add(rs.mesh);
  return { group: g, anchorY: 2.7, frame: { cy: 1.65, w: 1.75, h: 1.0 } };
}
function buildKds() {
  const g = new THREE.Group();
  const base = cyl(0.55, 0.06); base.position.y = 0.03; g.add(base);
  const pole = cyl(0.06, 2.1); pole.position.y = 1.08; g.add(pole);
  g.add(place(box(2.72, 1.66, 0.1), 0, 2.75, 0));
  const s = makeScreen(2.6, 1.56, 1000, drawKds);
  s.mesh.position.set(0, 2.75, 0.055); g.add(s.mesh);
  return { group: g, anchorY: 3.6, frame: { cy: 2.6, w: 1.45, h: 1.0 } };
}
function buildKiosk() {
  const g = new THREE.Group();
  g.add(place(box(1.3, 0.1, 0.8, C.body2), 0, 0.05, 0));
  g.add(place(box(1.18, 3.0, 0.26), 0, 1.6, 0));
  const s = makeScreen(1.0, 1.75, 420, drawKiosk);
  s.mesh.position.set(0, 2.15, 0.135); g.add(s.mesh);
  const pay = box(0.3, 0.2, 0.12, 0x10141f, 0.6); pay.position.set(0.32, 0.9, 0.18); g.add(pay);
  const slot = box(0.5, 0.05, 0.04, 0x05070d, 0.5); slot.position.set(-0.2, 0.9, 0.14); g.add(slot);
  return { group: g, anchorY: 3.4, frame: { cy: 2.0, w: 0.75, h: 1.2 } };
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
  const s = makeScreen(1.8, 1.1, 1100, drawDashboard);
  s.mesh.position.set(0, 0.6, 0.025); hinge.add(s.mesh);
  return { group: g, anchorY: 2.5, frame: { cy: 1.5, w: 1.1, h: 0.75 } };
}
function buildStore() {
  const g = new THREE.Group();
  const plinth = cyl(0.55, 0.9, C.body2); plinth.position.y = 0.45; g.add(plinth);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: hot(C.pink, 2.2) }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.9; g.add(ring);
  const phone = new THREE.Group(); phone.position.set(0, 1.62, 0); phone.rotation.x = -0.12; g.add(phone);
  phone.add(box(0.64, 1.26, 0.06, 0x10141f, 0.5));
  const s = makeScreen(0.58, 1.18, 330, drawStore);
  s.mesh.position.z = 0.032; phone.add(s.mesh);
  return {
    group: g, anchorY: 2.4, frame: { cy: 1.62, w: 0.5, h: 0.72 },
    tick(t) { phone.position.y = 1.62 + Math.sin(t * 1.4) * 0.04; },
  };
}
function buildPaylink() {
  const g = new THREE.Group();
  const ped = box(1.1, 1.0, 0.8, C.body2, 0.25); ped.position.y = 0.5; g.add(ped);
  const tab = new THREE.Group(); tab.position.set(0, 1.68, 0); tab.rotation.x = -0.14; g.add(tab);
  tab.add(box(0.98, 1.32, 0.05, 0x10141f, 0.5));
  const s = makeScreen(0.9, 1.24, 360, drawPaylink);
  s.mesh.position.z = 0.027; tab.add(s.mesh);
  const env = new THREE.Group(); env.position.set(0, 2.95, 0); g.add(env);
  env.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.52, 0.03), new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.4, metalness: 0.5 })));
  const pts = [[-0.4, 0.26], [0, -0.04], [0, -0.04], [0.4, 0.26], [-0.4, 0.26], [0.4, 0.26], [0.4, 0.26], [0.4, -0.26], [0.4, -0.26], [-0.4, -0.26], [-0.4, -0.26], [-0.4, 0.26]]
    .map(([x, y]) => new THREE.Vector3(x, y, 0.02));
  env.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: hot(C.sky, 2) })));
  env.add(glowSprite(C.sky, 1.6, 0.3));
  return {
    group: g, anchorY: 3.4, frame: { cy: 2.1, w: 0.62, h: 1.25 },
    tick(t) { env.position.y = 2.95 + Math.sin(t * 1.2) * 0.08; env.rotation.y = Math.sin(t * 0.7) * 0.4; },
  };
}
function buildSubs() {
  const g = new THREE.Group();
  const ped = cyl(0.6, 1.0, C.body2); ped.position.y = 0.5; g.add(ped);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: hot(C.green, 2) }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.0; g.add(rim);
  const tab = new THREE.Group(); tab.position.set(0, 1.85, 0); tab.rotation.x = -0.1; g.add(tab);
  tab.add(box(1.5, 1.24, 0.05, 0x10141f, 0.5));
  const s = makeScreen(1.42, 1.16, 640, drawSubs);
  s.mesh.position.z = 0.027; tab.add(s.mesh);
  const loop = new THREE.Group(); loop.position.set(0, 1.85, -0.05); g.add(loop);
  loop.add(new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: hot(C.green, 1.8), transparent: true, opacity: 0.7 })));
  const dot = new THREE.Group(); dot.add(glowSprite(C.green, 0.5, 1, 2.4)); loop.add(dot);
  const card = new THREE.Group(); card.position.set(0, 3.1, 0); g.add(card);
  const cardGeo = new THREE.BoxGeometry(0.8, 0.5, 0.02);
  card.add(new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ color: 0x12301f, roughness: 0.3, metalness: 0.7 })));
  card.add(new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), new THREE.LineBasicMaterial({ color: hot(C.green, 2) })));
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.03), new THREE.MeshBasicMaterial({ color: C.amber }));
  chip.position.set(-0.24, 0.05, 0); card.add(chip);
  let spin = 0;
  return {
    group: g, anchorY: 3.5, frame: { cy: 2.05, w: 1.2, h: 1.3 },
    boost() { spin = 1; },
    tick(t, dt) {
      spin = Math.max(0, spin - dt * 0.6);
      const a = t * (0.9 + spin * 6);
      dot.position.set(Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0);
      card.rotation.y += dt * (0.8 + spin * 8);
      card.position.y = 3.1 + Math.sin(t * 1.1) * 0.06;
    },
  };
}

/* ---------- World layout: ring of devices in tour order ---------- */
const R = 8.8;
const devices = {};
const LAYOUT = [
  ['store', buildStore, -75, 'ONLINE STORE'],
  ['kds', buildKds, -50, 'KITCHEN'],
  ['till', buildTill, -25, 'EPOS + READER'],
  ['kiosk', buildKiosk, 0, 'KIOSK'],
  ['paylink', buildPaylink, 25, 'PAYMENT LINKS'],
  ['subs', buildSubs, 50, 'SUBSCRIPTIONS'],
  ['dashboard', buildDashboard, 75, 'DASHBOARD'],
];
function flowTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 4;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(0.75, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(6, 1);
  return t;
}
const FLOW = flowTexture();
const ringGeo = new THREE.RingGeometry(1.5, 1.56, 72);
const pickables = [];
LAYOUT.forEach(([name, build, deg, label]) => {
  edgeBucket = [];
  const d = build();
  const edges = edgeBucket;
  edgeBucket = null;
  const a = THREE.MathUtils.degToRad(deg);
  d.group.position.set(R * Math.sin(a), 0, HUB.z + R * Math.cos(a));
  d.group.rotation.y = Math.atan2(Math.sin(a) * 0.55, Math.cos(a) + 0.7);
  d.group.userData.device = name;
  scene.add(d.group);
  pickables.push(d.group);

  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hot(C.teal, 1.3), transparent: true, opacity: 0.45 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(d.group.position.x, 0.02, d.group.position.z);
  scene.add(ring);

  d.group.updateMatrixWorld(true);
  const start = new THREE.Vector3(0, d.anchorY, 0).applyMatrix4(d.group.matrixWorld);
  const mid = start.clone().lerp(HUB, 0.5).add(new THREE.Vector3(0, 2.6, 0));
  const curve = new THREE.QuadraticBezierCurve3(start, mid, HUB.clone());
  const tubeGeo = new THREE.TubeGeometry(curve, 80, 0.016, 6, false);
  const tubeMat = new THREE.MeshBasicMaterial({ color: hot(C.teal, 1), transparent: true, opacity: 0.16, depthWrite: false });
  scene.add(new THREE.Mesh(tubeGeo, tubeMat));
  const flowMat = new THREE.MeshBasicMaterial({ color: hot(C.teal, 2.2), map: FLOW, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.03, 6, false), flowMat));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: hot(C.teal, 2) }));
  cap.position.copy(start); scene.add(cap);

  // floating label (shown on the overview)
  const lc = document.createElement('canvas'); lc.width = 512; lc.height = 80;
  const lctx = lc.getContext('2d');
  const drawLabel = () => {
    lctx.clearRect(0, 0, 512, 80);
    lctx.font = '600 34px "JetBrains Mono", monospace'; lctx.textAlign = 'center'; lctx.fillStyle = '#e8ecf5';
    lctx.fillText(label, 256, 52);
  };
  drawLabel();
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, opacity: 0, color: 0xcfd6e6 }));
  tag.scale.set(2.4, 0.375, 1);
  tag.position.copy(start).add(new THREE.Vector3(0, 0.55, 0));
  tag.userData.redraw = () => { drawLabel(); lt.needsUpdate = true; };
  scene.add(tag);

  devices[name] = { ...d, edges, ring, tubeMat, flowMat, curve, tag, flash: 0 };
});

/* ---------- Hub ---------- */
const hub = new THREE.Group(); hub.position.copy(HUB); scene.add(hub);
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.42, 1),
  new THREE.MeshStandardMaterial({ color: 0x1a1240, emissive: C.purple, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.4, flatShading: true })
);
hub.add(core);
const shell = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.15, 1)),
  new THREE.LineBasicMaterial({ color: hot(C.teal, 2), transparent: true, opacity: 0.8 })
);
hub.add(shell);
const rings = [0, 1, 2].map((i) => {
  const r = new THREE.Mesh(
    new THREE.TorusGeometry(1.6 + i * 0.35, 0.012, 8, 128),
    new THREE.MeshBasicMaterial({ color: hot(i === 1 ? C.purple : C.teal, 2.2), transparent: true, opacity: 0.6 })
  );
  r.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.6, 0);
  hub.add(r);
  return r;
});
const hubGlow = glowSprite(C.purple, 6, 0.45, 1); hub.add(hubGlow);
// the Flow mark, glowing at the heart of the cloud
function flowMarkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 256, 256, 0);
  g.addColorStop(0, '#7728EB'); g.addColorStop(1, '#E876E1');
  rr(ctx, 0, 0, 256, 256, 56); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#fff';
  [[13.2, 76.9], [40.5, 47.8], [67.8, 33.4]].forEach(([y, w]) => { rr(ctx, 29.4, y * 2.56, w * 2.56, 48, 24); ctx.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: flowMarkTexture(), color: 0xffffff, transparent: true, depthWrite: false }));
mark.scale.setScalar(1.05);
mark.renderOrder = 2;
hub.add(mark);
hub.add(glowSprite(C.teal, 2.6, 0.5, 1.2));
// light column under the hub
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, HUB.y, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: t, color: hot(C.purple, 0.7), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.set(HUB.x, HUB.y / 2, HUB.z);
  t.rotation = Math.PI; t.center.set(0.5, 0.5);
  scene.add(beam);
  const pad = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), new THREE.MeshBasicMaterial({ color: hot(C.purple, 2), transparent: true, opacity: 0.6 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(HUB.x, 0.02, HUB.z); scene.add(pad);
}
{
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  const draw = () => { ctx.clearRect(0, 0, 512, 96); ctx.font = '600 40px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#e8ecf5'; ctx.fillText('FLOWPOS CLOUD', 256, 60); };
  draw();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.8 }));
  label.scale.set(2.6, 0.49, 1); label.position.y = -2.1;
  hub.add(label);
  document.fonts?.ready.then(() => { draw(); t.needsUpdate = true; Object.values(devices).forEach((d) => d.tag.userData.redraw()); });
}
let hubPulse = 0;

/* ---------- Floor ---------- */
if (GL && !LITE) {
  const mirror = new Reflector(new THREE.PlaneGeometry(120, 120), {
    clipBias: 0.003,
    textureWidth: Math.floor(innerWidth * 0.5),
    textureHeight: Math.floor(innerHeight * 0.5),
    color: 0x8890a0,
  });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const dim = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: C.bg, transparent: true, opacity: 0.8, depthWrite: false }));
  dim.rotation.x = -Math.PI / 2; dim.position.y = 0.004;
  scene.add(dim);
} else {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.6, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
}
const grid = new THREE.GridHelper(120, 120, 0x1d6b63, 0x162038);
grid.material.transparent = true; grid.material.opacity = 0.32; grid.position.y = 0.008;
scene.add(grid);

const DUST = LITE ? 350 : 800;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 44;
  dustPos[i * 3 + 1] = Math.random() * 14;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 44 - 1;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x7dd3fc, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
})));

/* ---------- Ripples (when something lands on a device) ---------- */
const ripples = [];
const rippleGeo = new THREE.RingGeometry(0.92, 1, 64);
function ripple(name, color) {
  const d = devices[name];
  const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: hot(color, 2), transparent: true, opacity: 1, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(d.group.position.x, 0.03, d.group.position.z);
  scene.add(m);
  ripples.push({ m, t: 0 });
}

/* ---------- Packets: glowing orders/payments on the curves ---------- */
const packets = [];
function spawnPacket(name, toHub, color, onArrive) {
  if (!GL) { setTimeout(() => onArrive?.(), 500); return; }
  const group = new THREE.Group();
  const head = glowSprite(color, 0.85, 1, 2.6);
  const trail = Array.from({ length: 12 }, (_, i) => glowSprite(color, 0.55 - i * 0.035, 0.7 - i * 0.055, 2));
  group.add(head, ...trail);
  scene.add(group);
  packets.push({ curve: devices[name].curve, name, toHub, color, t: 0, speed: 0.62, head, trail, group, onArrive });
}
function updatePackets(dt) {
  for (let i = packets.length - 1; i >= 0; i--) {
    const p = packets[i];
    p.t = Math.min(1, p.t + dt * p.speed);
    const u = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
    const at = (v) => p.curve.getPoint(p.toHub ? v : 1 - v);
    p.head.position.copy(at(u));
    p.trail.forEach((s, j) => s.position.copy(at(Math.max(0, u - (j + 1) * 0.014))));
    if (p.t >= 1) {
      scene.remove(p.group);
      p.group.children.forEach((s) => s.material.dispose());
      packets.splice(i, 1);
      if (!p.toHub) ripple(p.name, p.color);
      p.onArrive?.();
    }
  }
}

/* ---------- Flows ---------- */
const feed = document.getElementById('feed');
function pushFeed(label, source, total, mine) {
  const li = document.createElement('li');
  if (mine) li.className = 'mine';
  li.innerHTML = `<span><b>${esc(label)}</b> · ${esc(source)}</span><em>${money(total)}</em>`;
  feed.prepend(li);
  while (feed.children.length > 5) feed.lastChild.remove();
}
function addTicket(o) {
  S.tickets.push(o);
  while (S.tickets.length > 4) {
    const i = S.tickets.findIndex((t) => !t.mine);
    S.tickets.splice(i >= 0 ? i : 0, 1);
  }
}
function toDashboard(name, color, p) {
  spawnPacket('dashboard', false, color, () => {
    S.sales += p.total;
    if (p.kind === 'order') S.orders += 1;
    S.channels[p.channel] += 1;
    const last = S.chart[S.chart.length - 1];
    S.chart.push(Math.max(20, last + (Math.random() - 0.3) * 10 + (p.mine ? 6 : 0)));
    if (p.mine) { S.demo.total += p.total; S.demo.count += 1; }
    devices.dashboard.flash = 1;
    redrawScreens();
    if (current().id === 'dashboard') renderPanel(false);
  });
}
// order: device → cloud → kitchen + dashboard
function flowOrder(name, o, color, after) {
  devices[name].flash = 1;
  if (o.mine) S.inflight += 1;
  spawnPacket(name, true, color, () => {
    hubPulse = 1;
    pushFeed('#' + o.id, o.source, o.total, o.mine);
    spawnPacket('kds', false, color, () => {
      o.born = now();
      if (o.mine) S.inflight = Math.max(0, S.inflight - 1);
      addTicket(o);
      devices.kds.flash = 1;
      redrawScreens();
      after?.();
      if (current().id === 'kitchen') renderPanel(false);
    });
    toDashboard(name, color, o);
  });
}
// payment: device → cloud → dashboard
function flowPayment(name, p, color) {
  devices[name].flash = 1;
  spawnPacket(name, true, color, () => {
    hubPulse = 1;
    pushFeed(p.label, p.source, p.total, p.mine);
    toDashboard(name, color, p);
  });
}

// background traffic so the world always feels alive
const AMBIENT = [
  ['till', 'EPOS', 'POS', C.teal], ['kiosk', 'Kiosk', 'Kiosk', C.amber], ['store', 'Online', 'Online', C.pink],
  ['paylink', 'Payment link', 'Links', C.sky], ['till', 'EPOS', 'POS', C.teal], ['subs', 'Subscription', 'Subs', C.green],
];
let ambientIdx = 0;
function ambient() {
  if (document.hidden) return;
  const [name, source, channel, color] = AMBIENT[ambientIdx++ % AMBIENT.length];
  if (channel === 'Links' || channel === 'Subs') {
    const total = channel === 'Links' ? pick([45, 86.4, 120, 162.5]) : pick(PLANS)[1];
    flowPayment(name, { kind: 'payment', label: channel === 'Links' ? 'PL-' + (300 + Math.floor(Math.random() * 600)) : pick(PLANS)[0], source, channel, total }, color);
  } else {
    flowOrder(name, makeOrder(source, channel, randomItems()), color);
  }
}
setTimeout(ambient, 1500);
setInterval(ambient, reduceMotion ? 7000 : 4300);

/* ---------- Stages (the tour) ---------- */
const prodButtons = (cartKey, items) => `<div class="prods">${items.map((m) => {
  const q = qtyIn(S[cartKey], m.n);
  return `<button type="button" class="prod${q ? ' on' : ''}" style="--c:${m.c}" data-act="add" data-cart="${cartKey}" data-item="${esc(m.n)}" aria-label="Add ${esc(m.n)}, ${money(m.p)}${q ? `, ${q} in basket` : ''}"><i></i><span>${esc(m.n)}<small>${money(m.p)}</small></span>${q ? `<b>×${q}</b>` : '<em>+</em>'}</button>`;
}).join('')}</div>`;
const summary = (cart) => `<div class="sum">${cart.map((i) => `<div><span>${i.q}× ${esc(i.n)}</span><b>${money(i.p * i.q)}</b></div>`).join('')}<div class="tot"><span>Total</span><b>${money(cartTotal(cart))}</b></div></div>`;
const head = (st) => `<p class="eyebrow">${st.eyebrow}</p><h2>${st.title}</h2><p>${st.text}</p>`;

const STAGES = [
  {
    id: 'intro', label: 'Start', shot: 'overview', accent: '#2ee6c5',
    render: () => `
      <p class="eyebrow">EPOS · Online store · Payments</p>
      <h1>One system.<br /><span class="grad">Every sale, kitchen and payment.</span></h1>
      <p class="lead">Take a two-minute tour. Order online, take a card payment, send a payment link and start a subscription. Watch every sale land in one dashboard.</p>
      <div class="actions"><button type="button" class="btn" data-act="next">Start the tour →</button><a class="btn ghost" href="mailto:hello@flowpos.co.uk?subject=FlowPOS%20demo">Book a demo</a></div>
      <p class="hint">Use the stage bar, your arrow keys or swipe. Click any device to jump to it.</p>`,
  },
  {
    id: 'store', label: 'Online store', shot: 'store', accent: '#f472b6',
    eyebrow: 'Online store', title: 'Your own online shop',
    text: 'Customers order from your branded store, with the same menu, prices and stock as in-store. Try it: add a few items.',
    render(st) {
      const n = cartCount(S.cart);
      if (S.phone === 'confirmed' || S.phone === 'ready') {
        return `${head(st)}<p class="ok">Order #${S.phoneOrder.id} is placed. Follow it through checkout and the kitchen.</p>
          <div class="actions"><button type="button" class="btn ghost" data-act="new-online">Start a new order</button></div>`;
      }
      return `${head(st)}${prodButtons('cart', STORE_ITEMS)}
        <button type="button" class="btn pink wide" data-act="to-checkout" ${n ? '' : 'disabled'}>${n ? `Checkout · ${money(cartTotal(S.cart))}` : 'Add an item to continue'}</button>`;
    },
  },
  {
    id: 'checkout', label: 'Checkout', shot: 'store', accent: '#f472b6',
    eyebrow: 'Checkout', title: 'Pay in one tap',
    text: 'Card or wallet, fast and secure. Press pay and watch the order fly to your kitchen.',
    enter() { if (S.phone === 'browse' && S.cart.length) { S.phone = 'checkout'; redrawScreens(); } },
    render(st) {
      if (S.phone === 'confirmed' || S.phone === 'ready') {
        return `${head(st)}<p class="ok">Paid ${money(S.phoneOrder.total)}. Order #${S.phoneOrder.id} is on its way to the kitchen.</p>
          <div class="actions"><button type="button" class="btn" data-act="next">Follow it to the kitchen →</button></div>`;
      }
      if (!S.cart.length) {
        return `${head(st)}<p class="note">Your basket is empty.</p>
          <div class="actions"><button type="button" class="btn pink" data-act="quick-cart">Add a Flat White and continue</button></div>`;
      }
      const paying = S.phone === 'paying';
      return `${head(st)}${summary(S.cart)}
        <button type="button" class="btn black wide" data-act="pay-online" ${paying ? 'disabled' : ''}>${paying ? 'Processing…' : `Pay ${money(cartTotal(S.cart))}`}</button>
        <p class="note">Demo only. No real card is charged.</p>`;
    },
  },
  {
    id: 'kitchen', label: 'Kitchen', shot: 'kds', accent: '#2ee6c5',
    eyebrow: 'Kitchen display', title: 'Every order lands in the kitchen',
    text: 'Online, EPOS and kiosk orders share one queue, with timers. Bump an order when it is ready and the customer is told.',
    render(st) {
      const mine = S.tickets.find((t) => t.mine && !t.ready);
      const inFlight = S.inflight > 0 || S.phone === 'paying';
      if (mine) {
        return `${head(st)}<p class="note">Your order #${mine.id} (${esc(mine.source)}) is in the queue, marked in pink.</p>
          <button type="button" class="btn wide" data-act="bump" data-id="${mine.id}">Bump #${mine.id} · mark ready</button>`;
      }
      if (inFlight) {
        return `${head(st)}<p class="note">Your order is flying to the kitchen now. Watch the screen…</p>
          <button type="button" class="btn wide" disabled>Waiting for your order…</button>`;
      }
      if (S.demo.done.has('kitchen')) {
        return `${head(st)}<p class="ok">Ready! ${S.phone === 'ready' ? 'The customer’s phone now says “Ready to collect”.' : 'The order is marked done.'}</p>
          <div class="actions"><button type="button" class="btn" data-act="next">Next: EPOS →</button></div>`;
      }
      return `${head(st)}<p class="note">Place an order first, then follow it here.</p>
        <div class="actions"><button type="button" class="btn ghost" data-act="goto" data-to="store">Go to the online store</button></div>`;
    },
  },
  {
    id: 'pos', label: 'EPOS', shot: 'till', accent: '#2ee6c5',
    eyebrow: 'EPOS + card reader', title: 'Sell at the counter in seconds',
    text: 'This is the FlowPOS EPOS. Tap items, choose Eat In or Take Away, and the linked card reader takes the payment.',
    render(st) {
      if (S.pos === 'charging') {
        return `${head(st)}${summary(S.posCart)}<p class="note">The card reader shows ${money(cartTotal(S.posCart))}.</p>
          <button type="button" class="btn amber wide" data-act="tap">Tap card on the reader</button>`;
      }
      if (S.pos === 'approved') {
        return `${head(st)}<p class="ok">Approved. Order #${S.posOrder.id} is on its way to the kitchen.</p>
          <div class="actions"><button type="button" class="btn ghost" data-act="new-sale">New sale</button><button type="button" class="btn" data-act="next">Next: Kiosk →</button></div>`;
      }
      const n = cartCount(S.posCart);
      return `${head(st)}${prodButtons('posCart', POS_ITEMS)}
        <div class="actions"><button type="button" class="btn eat" data-act="charge" data-mode="Eat In" ${n ? '' : 'disabled'}>Eat In</button><button type="button" class="btn take" data-act="charge" data-mode="Take Away" ${n ? '' : 'disabled'}>Take Away</button></div>
        <p class="note">${n ? `Total ${money(cartTotal(S.posCart))}. Pick Eat In or Take Away to pay.` : 'Tap items to start a sale.'}</p>`;
    },
  },
  {
    id: 'kiosk', label: 'Kiosk', shot: 'kiosk', accent: '#fbbf24',
    eyebrow: 'Self-order kiosk', title: 'Let customers serve themselves',
    text: 'Shorter queues and bigger baskets. Same menu as the till. Pick something and pay at the kiosk.',
    render(st) {
      if (S.kiosk === 'placed') {
        return `${head(st)}<p class="ok">Order #${S.kioskOrder.id} placed. The customer’s number is on the screen.</p>
          <div class="actions"><button type="button" class="btn ghost" data-act="new-kiosk">New order</button><button type="button" class="btn" data-act="next">Next: Payment links →</button></div>`;
      }
      const n = cartCount(S.kioskCart);
      return `${head(st)}${prodButtons('kioskCart', KIOSK_ITEMS)}
        <button type="button" class="btn amber wide" data-act="kiosk-pay" ${n ? '' : 'disabled'}>${n ? `Pay at kiosk · ${money(cartTotal(S.kioskCart))}` : 'Tap an item to start'}</button>`;
    },
  },
  {
    id: 'paylink', label: 'Payment links', shot: 'paylink', accent: '#60a5fa',
    eyebrow: 'Payment links', title: 'Get paid with a link',
    text: 'Email a secure link for a deposit, an invoice or a custom order. Send one, then pay it as the customer.',
    render(st) {
      const s = S.linkState;
      if (s === 'none') {
        return `${head(st)}<div class="opts">${LINKS.map(([d, a], i) => `<button type="button" class="opt" style="--accent:#60a5fa" aria-pressed="${S.linkPick === i}" data-act="link-pick" data-i="${i}"><span>${d}</span><b>${money(a)}</b></button>`).join('')}</div>
          <button type="button" class="btn sky wide" data-act="link-send">Send payment link · ${money(LINKS[S.linkPick][1])}</button>`;
      }
      if (s === 'sending') return `${head(st)}<p class="note">Sending the link to the customer’s inbox…</p><button type="button" class="btn sky wide" disabled>Sending…</button>`;
      if (s === 'sent' || s === 'paying') {
        return `${head(st)}<p class="note">The customer got an email with a <b>Pay Now</b> button.</p>
          <button type="button" class="btn sky wide" data-act="link-pay" ${s === 'paying' ? 'disabled' : ''}>${s === 'paying' ? 'Paying…' : `Pay as the customer · ${money(S.link.total)}`}</button>`;
      }
      return `${head(st)}<p class="ok">${esc(S.link.id)} paid: ${money(S.link.total)}. It shows on your dashboard.</p>
        <div class="actions"><button type="button" class="btn ghost" data-act="link-reset">Send another</button><button type="button" class="btn" data-act="next">Next: Subscriptions →</button></div>`;
    },
  },
  {
    id: 'subs', label: 'Subscriptions', shot: 'subs', accent: '#4ade80',
    eyebrow: 'Subscriptions', title: 'Turn regulars into steady income',
    text: 'Weekly, monthly or yearly plans, charged automatically. Subscribe, then skip ahead to see a renewal.',
    render(st) {
      const mine = S.subs.mine;
      if (!mine) {
        const [pn, pp, per] = PLANS[S.planPick];
        return `${head(st)}<div class="opts">${PLANS.map(([n, p, per2], i) => `<button type="button" class="opt" style="--accent:#4ade80" aria-pressed="${S.planPick === i}" data-act="plan-pick" data-i="${i}"><span>${n}</span><b>${money(p)}/${per2}</b></button>`).join('')}</div>
          <button type="button" class="btn green wide" data-act="subscribe">Subscribe to ${pn} · ${money(pp)}/${per}</button>`;
      }
      return `${head(st)}<p class="ok">You’re on ${mine.plan}. ${mine.renewals ? `${mine.renewals} renewal${mine.renewals > 1 ? 's' : ''} charged automatically.` : 'First payment taken.'} Next payment: ${fmtDate(mine.next)}.</p>
        <div class="actions"><button type="button" class="btn green" data-act="renew">Skip ahead 1 ${mine.period} →</button><button type="button" class="btn ghost" data-act="next">Next: Dashboard</button></div>`;
    },
  },
  {
    id: 'dashboard', label: 'Dashboard', shot: 'dashboard', accent: '#8b5cf6',
    eyebrow: 'Dashboard', title: 'See everything, live, in one place',
    text: 'This is the FlowPOS dashboard. Every sale from every channel lands here, next to your products, stock, customers and staff.',
    render(st) {
      const items = [['checkout', 'Online order', 'store'], ['kitchen', 'Kitchen bump', 'kitchen'], ['pos', 'EPOS card sale', 'pos'],
        ['kiosk', 'Kiosk order', 'kiosk'], ['paylink', 'Payment link paid', 'paylink'], ['subs', 'Subscription', 'subs']];
      return `${head(st)}
        <div><div class="big-stat">${money(S.demo.total)}</div><p class="note">${S.demo.count} payment${S.demo.count === 1 ? '' : 's'} from you on this tour</p></div>
        <ul class="checklist">${items.map(([k, l, to]) => `<li class="${S.demo.done.has(k) ? 'done' : ''}"><span>${l}${S.demo.done.has(k) ? '' : ` · <button type="button" data-act="goto" data-to="${to}">try it</button>`}</span></li>`).join('')}</ul>
        <div class="actions"><a class="btn" href="mailto:hello@flowpos.co.uk?subject=FlowPOS%20demo">Book a demo</a><button type="button" class="btn ghost" data-act="goto" data-to="intro">Restart tour</button></div>`;
    },
  },
];

/* ---------- Panel + stage bar ---------- */
const panel = document.getElementById('panel');
const panelBody = document.getElementById('panelBody');
const stagesNav = document.getElementById('stages');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const countEl = document.getElementById('count');
let stageIdx = 0;
const current = () => STAGES[stageIdx];

STAGES.forEach((st, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.dataset.i = i;
  b.innerHTML = `<i></i>${st.label}`;
  b.addEventListener('click', () => go(i));
  stagesNav.appendChild(b);
});

function renderPanel(enter = true) {
  const st = current();
  const focusedAct = document.activeElement?.closest?.('#panelBody [data-act]')?.dataset.act;
  panel.classList.toggle('intro', st.id === 'intro');
  panel.style.setProperty('--accent', st.accent);
  panelBody.innerHTML = st.render(st);
  panelBody.classList.toggle('enter', enter);
  if (enter) panelBody.scrollTop = 0;
  if (focusedAct) panelBody.querySelector(`[data-act="${focusedAct}"]`)?.focus({ preventScroll: true });
  prevBtn.disabled = stageIdx === 0;
  const nxt = STAGES[stageIdx + 1];
  nextBtn.hidden = !nxt;
  nextBtn.textContent = nxt ? `Next: ${nxt.label} →` : '';
  countEl.textContent = `${String(stageIdx + 1).padStart(2, '0')} / ${String(STAGES.length).padStart(2, '0')}`;
  [...stagesNav.children].forEach((c, i) => {
    c.classList.toggle('on', i === stageIdx);
    c.classList.toggle('done', S.demo.done.has(STAGES[i].id));
    if (i === stageIdx) c.setAttribute('aria-current', 'step'); else c.removeAttribute('aria-current');
  });
}

function go(i, { instant = false } = {}) {
  i = Math.max(0, Math.min(STAGES.length - 1, i));
  const changed = i !== stageIdx;
  stageIdx = i;
  current().enter?.();
  renderPanel(true);
  const chip = stagesNav.children[i];
  stagesNav.scrollTo({ left: chip.offsetLeft - stagesNav.clientWidth / 2 + chip.offsetWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
  try { history.replaceState(null, '', '#' + current().id); } catch (e) { /* ignore */ }
  if (changed || instant) flyTo(instant);
}
const goId = (id) => go(STAGES.findIndex((s) => s.id === id));
prevBtn.addEventListener('click', () => go(stageIdx - 1));
nextBtn.addEventListener('click', () => go(stageIdx + 1));
document.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); goId('intro'); });
addEventListener('hashchange', () => {
  const i = STAGES.findIndex((s) => '#' + s.id === location.hash);
  if (i >= 0 && i !== stageIdx) go(i);
});

const done = (id) => { S.demo.done.add(id); };
const later = (ms, fn) => setTimeout(() => { fn(); redrawScreens(); renderPanel(false); }, ms);

panelBody.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  switch (act) {
    case 'next': go(stageIdx + 1); return;
    case 'goto': goId(el.dataset.to); return;
    case 'add': {
      const cart = el.dataset.cart;
      if (cart === 'posCart' && S.pos === 'approved') { S.posCart = []; S.pos = 'idle'; }
      addTo(S[cart], byName(el.dataset.item));
      if (cart === 'cart') devices.store.flash = 0.6;
      if (cart === 'posCart') devices.till.flash = 0.6;
      if (cart === 'kioskCart') devices.kiosk.flash = 0.6;
      break;
    }
    case 'to-checkout': goId('checkout'); return;
    case 'quick-cart': addTo(S.cart, byName('Flat White')); S.phone = 'checkout'; break;
    case 'new-online': S.cart = []; S.phone = 'browse'; S.phoneOrder = null; break;
    case 'pay-online': {
      S.phone = 'paying';
      later(1100, () => {
        const o = makeOrder('Online', 'Online', S.cart.map((i) => ({ ...i })), true);
        S.phoneOrder = o; S.phone = 'confirmed'; S.cart = [];
        done('checkout'); done('store');
        flowOrder('store', o, C.pink);
      });
      break;
    }
    case 'bump': {
      const t = S.tickets.find((x) => x.id === Number(el.dataset.id));
      if (t) {
        t.ready = true;
        if (t.source === 'Online' && S.phoneOrder?.id === t.id) { S.phone = 'ready'; devices.store.flash = 1; spawnPacket('kds', true, C.green, () => spawnPacket('store', false, C.green)); }
        devices.kds.flash = 1;
        done('kitchen');
        setTimeout(() => { S.tickets = S.tickets.filter((x) => x !== t); redrawScreens(); }, 4000);
      }
      break;
    }
    case 'charge': S.pos = 'charging'; S.posMode = el.dataset.mode; devices.till.flash = 1; break;
    case 'tap': {
      S.pos = 'approved';
      const o = makeOrder('EPOS', 'POS', S.posCart.map((i) => ({ ...i })), true);
      o.mode = S.posMode;
      S.posOrder = o; S.posCart = [];
      done('pos');
      flowOrder('till', o, C.teal);
      break;
    }
    case 'new-sale': S.pos = 'idle'; S.posCart = []; S.posOrder = null; break;
    case 'kiosk-pay': {
      const o = makeOrder('Kiosk', 'Kiosk', S.kioskCart.map((i) => ({ ...i })), true);
      S.kioskOrder = o; S.kiosk = 'placed'; S.kioskCart = [];
      done('kiosk');
      flowOrder('kiosk', o, C.amber);
      break;
    }
    case 'new-kiosk': S.kiosk = 'browse'; S.kioskCart = []; break;
    case 'link-pick': S.linkPick = Number(el.dataset.i); break;
    case 'link-send': {
      const [desc, total] = LINKS[S.linkPick];
      S.link = { id: 'PL-' + S.nextLink++, desc, total };
      S.linkState = 'sending';
      devices.dashboard.flash = 1;
      spawnPacket('dashboard', true, C.sky, () => {
        hubPulse = 1;
        spawnPacket('paylink', false, C.sky, () => { S.linkState = 'sent'; devices.paylink.flash = 1; redrawScreens(); renderPanel(false); });
      });
      break;
    }
    case 'link-pay': {
      S.linkState = 'paying';
      later(900, () => {
        S.linkState = 'paid';
        done('paylink');
        flowPayment('paylink', { kind: 'payment', label: S.link.id, source: 'Payment link', channel: 'Links', total: S.link.total, mine: true }, C.sky);
      });
      break;
    }
    case 'link-reset': S.linkState = 'none'; S.link = null; break;
    case 'plan-pick': S.planPick = Number(el.dataset.i); break;
    case 'subscribe': {
      const [plan, total, period] = PLANS[S.planPick];
      S.subs.mine = { plan, total, period, next: nextDate(period), renewals: 0 };
      S.subs.members += 1;
      S.subs.renewedAt = now() + 2;
      devices.subs.boost?.();
      done('subs');
      flowPayment('subs', { kind: 'payment', label: plan, source: 'Subscription', channel: 'Subs', total, mine: true }, C.green);
      break;
    }
    case 'renew': {
      const m = S.subs.mine;
      m.renewals += 1;
      m.next = nextDate(m.period, m.next);
      S.subs.renewedAt = now() + 2.2;
      devices.subs.boost?.();
      flowPayment('subs', { kind: 'payment', label: m.plan + ' renewal', source: 'Subscription', channel: 'Subs', total: m.total, mine: true }, C.green);
      break;
    }
    default: return;
  }
  redrawScreens();
  renderPanel(false);
});

/* ---------- Camera: frame the focused device inside the free area ---------- */
function freeRect() {
  const W = innerWidth, H = innerHeight;
  const p = panel.getBoundingClientRect();
  const sb = stagesNav.getBoundingClientRect();
  const top = 64;
  if (p.width > W * 0.7) { // bottom sheet
    return { x: 0, y: top, w: W, h: Math.max(120, sb.top - 8 - top) };
  }
  const left = current().id === 'intro' && W > 900 ? p.left + p.width * 0.86 : p.right + 16;
  const bottom = sb.left < p.right && sb.top < H - 4 ? sb.top - 8 : H - 16;
  return { x: left, y: top, w: Math.max(160, W - 16 - left), h: Math.max(120, Math.min(bottom, H - 16) - top) };
}
function shotFor(st) {
  const W = innerWidth, H = innerHeight;
  const fr = freeRect();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let center, dir, w, h;
  if (st.shot === 'overview') {
    center = new THREE.Vector3(0, 2.0, 0.6);
    dir = new THREE.Vector3(0, 0.5, 1).normalize();
    w = 9.8; h = 3.6;
  } else {
    const d = devices[st.shot];
    center = d.group.position.clone().add(new THREE.Vector3(0, d.frame.cy, 0));
    const ry = d.group.rotation.y + 0.14;
    dir = new THREE.Vector3(Math.sin(ry), 0.2, Math.cos(ry)).normalize();
    w = d.frame.w; h = d.frame.h;
  }
  const dist = Math.max((h * H) / (tanV * fr.h), (w * H) / (tanV * fr.w)) * 1.12;
  return {
    pos: center.clone().addScaledVector(dir, dist),
    target: center,
    dx: fr.x + fr.w / 2 - W / 2,
    dy: fr.y + fr.h / 2 - H / 2,
  };
}
const cam = { pos: new THREE.Vector3(0, 14, 34), target: new THREE.Vector3(0, 2, 0), dx: 0, dy: 0 };
let flight = null;
let goal = null;
function flyTo(instant = false) {
  goal = shotFor(current());
  if (instant || reduceMotion) {
    cam.pos.copy(goal.pos); cam.target.copy(goal.target); cam.dx = goal.dx; cam.dy = goal.dy;
    flight = null;
    return;
  }
  const from = { pos: cam.pos.clone(), target: cam.target.clone(), dx: cam.dx, dy: cam.dy };
  const lift = from.pos.distanceTo(goal.pos) * 0.22;
  const mid = from.pos.clone().lerp(goal.pos, 0.5).add(new THREE.Vector3(0, lift, 0));
  flight = { from, mid, t0: now(), dur: THREE.MathUtils.clamp(0.9 + from.pos.distanceTo(goal.pos) * 0.05, 1.1, 2.0) };
}
const relayout = () => { if (!flight) goal = shotFor(current()); else flyTo(); };
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sheet-h', panel.getBoundingClientRect().height + 'px');
  requestAnimationFrame(relayout);
}).observe(panel);

/* ---------- Input: keys, wheel, swipe, click devices ---------- */
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(stageIdx + 1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(stageIdx - 1); }
});
let wheelAcc = 0, wheelLock = 0;
addEventListener('wheel', (e) => {
  if (panel.contains(e.target) && panelBody.scrollHeight > panelBody.clientHeight + 2) return;
  if (stagesNav.contains(e.target)) return;
  wheelAcc += e.deltaY + e.deltaX * 0.5;
  if (now() < wheelLock) return;
  if (Math.abs(wheelAcc) > 70) {
    go(stageIdx + Math.sign(wheelAcc));
    wheelAcc = 0; wheelLock = now() + 1.1;
  }
}, { passive: true });
setInterval(() => { wheelAcc *= 0.5; }, 200);

let touch = null;
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, t: now() }; }, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (now() - touch.t < 0.8) {
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(stageIdx + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 60) go(stageIdx + (dy < 0 ? 1 : -1));
  }
  touch = null;
}, { passive: true });

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function deviceAt(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickables, true).find((h) => h.object.type === 'Mesh');
  let o = hit?.object;
  while (o && !o.userData.device) o = o.parent;
  return o?.userData.device;
}
const STAGE_FOR = { store: 'store', kds: 'kitchen', till: 'pos', kiosk: 'kiosk', paylink: 'paylink', subs: 'subs', dashboard: 'dashboard' };
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!GL || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
  const dev = deviceAt(e.clientX, e.clientY);
  if (!dev) return;
  const target = STAGE_FOR[dev];
  if (target === 'store' && current().id === 'checkout') return;
  if (target !== current().id) goId(target);
});
const mouse = new THREE.Vector2();
let hoverT = 0;
addEventListener('pointermove', (e) => {
  mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  if (!GL || coarse || e.target !== canvas) { document.body.classList.remove('hovering'); return; }
  const t = now();
  if (t - hoverT < 0.08) return;
  hoverT = t;
  document.body.classList.toggle('hovering', !!deviceAt(e.clientX, e.clientY));
});

/* ---------- Post-processing ---------- */
let composer = null;
if (GL) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), LITE ? 0.6 : 0.75, 0.55, 0.82));
  composer.addPass(new OutputPass());
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (GL) { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); }
  relayout();
});

/* ---------- Loop ---------- */
const clock = new THREE.Clock();
let redrawAcc = 0;
const tmp = new THREE.Vector3();
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // camera
  if (!goal) goal = shotFor(current());
  if (flight) {
    const k = Math.min(1, (now() - flight.t0) / flight.dur);
    const e = easeIO(k);
    const a = flight.from.pos, m = flight.mid, b = goal.pos;
    cam.pos.set(
      (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * m.x + e * e * b.x,
      (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * m.y + e * e * b.y,
      (1 - e) * (1 - e) * a.z + 2 * (1 - e) * e * m.z + e * e * b.z,
    );
    cam.target.lerpVectors(flight.from.target, goal.target, e);
    cam.dx = THREE.MathUtils.lerp(flight.from.dx, goal.dx, e);
    cam.dy = THREE.MathUtils.lerp(flight.from.dy, goal.dy, e);
    if (k >= 1) flight = null;
  } else {
    const s = 1 - Math.exp(-dt * 5);
    cam.pos.lerp(goal.pos, s); cam.target.lerp(goal.target, s);
    cam.dx += (goal.dx - cam.dx) * s; cam.dy += (goal.dy - cam.dy) * s;
  }
  camera.position.copy(cam.pos);
  if (!reduceMotion) {
    const d = cam.pos.distanceTo(cam.target);
    tmp.set(Math.sin(t * 0.25) * 0.015 * d + (coarse ? 0 : mouse.x * 0.04 * d), Math.sin(t * 0.33) * 0.01 * d - (coarse ? 0 : mouse.y * 0.025 * d), 0);
    camera.position.add(tmp);
  }
  camera.lookAt(cam.target);
  { const d = cam.pos.distanceTo(cam.target); scene.fog.near = Math.max(14, d * 0.75); scene.fog.far = Math.max(58, d + 34); }
  camera.setViewOffset(innerWidth, innerHeight, -cam.dx, -cam.dy, innerWidth, innerHeight);

  // devices
  const focus = current().shot;
  const overview = focus === 'overview';
  Object.entries(devices).forEach(([name, d]) => {
    d.flash = Math.max(0, d.flash - dt * 1.4);
    const f = name === focus ? 1 : 0;
    d.edges.forEach((m) => { m.opacity = m.userData.base + d.flash * 0.6 + f * 0.25; });
    d.ring.material.opacity = 0.3 + f * 0.5 + d.flash * 0.5;
    d.tubeMat.opacity = 0.12 + f * 0.18 + d.flash * 0.3;
    d.flowMat.opacity = 0.35 + f * 0.4 + d.flash * 0.4;
    d.tag.material.opacity += ((overview ? 0.95 : 0) - d.tag.material.opacity) * Math.min(1, dt * 4);
    if (!reduceMotion) d.tick?.(t, dt);
  });
  if (!reduceMotion) FLOW.offset.x -= dt * 0.35;

  // hub
  hubPulse = Math.max(0, hubPulse - dt * 1.8);
  const spin = reduceMotion ? 0 : dt;
  shell.rotation.y += spin * 0.25; shell.rotation.x += spin * 0.1;
  core.rotation.y -= spin * 0.4;
  rings.forEach((r, n) => { r.rotation.z += spin * (0.2 + n * 0.12) * (n % 2 ? -1 : 1); });
  hub.position.y = HUB.y + (reduceMotion ? 0 : Math.sin(t * 0.8) * 0.12);
  hub.scale.setScalar(1 + hubPulse * 0.18);
  core.material.emissiveIntensity = 1.4 + hubPulse * 2.5;
  mark.material.color.setScalar(1 + hubPulse * 0.9);
  hubGlow.material.opacity = 0.45 + hubPulse * 0.4;

  // ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.t += dt;
    const k = r.t / 1.2;
    r.m.scale.setScalar(1.5 + k * 2.5);
    r.m.material.opacity = 1 - k;
    if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); ripples.splice(i, 1); }
  }

  // dust
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

  redrawAcc += dt;
  if (redrawAcc > 0.25) { redrawAcc = 0; redrawScreens(); }

  if (GL) composer.render();
}

/* ---------- Start ---------- */
const startIdx = Math.max(0, STAGES.findIndex((s) => '#' + s.id === location.hash));
stageIdx = startIdx;
current().enter?.();
renderPanel(true);
requestAnimationFrame(() => {
  document.documentElement.style.setProperty('--sheet-h', panel.getBoundingClientRect().height + 'px');
  goal = shotFor(current());
  // open with a short fly-in from far away
  cam.pos.copy(goal.pos).add(new THREE.Vector3(0, 8, 14)); cam.target.copy(goal.target); cam.dx = goal.dx; cam.dy = goal.dy;
  flyTo(false);
});
document.fonts?.ready.then(redrawScreens);
if (GL) requestAnimationFrame(frame);
