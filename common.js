// Ерөнхий туслах функцүүд (index.html, admin.html хоёрт хамтдаа ашиглана)
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT");
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const STAFF_GROUPS = [
  "Захирал", "Сургалтын менежер", "Багш", "Бага ангийн багш", "Биеийн тамирын багш",
  "Нярав", "Нягтлан бодогч", "Архив бичиг хэрэг", "Номын санч",
  "Нийгмийн ажилтан", "Сэтгэлзүйч", "Эмч",
  "Сантехникч", "Цахилгаанчин", "Усны машины жолооч", "Үйлчлэгч", "Сахиул",
  "Тогооч", "Тогоочийн туслах", "Угаагч",
  "Дотуур байрны багш", "Дотуур байрны үйлчлэгч", "Дотуур байрны сахиул", "Бусад"
];

function $(id) {
  return document.getElementById(id);
}

function show(id, on = true) {
  const node = $(id);
  if (node) node.hidden = !on;
}

function setMsg(id, text, kind) {
  const node = $(id);
  if (!node) return;
  node.textContent = text || "";
  node.className = "msg" + (kind ? " " + kind : "");
  node.hidden = !text;
}

// Аюулгүй DOM бүтээгч: хэрэглэгчийн текстийг зөвхөн textContent-оор оруулна
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function translateError(err) {
  const m = (err && err.message) || String(err);
  if (/Invalid login credentials/i.test(m)) return "Имэйл эсвэл нууц үг буруу байна.";
  if (/already registered/i.test(m)) return "Энэ имэйл бүртгэлтэй байна. Нэвтрэх хэсгээр орно уу.";
  if (/Password should be at least/i.test(m)) return "Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой.";
  if (/Email not confirmed/i.test(m)) return "Имэйлээ баталгаажуулаагүй байна. Ирсэн имэйлээ шалгана уу.";
  if (/row-level security/i.test(m)) return "Үйлдэл хийх эрхгүй эсвэл сургуулийн лицензийн хугацаа дууссан байна.";
  if (/duplicate key/i.test(m)) return "Та энэ зааварт аль хэдийн гарын үсэг зурсан байна.";
  return m;
}

// Гарын үсэг зурах талбар (хуруу, хулгана, стилус)
class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.drawing = false;
    this.dirty = false;
    this.resize();
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => this.start(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
      canvas.addEventListener(ev, () => this.end());
    }
  }
  resize() {
    // Дотоод нягтрал тогтмол: 600x240 (PNG жижиг хэвээр үлдэнэ)
    this.canvas.width = 600;
    this.canvas.height = 240;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = "#111";
    this.ctx.fillStyle = "#fff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.canvas.width) / r.width,
      y: ((e.clientY - r.top) * this.canvas.height) / r.height
    };
  }
  start(e) {
    e.preventDefault();
    this.drawing = true;
    const p = this.pos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this.ctx.lineTo(p.x + 0.01, p.y + 0.01);
    this.ctx.stroke();
    this.dirty = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* зарим хөтөч дэмждэггүй */ }
  }
  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const p = this.pos(e);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }
  end() {
    this.drawing = false;
  }
  clear() {
    this.dirty = false;
    this.resize();
  }
  isEmpty() {
    return !this.dirty;
  }
  toDataURL() {
    return this.canvas.toDataURL("image/png");
  }
}

// ---- Гэр–ажлын зам: тээврийн хэлбэр, газрын зураг (OpenStreetMap), маршрут ----
const MODES = { walk: "Явган", car: "Өөрийн машин", bus: "Нийтийн тээвэр", bike: "Дугуй" };
const UB_CENTER = [47.9184, 106.9177];

function haversineM(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Хаяг хайх (OpenStreetMap Nominatim, түлхүүр шаардахгүй)
async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=mn&accept-language=mn&q=" +
    encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Хаяг хайхад алдаа гарлаа");
  return res.json();
}

