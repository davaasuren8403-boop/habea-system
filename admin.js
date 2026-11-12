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
    sb.from("profiles").select("id, full_name, staff_group").eq("school_id", me.school_id).order("full_name")
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
        el("td", {}, p.staff_group || ""),
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
    .from("profiles").select("id, full_name, position, staff_group").eq("school_id", me.school_id).order("full_name");
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  const list = $("staff-list");
  list.replaceChildren();
  for (const p of data) {
    const sel = el("select", { style: "max-width:220px" },
      el("option", { value: "" }, "— бүлэггүй —"),
      ...STAFF_GROUPS.map((g) => el("option", { value: g }, g)));
    sel.value = p.staff_group || "";
    sel.addEventListener("change", async () => {
      const { error: e2 } = await sb.rpc("set_staff_group", { p_user: p.id, p_group: sel.value });
      setMsg("msg-global", e2 ? translateError(e2) : "Бүлэг хадгалагдлаа.", e2 ? "error" : "");
    });
    list.append(
      el("div", { class: "doc-item" },
        el("div", {}, el("strong", {}, p.full_name), el("div", { class: "muted" }, p.position || "")),
        sel)
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
            fmtDate(d.created_at) + (d.deadline ? " · хугацаа: " + d.deadline : "") + (d.kind === "commute" ? " · гэр–ажлын зам: " + (MODES[d.commute_mode] || "") : d.audience && d.audience.length ? " · " + d.audience.join(", ") : " · бүх ажилтан") + (d.image_url ? " · постертой" : "") + (d.active ? "" : " · идэвхгүй"))
        ),
        el("div", { class: "row", style: "margin:0" },
          el("button", { type: "button", onclick: () => showQr(d) }, "QR"),
          el("button", { type: "button", class: "secondary", onclick: () => showReport(d) }, "Тайлан"),
          el("button", { type: "button", class: "secondary", onclick: () => toggleActive(d) },
            d.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх")
        )
      )
    );
  }
}

async function toggleActive(d) {
  const { error } = await sb.from("documents").update({ active: !d.active }).eq("id", d.id);
  if (error) setMsg("msg-global", translateError(error), "error");
  await loadDocs();
}

async function uploadPoster(file) {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) throw new Error("Зураг 2 МБ-аас их байна.");
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  if (!ext) throw new Error("Зөвхөн PNG, JPG, WebP зураг оруулна уу.");
  const path = `${me.school_id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("posters").upload(path, file, { contentType: file.type });
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
  const kind = $("doc-kind").value;
  const payload = {
    kind,
    commute_mode: kind === "commute" ? $("doc-mode").value : null,
    image_url: imageUrl,
    school_id: me.school_id,
    title: $("doc-title").value.trim(),
    body: $("doc-body").value,
    deadline: $("doc-deadline").value || null,
    audience: [...document.querySelectorAll("#doc-audience input:checked")].map((i) => i.value)
  };
  if (!payload.audience.length) payload.audience = null;
  const { error } = await sb.from("documents").insert(payload);
  if (error) {
    setMsg("msg-doc", translateError(error), "error");
    return;
  }
  $("form-doc").reset();
  buildAudience();
  setMsg("msg-doc", "Хадгалагдлаа.");
  await loadDocs();
}

function docUrl(d) {
  return new URL("index.html?doc=" + encodeURIComponent(d.id), location.href).href;
}

function showQr(d) {
  show("view-report", false);
  const url = docUrl(d);
  $("qr-title").textContent = d.title;
  $("qr").replaceChildren();
  new QRCode($("qr"), { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
  $("qr-link").textContent = url;
  show("view-qr");
  $("view-qr").scrollIntoView({ behavior: "smooth" });
}

async function showReport(d) {
  show("view-qr", false);
  const [profRes, ackRes] = await Promise.all([
    sb.from("profiles").select("id, full_name, position, staff_group").eq("school_id", me.school_id).order("full_name"),
    sb.from("acknowledgements").select("*").eq("document_id", d.id)
  ]);
  if (profRes.error || ackRes.error) {
    setMsg("msg-global", translateError(profRes.error || ackRes.error), "error");
    return;
  }
  const acks = new Map(ackRes.data.map((a) => [a.user_id, a]));
  const aud = d.kind === "commute" ? null : (d.audience && d.audience.length ? d.audience : null);
  const rows = profRes.data
    .filter((p) => {
      if (d.kind === "commute") {
        const r = routeMap.get(p.id);
        return (r && r.mode === d.commute_mode) || acks.has(p.id);
      }
      return !aud || aud.includes(p.staff_group) || acks.has(p.id);
    })
    .map((p) => ({
      name: p.full_name,
      group: p.staff_group || "",
      route: routeMap.get(p.id) || null,
      position: p.position || "",
      ack: acks.get(p.id) || null
    }));
  rows.sort((a, b) => (a.ack ? 1 : 0) - (b.ack ? 1 : 0) || a.name.localeCompare(b.name, "mn"));
  currentReport = { doc: d, rows };

  const signed = rows.filter((r) => r.ack).length;
  $("report-title").textContent = d.title;
  $("report-summary").textContent =
    `${d.kind === "commute" ? "Тээврийн хэлбэр: " + (MODES[d.commute_mode] || "") + ". " : ""}${aud ? "Хамрах бүлэг: " + aud.join(", ") + ". " : ""}Нийт ${rows.length} ажилтнаас ${signed} нь гарын үсэг зурсан, ${rows.length - signed} нь зураагүй.`;
  const body = $("report-body");
  body.replaceChildren();
  rows.forEach((r, i) => {
    const sig = r.ack ? el("img", { class: "sig", src: r.ack.signature, alt: "гарын үсэг" }) : "";
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
$("btn-save-loc").addEventListener("click", saveSchoolLoc);
$("doc-kind").addEventListener("change", () => show("mode-wrap", $("doc-kind").value === "commute"));
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
