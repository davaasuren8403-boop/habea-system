// Ерөнхий туслах функцүүд (index.html, admin.html хоёрт хамтдаа ашиглана)
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT");
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

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
