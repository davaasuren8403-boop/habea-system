// Админ хуудас: зааварчилгаа нэмэх, QR гаргах, хэн гарын үсэг зурсныг харах
let me = null;
let school = null;
let currentReport = null; // { doc, rows }

async function route() {
  show("view-login", false);
  show("view-main", false);
  setMsg("msg-global", "");
  if (!sb) {
    setMsg("msg-global", "config.js дотор Supabase тохиргоог бөглөөгүй байна.", "error");
    return;
  }
  const { data } = await sb.auth.getSession();
  show("btn-logout", !!data.session);
  if (!data.session) {
    show("view-login");
    return;
  }
  const { data: profile, error } = await sb
    .from("profiles").select("*").eq("id", data.session.user.id).maybeSingle();
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  if (!profile || profile.role !== "admin") {
    setMsg("msg-global", "Энэ хаяг админ эрхгүй байна.", "error");
    return;
  }
  me = profile;
  const { data: sch } = await sb.from("schools").select("*").eq("id", me.school_id).maybeSingle();
  school = sch;
  $("school-name").textContent = school ? school.name : "";
  $("join-code").textContent = school ? school.join_code : "";
  if (school && school.expires_at) {
    $("join-code").textContent += " · лиценз " + school.expires_at + " хүртэл";
  }
  if (school && !school.active) {
    setMsg("msg-global", "Сургуулийн эрх идэвхгүй байна. Нийлүүлэгчтэй холбогдоно уу.", "error");
  }
  show("view-main");
  buildAudience();
  await loadStaff();
  await loadRoutes();
  await loadDocs();
  setupSchoolMap();
}

// ---- Сургуулийн байршил ----
let adminMap = null;
let schoolPoint = null;

function setupSchoolMap() {
  const has = school && school.work_lat != null;
  $("school-loc-status").textContent = has
    ? "Байршил тохируулагдсан. Өөрчлөх бол газрын зураг дээр дахин товшиж хадгална."
    : "Байршил тохируулаагүй байна. Ажилтнууд маршрутаа оруулахын өмнө үүнийг хийнэ үү.";
  const center = has ? [school.work_lat, school.work_lng] : UB_CENTER;
  if (!adminMap) {
    adminMap = makePickMap("admin-map", center, (p) => { schoolPoint = p; });
  }
  adminMap.map.setView(center, has ? 15 : 12);
  if (has) adminMap.setPoint(school.work_lat, school.work_lng);
  setTimeout(() => adminMap.map.invalidateSize(), 150);
}

async function useMyLocForSchool() {
  setMsg("msg-loc", "Байршил тодорхойлж байна...");
  try {
    const p = await getMyLocation();
    schoolPoint = { lat: p.lat, lng: p.lng };
    adminMap.setPoint(p.lat, p.lng);
    adminMap.map.setView([p.lat, p.lng], 17);
    setMsg("msg-loc", "Одоогийн байршлыг сонголоо. Зөв бол «Сургуулийн байршлыг хадгалах» дарна уу.");
  } catch (err) {
    setMsg("msg-loc", err.message, "error");
  }
}

async function searchSchoolLoc() {
  const q = $("loc-search").value.trim();
  if (!q) return;
  setMsg("msg-loc", "Хайж байна...");
  try {
    const found = await geocode(q);
    if (!found.length) {
      setMsg("msg-loc", "Хаяг олдсонгүй. Газрын зургийг гараараа томруулж товшино уу.", "error");
      return;
    }
    adminMap.map.setView([parseFloat(found[0].lat), parseFloat(found[0].lon)], 16);
    setMsg("msg-loc", "Олдлоо. Одоо сургуулийн яг байрлал дээр товшино уу.");
  } catch (_) {
    setMsg("msg-loc", "Хайлт ажиллахгүй байна. Газрын зургийг гараараа томруулж товшино уу.", "error");
  }
}

async function saveSchoolLoc() {
  if (!schoolPoint) {
    setMsg("msg-loc", "Эхлээд газрын зураг дээр сургуулиа товшино уу.", "error");
    return;
  }
  const { error } = await sb.rpc("set_school_location", {
    p_lat: schoolPoint.lat, p_lng: schoolPoint.lng, p_name: school ? school.name : ""
  });
  if (error) {
    setMsg("msg-loc", translateError(error), "error");
    return;
  }
  school.work_lat = schoolPoint.lat;
  school.work_lng = schoolPoint.lng;
  setMsg("msg-loc", "Хадгалагдлаа.");
  $("school-loc-status").textContent = "Байршил тохируулагдсан.";
}

