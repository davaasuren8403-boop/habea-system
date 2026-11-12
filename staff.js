// Ажилтны хуудас: QR уншуулсны дараа нээгдэнэ (index.html?doc=<id>)
const docId = new URLSearchParams(location.search).get("doc");
let authMode = "login";
let pad = null;
let currentUser = null;
let currentDoc = null;
let currentProfile = null;
let currentSchool = null;
let routeMap = null;
let homePoint = null;
let hasRoute = false;
let bundleDocs = [];
let bundlePad = null;

function hideViews() {
  for (const id of ["view-auth", "view-join", "view-doc", "view-home", "view-route", "view-bundle"]) show(id, false);
}

async function route() {
  hideViews();
  setMsg("msg-global", "");
  if (!sb) {
    setMsg("msg-global", "config.js дотор Supabase тохиргоог бөглөөгүй байна.", "error");
    return;
  }
  const { data } = await sb.auth.getSession();
  const session = data.session;
  show("btn-logout", !!session);
  if (!session) {
    show("view-auth");
    return;
  }
  currentUser = session.user;
  const { data: profile, error } = await sb
    .from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  if (!profile) {
    show("view-join");
    return;
  }
  currentProfile = profile;
  if (!docId) {
    await loadHome();
    return;
  }
  await loadDoc();
}

// ---- Нүүр: миний зам + миний зааварчилгаанууд ----
async function loadHome() {
  const [routeRes, schoolRes] = await Promise.all([
    sb.from("commute_routes").select("*").eq("user_id", currentUser.id).maybeSingle(),
    sb.from("schools").select("work_lat, work_lng, work_name").eq("id", currentProfile.school_id).maybeSingle()
  ]);
  currentSchool = schoolRes.data;
  hasRoute = !!routeRes.data;
  if (!routeRes.data) {
    showRouteSetup(false);
    return;
  }
  const r = routeRes.data;
  $("route-summary").textContent =
    `${MODES[r.mode] || r.mode} · ойролцоогоор ${fmtKm(r.distance_m)} · ${r.duration_min} минут`;
  show("view-home");
  await loadMyDocs(r);
}

async function loadMyDocs(route) {
  const box = $("my-docs");
  box.replaceChildren();
  const { data: docs, error } = await sb
    .from("documents").select("id, title, audience, kind, commute_mode, active")
    .eq("active", true).order("created_at", { ascending: false });
  if (error) {
    box.append(el("p", { class: "muted" }, translateError(error)));
    return;
  }
  const mine = docs.filter((d) => {
    if (d.kind === "commute") return d.commute_mode === route.mode;
    return !d.audience || !d.audience.length || d.audience.includes(currentProfile.staff_group);
  });
  const { data: acks } = await sb.from("acknowledgements").select("document_id").eq("user_id", currentUser.id);
  const signed = new Set((acks || []).map((a) => a.document_id));
  if (!mine.length) {
    box.append(el("p", { class: "muted" }, "Танд хамаарах зааварчилгаа одоогоор алга."));
    return;
  }
  bundleDocs = mine.filter((d) => !signed.has(d.id));
  show("bundle-cta", bundleDocs.length >= 2);
  if (bundleDocs.length >= 2) $("btn-bundle").textContent = `Зураагүй ${bundleDocs.length} зааврыг нэг дор унших, нэг гарын үсэг зурах`;
  // Гэр–ажлын зам эхэндээ
  mine.sort((a, b) => (a.kind === "commute" ? -1 : 0) - (b.kind === "commute" ? -1 : 0));
  for (const d of mine) {
    const done = signed.has(d.id);
    box.append(
      el("div", { class: "doc-link" },
        el("div", {},
          el("strong", {}, d.title),
          el("div", { class: "muted" }, KIND_LABELS[d.kind] || "Ерөнхий")),
        el("div", { class: "row", style: "margin:0" },
          el("span", { class: "badge " + (done ? "ok" : "no") }, done ? "Зурсан" : "Зураагүй"),
          el("a", { class: "btn", href: "index.html?doc=" + encodeURIComponent(d.id) }, done ? "Харах" : "Унших"))
      )
    );
  }
}

// ---- Маршрут тохируулах (OpenStreetMap) ----
function showRouteSetup(canCancel) {
  setMsg("msg-route", "");
  show("view-home", false);
  show("view-route");
  show("btn-route-cancel", canCancel);
  if (!currentSchool || currentSchool.work_lat == null) {
    setMsg("msg-route", "Сургуулийн байршлыг админ тохируулаагүй байна. Админд хэлнэ үү.", "error");
  }
  const work = currentSchool && currentSchool.work_lat != null
    ? { lat: currentSchool.work_lat, lng: currentSchool.work_lng } : null;
  homePoint = null;
  if (!routeMap) {
    routeMap = makePickMap("map", work ? [work.lat, work.lng] : UB_CENTER, (p) => { homePoint = p; });
  }
  if (work) {
    routeMap.map.setView([work.lat, work.lng], 13);
    routeMap.addFixed(work.lat, work.lng, currentSchool.work_name || "Сургууль");
  }
  setTimeout(() => routeMap.map.invalidateSize(), 150);
}

