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
  await loadDocs();
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
            fmtDate(d.created_at) + (d.deadline ? " · хугацаа: " + d.deadline : "") + (d.active ? "" : " · идэвхгүй"))
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

async function onCreateDoc(e) {
  e.preventDefault();
  const payload = {
    school_id: me.school_id,
    title: $("doc-title").value.trim(),
    body: $("doc-body").value,
    deadline: $("doc-deadline").value || null
  };
  const { error } = await sb.from("documents").insert(payload);
  if (error) {
    setMsg("msg-doc", translateError(error), "error");
    return;
  }
  $("form-doc").reset();
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
    sb.from("profiles").select("id, full_name, position").eq("school_id", me.school_id).order("full_name"),
    sb.from("acknowledgements").select("*").eq("document_id", d.id)
  ]);
  if (profRes.error || ackRes.error) {
    setMsg("msg-global", translateError(profRes.error || ackRes.error), "error");
    return;
  }
  const acks = new Map(ackRes.data.map((a) => [a.user_id, a]));
  const rows = profRes.data.map((p) => ({
    name: p.full_name,
    position: p.position || "",
    ack: acks.get(p.id) || null
  }));
  rows.sort((a, b) => (a.ack ? 1 : 0) - (b.ack ? 1 : 0) || a.name.localeCompare(b.name, "mn"));
  currentReport = { doc: d, rows };

  const signed = rows.filter((r) => r.ack).length;
  $("report-title").textContent = d.title;
  $("report-summary").textContent =
    `Нийт ${rows.length} ажилтнаас ${signed} нь гарын үсэг зурсан, ${rows.length - signed} нь зураагүй.`;
  const body = $("report-body");
  body.replaceChildren();
  rows.forEach((r, i) => {
    const sig = r.ack ? el("img", { class: "sig", src: r.ack.signature, alt: "гарын үсэг" }) : "";
    body.append(
      el("tr", {},
        el("td", {}, i + 1),
        el("td", {}, r.name),
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
  const lines = [["#", "Овог нэр", "Албан тушаал", "Төлөв", "Огноо"].map(csvCell).join(",")];
  currentReport.rows.forEach((r, i) => {
    lines.push(
      [i + 1, r.name, r.position, r.ack ? "Зурсан" : "Зураагүй", r.ack ? fmtDate(r.ack.signed_at) : ""]
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
