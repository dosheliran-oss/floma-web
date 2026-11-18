/*
 * Floma web client - Toby's semantic memory, shared with the phone and the PC.
 *
 * Same repository, file format and merge rule as Android (RemoteMemory.kt) and the desktop app
 * (memory_sync.py): one Markdown file per category in the user's private GitHub memory repo.
 * The local copy in localStorage is the fallback cache: when GitHub is offline, rate-limited or not
 * set up, Toby keeps using it and the chat never sees an error. Failures back off (5, 10, 20, 40
 * minutes, then hourly); changes that couldn't be pushed stay queued.
 */
(function () {
  "use strict";

  const Core = window.FlomaCore;
  const API = "https://api.github.com";
  const DEFAULT_REPOSITORY = "Toby-Semantic-Memory";
  const PULL_INTERVAL_MS = 10 * 60 * 1000;
  const RECENT_WINDOW = 20;
  const MEMORY_BATCH = 10;
  const RETRYABLE = ["NETWORK", "SERVER", "RATE_LIMITED"];
  const CODE_MARKERS = ["settings.gradle.kts", "settings.gradle", "build.gradle.kts", "build.gradle", "gradlew", "app",
    "src", "package.json", "pom.xml", "cargo.toml", "go.mod", "pyproject.toml", "setup.py", "requirements.txt", ".github"];
  const STORE = { cache: "floma.memory", token: "floma.githubToken" };

  class SyncError extends Error {
    constructor(kind, detail) {
      super(`${kind}${detail ? `: ${detail}` : ""}`);
      this.kind = kind;
    }
  }

  const backoffMs = (failures) => Math.min(5 * 60 * 1000 * 2 ** Math.max(0, Math.min(failures - 1, 4)), 60 * 60 * 1000);

  function read(name, fallback) {
    try {
      const raw = localStorage.getItem(name);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(name, value) {
    try {
      if (value == null) localStorage.removeItem(name);
      else localStorage.setItem(name, JSON.stringify(value));
    } catch (e) { /* storage blocked: keep going in memory */ }
  }

  // UTF-8 safe base64 (GitHub's contents API).
  const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  // --- GitHub client (same calls as GitHubSyncService.kt) ---

  function client(token) {
    async function call(method, path, body, okStatuses = []) {
      let response;
      try {
        response = await fetch(API + path, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch (e) {
        throw new SyncError("NETWORK", e.message);
      }
      const text = await response.text();
      if (response.ok || okStatuses.includes(response.status)) return { status: response.status, text };
      const s = response.status;
      const kind = s === 401 ? "AUTH"
        : s === 429 || (s === 403 && response.headers.get("x-ratelimit-remaining") === "0") ? "RATE_LIMITED"
          : s === 403 ? "FORBIDDEN" : s === 404 ? "REPO_NOT_FOUND" : s >= 500 ? "SERVER" : "UNKNOWN";
      throw new SyncError(kind, `HTTP ${s}`);
    }
    const encode = (path) => path.split("/").map(encodeURIComponent).join("/");
    const api = {
      async login() {
        return JSON.parse((await call("GET", "/user")).text).login || "";
      },
      async resolveRepo(repository) {
        const parts = repository.trim().replace(/^https:\/\/github\.com\//, "").split("/").filter(Boolean);
        if (parts.length === 1) return `${await api.login()}/${parts[0]}`;
        if (parts.length === 2) return parts.join("/");
        throw new SyncError("REPO_NOT_FOUND", `Bad repository name: ${repository}`);
      },
      async ensureRepo(repo) {
        if ((await call("GET", `/repos/${repo}`, null, [404])).status !== 404) return false;
        const [owner, name] = repo.split("/");
        if (owner.toLowerCase() !== (await api.login()).toLowerCase()) throw new SyncError("REPO_NOT_FOUND");
        const created = await call("POST", "/user/repos", {
          name, private: true, auto_init: true, description: "Toby's semantic memory, synced by the Floma app.",
        }, [404, 422]);
        if (created.status === 404 || created.status === 422) throw new SyncError("REPO_NOT_FOUND");
        return true;
      },
      async looksLikeCode(repo) {
        const res = await call("GET", `/repos/${repo}/contents/`, null, [404]);
        if (res.status === 404) return false;
        return JSON.parse(res.text).some((e) => CODE_MARKERS.includes(String(e.name || "").toLowerCase()));
      },
      async getFile(repo, path) {
        const res = await call("GET", `/repos/${repo}/contents/${encode(path)}`, null, [404]);
        if (res.status === 404) return null;
        const json = JSON.parse(res.text);
        return { sha: json.sha, content: fromBase64(json.content || "") };
      },
      async putFile(repo, path, content, message) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const current = await api.getFile(repo, path);
          if (current && current.content === content) return false;
          const body = { message, content: toBase64(content) };
          if (current) body.sha = current.sha;
          const res = await call("PUT", `/repos/${repo}/contents/${encode(path)}`, body, attempt === 0 ? [409, 422] : []);
          if (res.status >= 200 && res.status < 300) return true;
        }
        throw new SyncError("UNKNOWN", `Couldn't update ${path}`);
      },
    };
    return api;
  }

  /** Same rule as Android and the desktop: unpushed local edits win, else the remote file wins. */
  function mergeRemote(local, remote, unpushed) {
    const merged = {};
    for (const c of window.FLOMA_PLATFORM.memory_categories) {
      const notes = unpushed.includes(c.key) || !(c.key in remote) ? local[c.key] : remote[c.key];
      if (notes && notes.trim()) merged[c.key] = notes.trim();
    }
    return merged;
  }

  // --- The local copy + sync ---

  const state = Object.assign({
    summary: "", sections: {}, coveredTs: 0, pending: {}, lastPull: 0, nextAttempt: 0, failures: 0,
    lastError: null, lastSync: 0,
  }, read(STORE.cache, {}));
  let busy = Promise.resolve(); // one sync job at a time
  let repository = () => DEFAULT_REPOSITORY;

  const save = () => write(STORE.cache, state);
  const token = () => read(STORE.token, null);
  const serial = (job) => (busy = busy.then(job, job).catch(() => {}));

  function failed(error) {
    state.failures += 1;
    state.lastError = error.kind || "UNKNOWN";
    state.nextAttempt = Date.now() + (RETRYABLE.includes(state.lastError) ? backoffMs(state.failures) : 60 * 60 * 1000);
    save();
  }

  function succeeded() {
    Object.assign(state, { failures: 0, nextAttempt: 0, lastError: null, lastSync: Date.now() });
  }

  function available() {
    const t = token();
    return t && Date.now() >= state.nextAttempt ? client(t) : null;
  }

  async function pullNow(force) {
    const api = available();
    if (!api || (!force && Date.now() - state.lastPull < PULL_INTERVAL_MS)) return false;
    try {
      const repo = await api.resolveRepo(repository());
      const remote = {};
      for (const c of window.FLOMA_PLATFORM.memory_categories) {
        const file = await api.getFile(repo, c.file);
        if (file) remote[c.key] = Core.parseMemoryFile(file.content);
      }
      const merged = mergeRemote(state.sections, remote, Object.keys(state.pending));
      const changed = JSON.stringify(merged) !== JSON.stringify(state.sections);
      state.sections = merged;
      state.lastPull = Date.now();
      succeeded();
      save();
      return changed;
    } catch (e) {
      failed(e);
      return false;
    }
  }

  async function pushNow() {
    if (!Object.keys(state.pending).length) return 0;
    const api = available();
    if (!api) return 0;
    try {
      const repo = await api.resolveRepo(repository());
      if (!(await api.ensureRepo(repo)) && (await api.looksLikeCode(repo))) {
        throw new SyncError("NOT_MEMORY_REPO", `${repo} looks like a code repository`);
      }
      const today = new Date().toISOString().slice(0, 10);
      let pushed = 0;
      for (const [key, notes] of Object.entries(state.pending)) {
        const c = window.FLOMA_PLATFORM.memory_categories.find((x) => x.key === key);
        if (await api.putFile(repo, c.file, Core.renderMemoryFile(key, notes, today), `Floma (web): update ${c.file}`)) pushed++;
        delete state.pending[key];
        save();
      }
      succeeded();
      save();
      return pushed;
    } catch (e) {
      failed(e);
      return 0;
    }
  }

  /**
   * Folds a chat's older messages into the notes. [since]: the newest message of this chat already in
   * the notes (each chat session keeps its own); defaults to the newest overall. Resolves to the ts of
   * the newest message folded, or false when nothing was folded.
   */
  async function foldNow(messages, summarize, since = state.coveredTs) {
    const chat = messages.filter((m) => !m.local && m.ts);
    const older = chat.length > RECENT_WINDOW ? chat.slice(0, chat.length - RECENT_WINDOW) : [];
    const batch = older.filter((m) => m.ts > since);
    if (batch.length < MEMORY_BATCH) return false;
    await pullNow(true); // build on what the other devices learned
    const previous = { ...state.sections };
    let result;
    try {
      result = await summarize(state.summary || null, previous, batch.map((m) => ({ role: m.role, text: m.text })));
    } catch (e) {
      return false; // Gemini down / no key: retried after the next reply
    }
    if (!result.summary.trim()) return false;
    const sections = Object.keys(result.sections).length ? result.sections : previous;
    for (const [key, notes] of Object.entries(sections)) if (previous[key] !== notes) state.pending[key] = notes;
    const covered = batch[batch.length - 1].ts;
    Object.assign(state, { summary: result.summary, sections, coveredTs: Math.max(state.coveredTs, covered) });
    save();
    await pushNow();
    return covered;
  }

  /**
   * Ephemeral memory (Toby): folds everything in a session that isn't in the notes yet into the notes
   * (not only the older messages), then pushes them to GitHub. True only when the facts are safely
   * on GitHub (or there was nothing new to learn), so the caller may then clear the session from this
   * browser; false keeps it (not set up, offline, GitHub or Gemini failing). [since] as in foldNow.
   */
  async function distillNow(messages, summarize, since = state.coveredTs) {
    if (!available()) return false;
    const fresh = messages.filter((m) => !m.local && m.ts && m.ts > since);
    if (fresh.length >= 2) {
      await pullNow(true);
      if (state.lastError) return false; // GitHub can't be reached: keep the session
      const previous = { ...state.sections };
      let result;
      try {
        result = await summarize(state.summary || null, previous, fresh.map((m) => ({ role: m.role, text: m.text })));
      } catch (e) {
        return false; // Gemini down / no key
      }
      if (!result.summary.trim()) return false;
      const sections = Object.keys(result.sections).length ? result.sections : previous;
      for (const [key, notes] of Object.entries(sections)) if (previous[key] !== notes) state.pending[key] = notes;
      Object.assign(state, { summary: result.summary, sections, coveredTs: Math.max(state.coveredTs, fresh[fresh.length - 1].ts) });
      save();
    }
    await pushNow();
    return Object.keys(state.pending).length === 0 && !state.lastError;
  }

  window.FlomaMemory = {
    distill: (messages, summarize, since) => serial(() => distillNow(messages, summarize, since)),
    DEFAULT_REPOSITORY,
    setRepository(fn) { repository = fn; },
    /** What goes inside the prompt's <memory> block (always the local copy). */
    notes: () => Core.memoryNotes(state.sections, state.summary),
    status: () => ({ configured: !!token(), lastSync: state.lastSync, lastError: state.lastError,
      pending: Object.keys(state.pending).length }),
    hasToken: () => !!token(),
    setToken(value) { write(STORE.token, value ? value.trim() : null); },
    pull: (force = false) => serial(() => pullNow(force)),
    push: () => serial(pushNow),
    fold: (messages, summarize, since) => serial(() => foldNow(messages, summarize, since)),
    syncNow: () => serial(async () => { state.nextAttempt = 0; await pullNow(true); await pushNow(); }),
    forgetLocal() { Object.assign(state, { summary: "", sections: {}, pending: {}, coveredTs: 0 }); save(); },
    _mergeRemote: mergeRemote,
  };
})();