async function onSearch() {
  const q = $("route-search").value.trim();
  if (!q) return;
  setMsg("msg-route", "Хайж байна...");
  try {
    const found = await geocode(q);
    if (!found.length) {
      setMsg("msg-route", "Хаяг олдсонгүй. Газрын зургаас гараараа товшиж сонгоно уу.", "error");
      return;
    }
    const f = found[0];
    routeMap.map.setView([parseFloat(f.lat), parseFloat(f.lon)], 15);
    setMsg("msg-route", "Олдлоо. Одоо газрын зураг дээр яг гэрийнхээ байршлыг товшино уу.");
  } catch (err) {
    setMsg("msg-route", "Хайлт ажиллахгүй байна. Газрын зургаас гараараа товшиж сонгоно уу.", "error");
  }
}

async function onMyLoc() {
  setMsg("msg-route", "Байршил тодорхойлж байна...");
  try {
    const p = await getMyLocation();
    homePoint = { lat: p.lat, lng: p.lng };
    routeMap.setPoint(p.lat, p.lng);
    routeMap.map.setView([p.lat, p.lng], 15);
    setMsg("msg-route", "Одоогийн байршлыг гэр болгон сонголоо. Буруу бол газрын зураг дээр товшиж засна уу. Хадгалахад зөвхөн ~1 км-ийн нарийвчлалтай бүс хадгална.");
  } catch (err) {
    setMsg("msg-route", err.message, "error");
  }
}

async function onRouteSave(e) {
  e.preventDefault();
  if (!currentSchool || currentSchool.work_lat == null) {
    setMsg("msg-route", "Сургуулийн байршлыг админ тохируулаагүй байна.", "error");
    return;
  }
  if (!homePoint) {
    setMsg("msg-route", "Газрын зураг дээр гэрийнхээ байршлыг товшиж сонгоно уу.", "error");
    return;
  }
  if (!$("route-consent").checked) {
    setMsg("msg-route", "Зөвшөөрлийн нүдийг тэмдэглэнэ үү.", "error");
    return;
  }
  const mode = $("route-mode").value;
  $("btn-route-save").disabled = true;
  setMsg("msg-route", "Маршрут тооцоолж байна...");
  try {
    const work = { lat: currentSchool.work_lat, lng: currentSchool.work_lng };
    const r = await calcRoute(mode, homePoint, work);
    // Яг байршлыг илгээхгүй: ~1 км-ийн нарийвчлалтай болгож хадгална
    const round2 = (x) => Math.round(x * 100) / 100;
    const { error } = await sb.rpc("save_my_route", {
      p_mode: mode,
      p_lat: round2(homePoint.lat),
      p_lng: round2(homePoint.lng),
      p_distance: r.distance_m,
      p_duration: r.duration_min
    });
    if (error) throw error;
    setMsg("msg-route", "");
    await loadHome();
  } catch (err) {
    setMsg("msg-route", translateError(err), "error");
  } finally {
    $("btn-route-save").disabled = false;
  }
}

async function loadDoc() {
  const { data: doc, error } = await sb
    .from("documents").select("*").eq("id", docId).maybeSingle();
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  if (!doc) {
    setMsg("msg-global", "Зааварчилгаа олдсонгүй эсвэл танай сургуульд хамаарахгүй байна.", "error");
    return;
  }
  currentDoc = doc;
  $("doc-title").textContent = doc.title;
  renderRich($("doc-body"), doc.body);
  const aud = doc.audience && doc.audience.length ? "Хамрах бүлэг: " + doc.audience.join(", ") : "";
  const img = $("doc-image");
  if (doc.image_url) {
    img.src = doc.image_url;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }
  show("btn-back", true);
  $("doc-meta").textContent = [doc.deadline ? "Дуусах хугацаа: " + doc.deadline : "", aud].filter(Boolean).join(" · ");
  show("view-doc");

  const { data: ack } = await sb
    .from("acknowledgements").select("signed_at")
    .eq("document_id", doc.id).eq("user_id", currentUser.id).maybeSingle();
  if (ack) {
    show("sign-area", false);
    show("signed-area");
    $("signed-at").textContent = fmtDate(ack.signed_at);
  } else {
    show("signed-area", false);
    show("sign-area");
    if (!pad) pad = new SignaturePad($("sign"));
    else pad.clear();
  }
}

function setAuthMode(mode) {
  authMode = mode;
  $("tab-login").classList.toggle("active", mode === "login");
  $("tab-register").classList.toggle("active", mode === "register");
  $("btn-auth").textContent = mode === "login" ? "Нэвтрэх" : "Бүртгүүлэх";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  setMsg("msg-auth", "");
}

async function onAuth(e) {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  $("btn-auth").disabled = true;
  try {
    if (authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        setMsg("msg-auth", "Бүртгэл үүслээ. Имэйлээ шалгаж баталгаажуулаад дараа нь нэвтэрнэ үү.");
        return;
      }
    }
    await route();
  } catch (err) {
    setMsg("msg-auth", translateError(err), "error");
  } finally {
    $("btn-auth").disabled = false;
  }
}

