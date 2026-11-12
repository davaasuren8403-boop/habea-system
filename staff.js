// Ажилтны хуудас: QR уншуулсны дараа нээгдэнэ (index.html?doc=<id>)
const docId = new URLSearchParams(location.search).get("doc");
let authMode = "login";
let pad = null;
let currentUser = null;
let currentDoc = null;

function hideViews() {
  for (const id of ["view-auth", "view-join", "view-doc"]) show(id, false);
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
  if (!docId) {
    setMsg("msg-global", "Бүртгэл бэлэн боллоо. Зааварчилгааны QR кодыг уншуулж орно уу.");
    return;
  }
  await loadDoc();
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
  $("doc-body").textContent = doc.body;
  $("doc-meta").textContent = doc.deadline ? "Дуусах хугацаа: " + doc.deadline : "";
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
    p_position: $("join-position").value
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
