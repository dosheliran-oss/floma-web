/*
 * Floma web client - user accounts (Step 75): "כניסה / פתיחת משתמש חדש" before the chat, the session in this
 * browser, each account's own storage, and the one-time import of the old flat Firebase data.
 *
 *   - Users live in the user's Firebase at accounts.users_root/<user_id> ({user_id, username, display_name, algo,
 *     iterations, salt, hash, created_at}); the password is never stored, only PBKDF2-HMAC-SHA256 of it
 *     (FlomaCore.userRecord / verifyPassword, the same as persona.py and Accounts.kt).
 *   - "floma.account" in localStorage: {session, owner, firebaseUrl}. The browser's first account (the owner) keeps
 *     the data that was here before accounts; every other account's keys are prefixed ("floma.u.<id>.…"), and so is
 *     "no account" once an owner exists ("floma.u._local.…").
 *   - The old flat root (floma/memory, pinned_chats, pending_extractions, settings) is offered once to the first
 *     account that claims it ("ייבוא הנתונים הקיימים לחשבון זה"); nothing there is deleted.
 *
 * Every device reaches Firebase with the database's secret, so accounts keep users apart in the app; they're not a
 * security boundary between people who hold the secret.
 */
(function () {
  "use strict";

  const KEY = "floma.account";
  const SECRET = "floma.firebaseSecret"; // the browser's Firebase secret (memory.js), shared by every account
  const acc = () => window.FLOMA_PLATFORM.accounts;
  const Core = () => window.FlomaCore;

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (e) {
      return {};
    }
  }

  function write(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: the session is lost on reload */ }
  }

  function session() {
    const s = read().session;
    return s && typeof s === "object" && (s.user_id || s.local) ? s : null;
  }

  const userId = () => (session() && session().user_id) || null;
  const isLocal = () => Boolean(session() && session().local);

  /** "" for the browser's first account (and before any account); "u.<id>." for the others. */
  function storagePrefix() {
    const state = read();
    const s = session();
    if (!s || !state.owner) return "";
    if (s.local) return "u._local.";
    return s.user_id === state.owner ? "" : `u.${s.user_id}.`;
  }

  function deviceFirebaseUrl() {
    const state = read();
    if (state.firebaseUrl) return state.firebaseUrl;
    try {
      return (JSON.parse(localStorage.getItem("floma.settings") || "{}") || {}).firebaseUrl || "";
    } catch (e) {
      return "";
    }
  }

  function setFirebaseUrl(url) {
    const state = read();
    state.firebaseUrl = url;
    write(state);
  }

  function signIn(record) {
    const state = read();
    if (!state.owner) state.owner = record.user_id;
    state.session = { user_id: record.user_id, display_name: record.display_name || record.user_id, signed_in_at: Date.now() };
    write(state);
    return state.session;
  }

  function useLocal() {
    const state = read();
    state.session = { local: true };
    write(state);
    return state.session;
  }

  function signOut() {
    const state = read();
    state.session = null;
    write(state);
  }

  // --- Firebase ---

  class AccountError extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
  }

  function firebase(url, secret) {
    const base = window.FlomaMemory.normalizeDbUrl(url);
    if (!base || !String(secret || "").trim()) throw new AccountError("not_configured");
    const at = (path) => path.split("/").map(encodeURIComponent).join("/");
    async function call(method, path, body) {
      let response;
      try {
        response = await fetch(`${base}/${at(path)}.json?auth=${encodeURIComponent(String(secret).trim())}`, {
          method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch (e) {
        throw new AccountError("network");
      }
      if (!response.ok) throw new AccountError("network");
      const text = await response.text();
      try { return text ? JSON.parse(text) : null; } catch (e) { throw new AccountError("network"); }
    }
    return { get: (p) => call("GET", p), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b) };
  }

  async function register(url, secret, username, displayName, password) {
    const id = Core().normalizeUsername(username);
    if (!id) throw new AccountError("username");
    if (!Core().passwordOk(password)) throw new AccountError("password");
    const db = firebase(url, secret);
    const path = `${acc().users_root}/${id}`;
    if ((await db.get(path)) !== null) throw new AccountError("exists");
    const record = await Core().userRecord(id, displayName, password, Core().newSalt(), Date.now());
    await db.put(path, record);
    return record;
  }

  async function login(url, secret, username, password) {
    const id = Core().normalizeUsername(username);
    if (!id) throw new AccountError("credentials");
    const record = await firebase(url, secret).get(`${acc().users_root}/${id}`);
    if (!record || !(await Core().verifyPassword(record, password))) throw new AccountError("credentials");
    return record;
  }

  async function tree(db, uid) {
    const out = {};
    for (const kind of ["memory", "pinned", "queue", "settings"]) out[kind] = (await db.get(Core().userPath(uid, kind))) || {};
    return out;
  }

  async function legacyPending(url, secret) {
    const db = firebase(url, secret);
    if (await db.get(acc().claimed_path)) return false;
    return Core().legacyHasData(await tree(db, null));
  }

  async function importLegacy(url, secret, uid) {
    const db = firebase(url, secret);
    const plan = Core().migrationPlan(await tree(db, null), await tree(db, uid), Date.now(), "web");
    const paths = acc().paths;
    const updates = {};
    for (const [key, node] of Object.entries(plan.memory)) updates[`${paths.memory}/${key}`] = node;
    for (const kind of ["pinned", "queue"]) {
      for (const [who, chats] of Object.entries(plan[kind])) for (const [id, node] of Object.entries(chats)) updates[`${paths[kind]}/${who}/${id}`] = node;
    }
    for (const [name, node] of Object.entries(plan.settings)) updates[`${paths.settings}/${name}`] = node;
    if (Object.keys(updates).length) await db.patch(Core().userRoot(uid), updates);
    await db.put(acc().claimed_path, { user_id: uid, at: Date.now(), device: "web" });
    return plan;
  }

  // --- The sign-in screen ---

  /** Shows "כניסה / פתיחת משתמש חדש" over the page; resolves with the session once signed in (or "no account"). */
  function showLogin(language = "HEBREW") {
    const t = (key, values) => Core().accountText(key, language, values);
    const screen = document.getElementById("loginScreen");
    const $ = (id) => document.getElementById(id);
    screen.hidden = false;
    document.body.classList.add("signed-out");
    $("loginTitle").textContent = t("title");
    $("loginHint").textContent = t("hint");
    $("loginTabLogin").textContent = t("login_tab");
    $("loginTabRegister").textContent = t("register_tab");
    $("loginUsername").placeholder = t("username");
    $("loginPassword").placeholder = t("password");
    $("loginDisplay").placeholder = t("display_name");
    $("loginLocal").textContent = t("local");
    $("loginFirebaseHint").textContent = t("firebase_needed");
    const secretSaved = () => Boolean((localStorage.getItem(SECRET) || "").replace(/"/g, "").trim());
    const needsFirebase = !window.FlomaMemory.normalizeDbUrl(deviceFirebaseUrl()) || !secretSaved();
    $("loginFirebase").hidden = !needsFirebase;
    $("loginUrl").value = deviceFirebaseUrl();
    let mode = "login";
    const setMode = (m) => {
      mode = m;
      $("loginDisplay").hidden = m !== "register";
      $("loginSubmit").textContent = t(m === "register" ? "register" : "login");
      $("loginTabLogin").setAttribute("aria-pressed", String(m === "login"));
      $("loginTabRegister").setAttribute("aria-pressed", String(m === "register"));
      $("loginError").textContent = "";
    };
    setMode("login");
    $("loginTabLogin").onclick = () => setMode("login");
    $("loginTabRegister").onclick = () => setMode("register");
    return new Promise((resolve) => {
      const done = (s) => {
        screen.hidden = true;
        document.body.classList.remove("signed-out");
        resolve(s);
      };
      $("loginLocal").onclick = () => done(useLocal());
      $("loginForm").onsubmit = async (event) => {
        event.preventDefault();
        const url = needsFirebase ? $("loginUrl").value.trim() : deviceFirebaseUrl();
        const secret = needsFirebase ? $("loginSecret").value.trim() : JSON.parse(localStorage.getItem(SECRET) || "null");
        $("loginSubmit").disabled = true;
        try {
          const record = mode === "register"
            ? await register(url, secret, $("loginUsername").value, $("loginDisplay").value, $("loginPassword").value)
            : await login(url, secret, $("loginUsername").value, $("loginPassword").value);
          if (needsFirebase) {
            setFirebaseUrl(window.FlomaMemory.normalizeDbUrl(url) || url);
            localStorage.setItem(SECRET, JSON.stringify(secret));
          }
          const signed = signIn(record);
          try {
            if (await legacyPending(url, secret) && window.confirm(`${t("import_title")}\n\n${t("import_hint")}`)) {
              const plan = await importLegacy(url, secret, record.user_id);
              const state = read();
              state.imported = { facts: plan.facts, pinned: plan.pinned_count };
              write(state);
            }
          } catch (e) { /* no connection: offered again next time */ }
          done(signed);
        } catch (e) {
          $("loginError").textContent = t(`err_${e.kind || "network"}`);
        } finally {
          $("loginSubmit").disabled = false;
        }
      };
    });
  }

  /** Once after the legacy import: {facts, pinned} for the toast. */
  function takeImported() {
    const state = read();
    const imported = state.imported || null;
    if (imported) {
      delete state.imported;
      write(state);
    }
    return imported;
  }

  window.FlomaAccount = {
    session, userId, isLocal, storagePrefix, deviceFirebaseUrl, setFirebaseUrl, signIn, useLocal, signOut,
    register, login, legacyPending, importLegacy, showLogin, takeImported, AccountError,
  };
})();