async function onJoin(e) {
  e.preventDefault();
  const { error } = await sb.rpc("join_school", {
    p_code: $("join-code").value,
    p_name: $("join-name").value,
    p_position: $("join-position").value,
    p_group: $("join-group").value
  });
  if (error) {
    setMsg("msg-join", translateError(error), "error");
    return;
  }
  await route();
}

async function onSubmit() {
  setMsg("msg-sign", "");
  if (!$("agree").checked) {
    setMsg("msg-sign", "Эхлээд «танилцаж, ойлгосон» гэсэн нүдийг тэмдэглэнэ үү.", "error");
    return;
  }
  if (pad.isEmpty()) {
    setMsg("msg-sign", "Гарын үсгээ зурна уу.", "error");
    return;
  }
  $("btn-submit").disabled = true;
  const { error } = await sb.from("acknowledgements").insert({
    document_id: currentDoc.id,
    signature: pad.toDataURL()
  });
  $("btn-submit").disabled = false;
  if (error) {
    setMsg("msg-sign", translateError(error), "error");
    return;
  }
  await loadDoc();
}

// ---- Хэд хэдэн зааврыг нэг гарын үсгээр баталгаажуулах ----
async function openBundle() {
  setMsg("msg-bundle", "");
  const ids = bundleDocs.map((d) => d.id);
  const { data: docs, error } = await sb.from("documents").select("*").in("id", ids);
  if (error) { setMsg("msg-global", translateError(error), "error"); return; }
  const order = new Map(ids.map((id, i) => [id, i]));
  docs.sort((a, b) => order.get(a.id) - order.get(b.id));
  bundleDocs = docs;
  const box = $("bundle-docs");
  box.replaceChildren();
  docs.forEach((d, i) => {
    const body = el("div", { class: "doc-body" });
    renderRich(body, d.body);
    box.append(el("div", { class: "bundle-item" },
      el("h3", {}, `${i + 1}. ${d.title}`),
      el("div", { class: "muted" }, KIND_LABELS[d.kind] || "Ерөнхий"),
      d.image_url ? el("img", { class: "poster", src: d.image_url, alt: "Постер" }) : "",
      body));
  });
  $("bundle-count").textContent = `Нийт ${docs.length} заавар. Бүгдийг уншаад доор нэг удаа гарын үсэг зурна.`;
  $("bundle-agree").checked = false;
  show("view-home", false);
  show("view-bundle");
  if (!bundlePad) bundlePad = new SignaturePad($("bundle-pad"));
  else bundlePad.clear();
  window.scrollTo(0, 0);
}

async function onBundleSubmit() {
  setMsg("msg-bundle", "");
  if (!$("bundle-agree").checked) {
    setMsg("msg-bundle", "Эхлээд «танилцаж, ойлгосон» гэсэн нүдийг тэмдэглэнэ үү.", "error");
    return;
  }
  if (bundlePad.isEmpty()) {
    setMsg("msg-bundle", "Гарын үсгээ зурна уу.", "error");
    return;
  }
  $("btn-bundle-submit").disabled = true;
  const sig = bundlePad.toDataURL();
  const { error } = await sb.from("acknowledgements").insert(bundleDocs.map((d) => ({ document_id: d.id, signature: sig })));
  $("btn-bundle-submit").disabled = false;
  if (error) { setMsg("msg-bundle", translateError(error), "error"); return; }
  show("view-bundle", false);
  await loadHome();
  setMsg("msg-global", "Бүх зааварчилгаанд гарын үсэг амжилттай бүртгэгдлээ. Баярлалаа!");
}

for (const g of STAFF_GROUPS) $("join-group").append(el("option", { value: g }, g));
$("join-group").insertBefore(el("option", { value: "", selected: "selected", disabled: "disabled" }, "Сонгоно уу"), $("join-group").firstChild);

$("form-route").addEventListener("submit", onRouteSave);
$("btn-my-loc").addEventListener("click", onMyLoc);
$("btn-search").addEventListener("click", onSearch);
$("route-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } });
$("btn-change-route").addEventListener("click", () => showRouteSetup(true));
$("btn-route-cancel").addEventListener("click", () => { show("view-route", false); show("view-home"); });
$("btn-bundle").addEventListener("click", openBundle);
$("btn-bundle-back").addEventListener("click", () => { show("view-bundle", false); show("view-home"); });
$("btn-bundle-clear").addEventListener("click", () => bundlePad && bundlePad.clear());
$("btn-bundle-submit").addEventListener("click", onBundleSubmit);
$("btn-back").addEventListener("click", () => { location.href = location.pathname; });

$("tab-login").addEventListener("click", () => setAuthMode("login"));
$("tab-register").addEventListener("click", () => setAuthMode("register"));
$("form-auth").addEventListener("submit", onAuth);
$("form-join").addEventListener("submit", onJoin);
$("btn-clear").addEventListener("click", () => pad && pad.clear());
$("btn-submit").addEventListener("click", onSubmit);
$("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  await route();
});

route();