// Маршрутын зай, хугацаа. Сервер хариу өгөхгүй бол шулуун зайгаас ойролцоо тооцно.
async function calcRoute(mode, from, to) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const base = {
    walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/",
    bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving/",
    car: "https://router.project-osrm.org/route/v1/driving/",
    bus: "https://router.project-osrm.org/route/v1/driving/"
  }[mode];
  try {
    const res = await fetch(base + coords + "?overview=false");
    const j = await res.json();
    if (j.code === "Ok" && j.routes && j.routes[0]) {
      const r = j.routes[0];
      let min = r.duration / 60;
      // Нийтийн тээвэр: машины хугацаанаас удаан (буудал, хүлээлт) гэж тооцно
      if (mode === "bus") min = min * 1.6 + 8;
      // Явган, дугуйн хугацааг ажиллах серверийн профайл буруу байж болзошгүй тул зайгаар шалгана
      const speed = { walk: 5, bike: 15 }[mode];
      if (speed) min = Math.max(min, (r.distance / 1000 / speed) * 60 * 0.9);
      return { distance_m: Math.round(r.distance), duration_min: Math.max(1, Math.round(min)), approx: false };
    }
  } catch (_) { /* доорх ойролцоо тооцоонд шилжинэ */ }
  const d = haversineM(from, to) * 1.35;
  const kmh = { walk: 5, bike: 14, car: 25, bus: 18 }[mode];
  return { distance_m: Math.round(d), duration_min: Math.max(1, Math.round((d / 1000 / kmh) * 60)), approx: true };
}

function fmtKm(m) {
  return (m / 1000).toFixed(1) + " км";
}

// Leaflet газрын зураг: товшиж цэг сонгоно
function makePickMap(elId, center, onPick) {
  // Хуудас гүйлгэх үед зураг санамсаргүй томрохоос сэргийлж, товшсоны дараа дугуйгаар томруулна
  const map = L.map(elId, { scrollWheelZoom: false }).setView(center, 13);
  map.once("focus", () => map.scrollWheelZoom.enable());
  map.on("click", () => map.scrollWheelZoom.enable());
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap"
  }).addTo(map);
  let marker = null;
  const api = {
    map,
    setPoint(lat, lng) {
      if (marker) marker.setLatLng([lat, lng]);
      else marker = L.marker([lat, lng]).addTo(map);
    },
    addFixed(lat, lng, label) {
      L.circleMarker([lat, lng], { radius: 9, color: "#0a5", fillOpacity: 0.7 }).addTo(map).bindTooltip(label);
    }
  };
  map.on("click", (e) => {
    api.setPoint(e.latlng.lat, e.latlng.lng);
    onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
  return api;
}

/* Зааварчилгааны текстийг гарчиг/жагсаалт/тодруулга болгон харуулна (аюулгүй: зөвхөн textContent) */
function renderRich(container, text) {
  container.replaceChildren();
  let ul = null;
  const inline = (parent, s) => {
    s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement("strong");
        b.textContent = part.slice(2, -2);
        parent.append(b);
      } else if (part) parent.append(document.createTextNode(part));
    });
  };
  (text || "").split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { ul = null; return; }
    const bullet = line.match(/^([*\-•])\s+(.*)$/);
    if (bullet) {
      if (!ul) { ul = document.createElement("ul"); container.append(ul); }
      const li = document.createElement("li");
      inline(li, bullet[2]);
      ul.append(li);
      return;
    }
    ul = null;
    const isCaps = line.length >= 3 && line.length <= 90 &&
      line === line.toUpperCase() && line !== line.toLowerCase() && !/[.:]$/.test(line);
    const node = document.createElement(isCaps ? "h3" : "p");
    if (isCaps) node.textContent = line; else inline(node, line);
    container.append(node);
  });
}

const KIND_LABELS = {
  general: "Ерөнхий", daily: "Өдөр тутмын", initial: "Анхан шатны", pre: "Урьдчилсан",
  repeat: "Давтан", extra: "Ээлжит бус", commute: "Гэр–ажлын зам"
};