// ---- Ажилтнуудын маршрут ----
let routeMap = new Map();

async function loadRoutes() {
  const [rRes, pRes] = await Promise.all([
    sb.from("commute_routes").select("*").eq("school_id", me.school_id),
    sb.from("profiles").select("id, full_name, staff_group, staff_groups").eq("school_id", me.school_id).order("full_name")
  ]);
  if (rRes.error || pRes.error) {
    setMsg("msg-global", translateError(rRes.error || pRes.error), "error");
    return;
  }
  routeMap = new Map(rRes.data.map((r) => [r.user_id, r]));
  const body = $("route-body");
  body.replaceChildren();
  const missing = [];
  for (const p of pRes.data) {
    const r = routeMap.get(p.id);
    if (!r) {
      missing.push(p.full_name);
      continue;
    }
    body.append(
      el("tr", {},
        el("td", {}, p.full_name),
        el("td", {}, groupsOf(p).join(", ")),
        el("td", {}, MODES[r.mode] || r.mode),
        el("td", {}, fmtKm(r.distance_m)),
        el("td", {}, r.duration_min + " мин"))
    );
  }
  const counts = {};
  for (const r of routeMap.values()) counts[r.mode] = (counts[r.mode] || 0) + 1;
  const parts = Object.entries(counts).map(([m, n]) => `${MODES[m] || m}: ${n}`);
  $("route-stats").textContent =
    `Маршрут оруулсан: ${routeMap.size} / ${pRes.data.length}` +
    (parts.length ? ` (${parts.join(", ")})` : "") +
    (missing.length ? `. Оруулаагүй: ${missing.join(", ")}` : "");
}

let staffCache = [];
function buildTargets() {
  const box = $("doc-targets");
  box.replaceChildren();
  for (const p of staffCache) {
    box.append(el("label", { class: "check" }, el("input", { type: "checkbox", value: p.id }), el("span", {}, p.full_name)));
  }
}

function buildAudience() {
  const box = $("doc-audience");
  box.replaceChildren();
  for (const g of STAFF_GROUPS) {
    box.append(
      el("label", { class: "check" },
        el("input", { type: "checkbox", value: g }),
        el("span", {}, g))
    );
  }
}

async function loadStaff() {
  const { data, error } = await sb
    .from("profiles").select("id, full_name, position, staff_group, staff_groups").eq("school_id", me.school_id).order("full_name");
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  staffCache = data;
  buildTargets();
  const list = $("staff-list");
  list.replaceChildren();
  for (const p of data) {
    const box = el("div", {});
    buildGroupChecks(box, groupsOf(p));
    const save = el("button", { type: "button", class: "secondary" }, "Хадгалах");
    const summary = el("summary", { style: "cursor:pointer" }, groupsOf(p).join(", ") || "— бүлэггүй —");
    save.addEventListener("click", async () => {
      const gs = readGroupChecks(box);
      const { error: e2 } = await sb.rpc("set_staff_groups", { p_user: p.id, p_groups: gs });
      if (!e2) { p.staff_groups = gs; summary.textContent = gs.join(", ") || "— бүлэггүй —"; }
      setMsg("msg-global", e2 ? translateError(e2) : "Бүлэг хадгалагдлаа.", e2 ? "error" : "");
    });
    list.append(
      el("div", { class: "doc-item" },
        el("div", {}, el("strong", {}, p.full_name), el("div", { class: "muted" }, p.position || "")),
        el("details", { style: "max-width:420px" }, summary, box, save))
    );
  }
}

