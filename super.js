// Супер админ: сургууль нэмэх, лиценз, ажилтны хязгаар, сургуулийн админ томлох
let editing = null;

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
  const { data: ok, error } = await sb.rpc("am_super_admin");
  if (error || !ok) {
    setMsg("msg-global", "Энэ хаяг супер админ эрхгүй байна.", "error");
    return;
  }
  show("view-main");
  await loadSchools();
}

function licenseBadge(s) {
  const today = new Date().toISOString().slice(0, 10);
  if (!s.active) return el("span", { class: "badge no" }, "Идэвхгүй");
  if (s.expires_at && s.expires_at < today) return el("span", { class: "badge no" }, "Дууссан " + s.expires_at);
  return el("span", { class: "badge ok" }, s.expires_at ? "Хүртэл " + s.expires_at : "Хугацаагүй");
}

async function loadSchools() {
  const { data, error } = await sb.rpc("super_school_stats");
  if (error) {
    setMsg("msg-global", translateError(error), "error");
    return;
  }
  const body = $("school-body");
  body.replaceChildren();
  if (!data.length) {
    body.append(el("tr", {}, el("td", { colspan: "7", class: "muted" }, "Сургууль байхгүй байна.")));
    return;
  }
  for (const s of data) {
    body.append(
      el("tr", {},
        el("td", {}, el("strong", {}, s.name), s.contact ? el("div", { class: "muted" }, s.contact) : ""),
        el("td", {}, s.join_code),
        el("td", {}, `${s.staff_count} / ${s.staff_limit}` + (s.admin_count ? "" : " (админгүй)")),
        el("td", {}, s.doc_count),
        el("td", {}, s.ack_count),
        el("td", {}, licenseBadge(s)),
        el("td", {}, el("button", { type: "button", class: "secondary", onclick: () => openEdit(s) }, "Засах"))
      )
    );
  }
}

function openEdit(s) {
  editing = s;
  $("edit-title").textContent = s.name;
  $("e-active").checked = s.active;
  $("e-expires").value = s.expires_at || "";
  $("e-limit").value = s.staff_limit;
  $("e-note").value = s.note || "";
  $("a-email").value = "";
  setMsg("msg-edit", "");
  show("view-edit");
  $("view-edit").scrollIntoView({ behavior: "smooth" });
}

function parseLimit(v) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function onCreate(e) {
  e.preventDefault();
  const { data, error } = await sb.rpc("super_create_school", {
    p_name: $("s-name").value,
    p_expires: $("s-expires").value || null,
    p_limit: parseLimit($("s-limit").value) || 50,
    p_contact: $("s-contact").value
  });
  if (error) {
    setMsg("msg-school", translateError(error), "error");
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  $("form-school").reset();
  $("s-limit").value = "50";
  setMsg("msg-school", "Үүслээ. Сургуулийн код: " + (row ? row.join_code : "(жагсаалтаас харна уу)"));
  await loadSchools();
}

async function onEdit(e) {
  e.preventDefault();
  const { error } = await sb.rpc("super_update_school", {
    p_id: editing.id,
    p_active: $("e-active").checked,
    p_expires: $("e-expires").value || null,
    p_limit: parseLimit($("e-limit").value),
    p_note: $("e-note").value
  });
  if (error) {
    setMsg("msg-edit", translateError(error), "error");
    return;
  }
  setMsg("msg-edit", "Хадгалагдлаа.");
  await loadSchools();
}

async function onAdmin(e) {
  e.preventDefault();
  const { error } = await sb.rpc("super_set_school_admin", {
    p_school: editing.id,
    p_email: $("a-email").value
  });
  if (error) {
    setMsg("msg-edit", translateError(error), "error");
    return;
  }
  $("a-email").value = "";
  setMsg("msg-edit", "Админ болголоо.");
  await loadSchools();
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
$("form-school").addEventListener("submit", onCreate);
$("form-edit").addEventListener("submit", onEdit);
$("form-admin").addEventListener("submit", onAdmin);
$("btn-edit-cancel").addEventListener("click", () => show("view-edit", false));
$("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  await route();
});

route();