async function loadDocs() {
  const { data: docs, error } = await sb
    .from("documents").select("*").order("created_at", { ascending: false });
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  const list = $("doc-list");
  list.replaceChildren();
  if (!docs.length) {
    list.append(el("p", { class: "muted" }, "Одоогоор зааварчилгаа алга."));
    return;
  }
  for (const d of docs) {
    list.append(
      el("div", { class: "doc-item" },
        el("div", {},
          el("strong", {}, d.title),
          el("div", { class: "muted" },
            fmtDate(d.created_at) + " · " + (KIND_LABELS[d.kind] || "Ерөнхий") + (d.frequency === "daily" ? " · өдөр бүр" : " · нэг удаа") + (d.deadline ? " · хугацаа: " + d.deadline : "") + (d.target_users && d.target_users.length ? " · явах хүн: " + d.target_users.length : "") + (d.kind === "commute" ? " · гэр–ажлын зам: " + (MODES[d.commute_mode] || "") : d.audience && d.audience.length ? " · " + d.audience.join(", ") : " · бүх ажилтан") + (d.image_url ? " · постертой" : "") + (d.active ? "" : " · идэвхгүй"))
        ),
        el("div", { class: "row", style: "margin:0" },
          el("button", { type: "button", onclick: () => showQr(d) }, "QR"),
          el("button", { type: "button", class: "secondary", onclick: () => showReport(d) }, "Тайлан"),
          el("button", { type: "button", class: "secondary", onclick: () => startEdit(d) }, "Засах"),
          el("button", { type: "button", class: "secondary", onclick: () => toggleActive(d) },
            d.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх")
        )
      )
    );
  }
}

let editingDoc = null;

function endEdit() {
  editingDoc = null;
  $("form-doc").reset();
  for (const id of ["doc-kind", "doc-freq", "doc-mode"]) $(id).disabled = false;
  show("edit-banner", false);
  show("btn-doc-cancel", false);
  $("btn-doc-save").textContent = "Хадгалах";
  show("mode-wrap", false);
  show("target-wrap", false);
  show("aud-wrap");
  buildAudience();
  buildTargets();
}

function startEdit(d) {
  editingDoc = d;
  $("doc-title").value = d.title;
  $("doc-kind").value = d.kind;
  $("doc-freq").value = d.frequency;
  $("doc-mode").value = d.commute_mode || "walk";
  $("doc-body").value = d.body || "";
  $("doc-deadline").value = d.deadline || "";
  show("mode-wrap", d.kind === "commute");
  show("target-wrap", d.kind === "trip");
  show("aud-wrap", d.kind !== "trip");
  buildAudience();
  buildTargets();
  const aud = new Set(d.audience || []);
  document.querySelectorAll("#doc-audience input").forEach((i) => { i.checked = aud.has(i.value); });
  const tg = new Set(d.target_users || []);
  document.querySelectorAll("#doc-targets input").forEach((i) => { i.checked = tg.has(i.value); });
  for (const id of ["doc-kind", "doc-freq", "doc-mode"]) $(id).disabled = true;
  $("edit-banner").textContent = "Засварлаж байна: " + d.title + (d.image_url ? " (постер хэвээр үлдэнэ, шинэ зураг сонговол солигдоно)" : "") + ". Төрөл, давтамжийг өөрчилж болохгүй.";
  show("edit-banner");
  show("btn-doc-cancel");
  $("btn-doc-save").textContent = "Өөрчлөлтийг хадгалах";
  setMsg("msg-doc", "");
  $("form-doc").scrollIntoView({ behavior: "smooth" });
}

async function toggleActive(d) {
  const { error } = await sb.from("documents").update({ active: !d.active }).eq("id", d.id);
  if (error) setMsg("msg-global", translateError(error), "error");
  await loadDocs();
}

// Том зургийг автоматаар жижигрүүлж JPEG болгоно (2 МБ-аас бага болтол)
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  for (let i = 0; i < 6; i++) {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.88, 0.78, 0.68]) {
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= 1.8 * 1024 * 1024) return blob;
    }
    scale *= 0.8;
  }
  throw new Error("Зургийг жижигрүүлж чадсангүй. Өөр зураг сонгоно уу.");
}

async function uploadPoster(file) {
  if (!file) return null;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Зөвхөн PNG, JPG, WebP зураг оруулна уу.");
  let body = file, type = file.type, ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  if (file.size > 1.8 * 1024 * 1024) { body = await shrinkImage(file); type = "image/jpeg"; ext = "jpg"; }
  const path = `${me.school_id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("posters").upload(path, body, { contentType: type });
  if (error) throw error;
  return sb.storage.from("posters").getPublicUrl(path).data.publicUrl;
}

async function onCreateDoc(e) {
  e.preventDefault();
  let imageUrl = null;
  try {
    imageUrl = await uploadPoster($("doc-image").files[0]);
  } catch (err) {
    setMsg("msg-doc", translateError(err), "error");
    return;
  }
  if (editingDoc) {
    const d = editingDoc;
    const aud = d.kind === "trip" ? [] : [...document.querySelectorAll("#doc-audience input:checked")].map((i) => i.value);
    const upd = {
      title: $("doc-title").value.trim(),
      body: $("doc-body").value,
      deadline: $("doc-deadline").value || null,
      audience: aud.length ? aud : null
    };
    if (d.kind === "commute") upd.commute_mode = d.commute_mode;
    if (d.kind === "trip") {
      upd.target_users = [...document.querySelectorAll("#doc-targets input:checked")].map((i) => i.value);
      if (!upd.target_users.length) { setMsg("msg-doc", "Явах ажилтнуудыг сонгоно уу.", "error"); return; }
    }
    if (imageUrl) upd.image_url = imageUrl;
    const { error } = await sb.from("documents").update(upd).eq("id", d.id);
    if (error) { setMsg("msg-doc", translateError(error), "error"); return; }
    endEdit();
    setMsg("msg-doc", "Өөрчлөлт хадгалагдлаа.");
    await loadDocs();
    return;
  }
  const kind = $("doc-kind").value;
  const payload = {
    kind,
    frequency: $("doc-freq").value,
    commute_mode: kind === "commute" ? $("doc-mode").value : null,
    image_url: imageUrl,
    school_id: me.school_id,
    title: $("doc-title").value.trim(),
    body: $("doc-body").value,
    deadline: $("doc-deadline").value || null,
    audience: kind === "trip" ? [] : [...document.querySelectorAll("#doc-audience input:checked")].map((i) => i.value),
    target_users: kind === "trip" ? [...document.querySelectorAll("#doc-targets input:checked")].map((i) => i.value) : null
  };
  if (!payload.audience.length) payload.audience = null;
  if (kind === "trip" && !payload.target_users.length) {
    setMsg("msg-doc", "Томилолт, тэмцээнд явах ажилтнуудыг сонгоно уу.", "error");
    return;
  }
  const { error } = await sb.from("documents").insert(payload);
  if (error) {
    setMsg("msg-doc", translateError(error), "error");
    return;
  }
  $("form-doc").reset();
  show("mode-wrap", false);
  show("target-wrap", false);
  show("aud-wrap");
  buildAudience();
  buildTargets();
  setMsg("msg-doc", "Хадгалагдлаа.");
  await loadDocs();
}

function docUrl(d) {
  return new URL("index.html?doc=" + encodeURIComponent(d.id), location.href).href;
}

function showQr(d) {
  show("view-report", false);
  show("view-daily", false);
  const url = docUrl(d);
  $("qr-title").textContent = d.title;
  $("qr").replaceChildren();
  new QRCode($("qr"), { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
  $("qr-link").textContent = url;
  show("view-qr");
  $("view-qr").scrollIntoView({ behavior: "smooth" });
}

function showSchoolQr() {
  show("view-report", false);
  show("view-daily", false);
  const url = new URL("index.html?code=" + encodeURIComponent(school.join_code), location.href).href;
  $("qr-title").textContent = (school.name || "Сургууль") + ": бүх ажилтны нэгдсэн QR";
  $("qr").replaceChildren();
  new QRCode($("qr"), { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
  $("qr-link").textContent = url;
  show("view-qr");
  $("view-qr").scrollIntoView({ behavior: "smooth" });
}

async function showReport(d, day) {
  show("view-qr", false);
  show("view-daily", false);
  const [profRes, ackRes] = await Promise.all([
    sb.from("profiles").select("id, full_name, position, staff_group, staff_groups").eq("school_id", me.school_id).order("full_name"),
    sb.from("acknowledgements").select("*").eq("document_id", d.id)
  ]);
  if (profRes.error || ackRes.error) {
    setMsg("msg-global", translateError(profRes.error || ackRes.error), "error");
    return;
  }
  await resolveSignatures(ackRes.data);
  const isDaily = d.frequency === "daily";
  day = day || todayUB();
  $("report-date").value = day;
  show("report-date-wrap", isDaily);
  const ackData = isDaily ? ackRes.data.filter((a) => a.sign_date === day) : ackRes.data;
  const acks = new Map(ackData.map((a) => [a.user_id, a]));
  const aud = d.kind === "commute" ? null : (d.audience && d.audience.length ? d.audience : null);
  const rows = profRes.data
    .filter((p) => {
      if (d.kind === "commute") {
        const r = routeMap.get(p.id);
        return (r && r.mode === d.commute_mode) || acks.has(p.id);
      }
      if (d.target_users && d.target_users.length) return d.target_users.includes(p.id) || acks.has(p.id);
      return !aud || groupsOf(p).some((g) => aud.includes(g)) || acks.has(p.id);
    })
    .map((p) => ({
      name: p.full_name,
      group: groupsOf(p).join(", "),
      route: routeMap.get(p.id) || null,
      position: p.position || "",
      ack: acks.get(p.id) || null
    }));
  rows.sort((a, b) => (a.ack ? 1 : 0) - (b.ack ? 1 : 0) || a.name.localeCompare(b.name, "mn"));
  currentReport = { doc: d, rows };

  const signed = rows.filter((r) => r.ack).length;
  $("report-title").textContent = d.title + (isDaily ? " — " + day : "");
  $("report-summary").textContent =
    `${d.kind === "commute" ? "Тээврийн хэлбэр: " + (MODES[d.commute_mode] || "") + ". " : ""}${aud ? "Хамрах бүлэг: " + aud.join(", ") + ". " : ""}Нийт ${rows.length} ажилтнаас ${signed} нь гарын үсэг зурсан, ${rows.length - signed} нь зураагүй.`;
  const body = $("report-body");
  body.replaceChildren();
  rows.forEach((r, i) => {
    const sig = r.ack && r.ack.signature ? el("img", { class: "sig", src: r.ack.signature, alt: "гарын үсэг" }) : "";
    body.append(
      el("tr", {},
        el("td", {}, i + 1),
        el("td", {}, r.name),
        el("td", {}, r.group),
        el("td", {}, r.route ? `${MODES[r.route.mode] || ""}, ${fmtKm(r.route.distance_m)}, ${r.route.duration_min} мин` : ""),
        el("td", {}, r.position),
        el("td", {}, el("span", { class: "badge " + (r.ack ? "ok" : "no") }, r.ack ? "Зурсан" : "Зураагүй")),
        el("td", {}, r.ack ? fmtDate(r.ack.signed_at) : ""),
        el("td", {}, sig)
      )
    );
  });
  show("view-report");
  $("view-report").scrollIntoView({ behavior: "smooth" });
}

let dailyData = null;

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function showDaily() {
  const day = $("daily-date").value || todayLocal();
  const start = new Date(day + "T00:00:00"); // хэрэглэгчийн цагийн бүс
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  setMsg("msg-global", "");
  const [profRes, ackRes, docRes] = await Promise.all([
    sb.from("profiles").select("id, full_name, position, staff_group, staff_groups").eq("school_id", me.school_id).order("full_name"),
    sb.from("acknowledgements").select("*").gte("signed_at", start.toISOString()).lt("signed_at", end.toISOString()).order("signed_at"),
    sb.from("documents").select("id, title, kind").eq("school_id", me.school_id)
  ]);
  const err = profRes.error || ackRes.error || docRes.error;
  if (err) { setMsg("msg-global", translateError(err), "error"); return; }
  await resolveSignatures(ackRes.data);
  const docs = new Map(docRes.data.map((d) => [d.id, d]));
  const usedIds = [...new Set(ackRes.data.map((a) => a.document_id))];
  const cols = usedIds.map((id) => docs.get(id)).filter(Boolean)
    .sort((a, b) => (a.kind === "commute" ? -1 : 0) - (b.kind === "commute" ? -1 : 0));
  const byUser = new Map();
  for (const a of ackRes.data) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
    byUser.get(a.user_id).set(a.document_id, a);
  }
  const signedProfiles = profRes.data.filter((p) => byUser.has(p.id));
  const missing = profRes.data.filter((p) => !byUser.has(p.id));
  dailyData = { day, cols, rows: signedProfiles.map((p) => ({ p, acks: byUser.get(p.id) })), missing };

  $("daily-title").textContent = `Өдрийн нэгдсэн тайлан: ${day}`;
  $("daily-summary").textContent = `${school ? school.name + ". " : ""}Нийт ${profRes.data.length} ажилтнаас ${signedProfiles.length} нь зааварчилгаа авсан, ${missing.length} нь аваагүй. Зааварчилгааны тоо: ${cols.length}.`;
  const head = $("daily-head");
  head.replaceChildren(el("tr", {},
    el("th", {}, "#"), el("th", {}, "Овог нэр"), el("th", {}, "Бүлэг"),
    ...cols.map((c) => el("th", {}, c.title)),
    el("th", {}, "Гарын үсэг")));
  const body = $("daily-body");
  body.replaceChildren();
  dailyData.rows.forEach((r, i) => {
    const first = [...r.acks.values()][0];
    body.append(el("tr", {},
      el("td", {}, i + 1), el("td", {}, r.p.full_name), el("td", {}, groupsOf(r.p).join(", ")),
      ...cols.map((c) => {
        const ak = r.acks.get(c.id);
        return el("td", {}, ak ? el("span", { class: "badge ok" }, new Date(ak.signed_at).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })) : el("span", { class: "badge no" }, "—"));
      }),
      el("td", {}, el("img", { class: "sig", src: first.signature, alt: "гарын үсэг" }))));
  });
  $("daily-missing").textContent = missing.length ? missing.map((p) => p.full_name + (groupsOf(p).length ? " (" + groupsOf(p).join(", ") + ")" : "")).join(", ") : "Бүгд зааварчилгаа авсан.";
  show("view-report", false);
  show("view-qr", false);
  show("view-daily");
  $("view-daily").scrollIntoView({ behavior: "smooth" });
}

function downloadDailyCsv() {
  if (!dailyData) return;
  const { cols, rows, day, missing } = dailyData;
  const lines = [["#", "Овог нэр", "Бүлэг", ...cols.map((c) => c.title)].map(csvCell).join(",")];
  rows.forEach((r, i) => lines.push([i + 1, r.p.full_name, groupsOf(r.p).join(", "),
    ...cols.map((c) => { const ak = r.acks.get(c.id); return ak ? fmtDate(ak.signed_at) : ""; })].map(csvCell).join(",")));
  lines.push("");
  lines.push(["Аваагүй ажилтнууд", ...missing.map((p) => p.full_name)].map(csvCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `habea-udriin-tailan-${day}.csv` });
  document.body.append(a); a.click(); a.remove();
}

function csvCell(v) {
  let s = String(v ?? "");
  // Excel-д томьёо болгон ажиллахаас сэргийлнэ
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCsv() {
  if (!currentReport) return;
  const lines = [["#", "Овог нэр", "Бүлэг", "Зам (тээвэр, зай, хугацаа)", "Албан тушаал", "Төлөв", "Огноо"].map(csvCell).join(",")];
  currentReport.rows.forEach((r, i) => {
    lines.push(
      [i + 1, r.name, r.group, r.route ? `${MODES[r.route.mode] || ""}, ${fmtKm(r.route.distance_m)}, ${r.route.duration_min} мин` : "", r.position, r.ack ? "Зурсан" : "Зураагүй", r.ack ? fmtDate(r.ack.signed_at) : ""]
        .map(csvCell).join(",")
    );
  });
  // BOM нэмснээр Excel монгол үсгийг зөв уншина
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "habea-tailan.csv" });
  document.body.append(a);
  a.click();
  a.remove();
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error) {
    setMsg("msg-login", translateError(error), "error");
    return;
  }
  await route();
});
$("form-doc").addEventListener("submit", onCreateDoc);
$("btn-school-qr").addEventListener("click", showSchoolQr);
$("btn-doc-cancel").addEventListener("click", endEdit);
$("btn-loc-me").addEventListener("click", useMyLocForSchool);
$("btn-save-loc").addEventListener("click", saveSchoolLoc);
$("btn-loc-search").addEventListener("click", searchSchoolLoc);
$("loc-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchSchoolLoc(); } });
$("doc-kind").addEventListener("change", () => {
  const k = $("doc-kind").value;
  show("mode-wrap", k === "commute");
  show("target-wrap", k === "trip");
  show("aud-wrap", k !== "trip");
  $("doc-freq").value = (k === "daily" || k === "commute") ? "daily" : "once";
});
$("report-date").addEventListener("change", () => currentReport && showReport(currentReport.doc, $("report-date").value));
$("daily-date").value = todayLocal();
$("btn-daily").addEventListener("click", showDaily);
$("btn-daily-csv").addEventListener("click", downloadDailyCsv);
$("btn-daily-print").addEventListener("click", () => window.print());
$("btn-daily-close").addEventListener("click", () => show("view-daily", false));
$("btn-csv").addEventListener("click", downloadCsv);
$("btn-print").addEventListener("click", () => window.print());
$("btn-print-qr").addEventListener("click", () => window.print());
$("btn-close-report").addEventListener("click", () => show("view-report", false));
$("btn-close-qr").addEventListener("click", () => show("view-qr", false));
$("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  await route();
});

route();
