/*
 * Floma web client - the assistant's semantic memory, shared with the phone and the PC.
 *
 * Same Firebase Realtime Database, node format and merge rule as Android (RemoteMemory.kt) and the
 * desktop app (memory_sync.py): under memory_sync.root ("floma/memory"), one small JSON node per
 * category, {"facts": [...], "updated_at": <ms>, "device": "web"} (Core.memoryNode). Only extracted
 * facts go there, never the conversation. It's reached through the REST API with the database URL
 * and secret from Settings.
 * The local copy in localStorage is the fallback cache: when Firebase is offline, rate-limited or
 * not set up, the assistant keeps using it and the chat never sees an error. Failures back off (5, 10,
 * 20, 40 minutes, then hourly); changes that couldn't be pushed stay queued.
 */
(function () {
  "use strict";

  const Core = window.FlomaCore;
  const DEVICE = "web";
  const PULL_INTERVAL_MS = 10 * 60 * 1000;
  const RECENT_WINDOW = 20;
  const MEMORY_BATCH = 10;
  const RETRYABLE = ["NETWORK", "SERVER", "RATE_LIMITED"];
  const DB_HOSTS = [".firebaseio.com", ".firebasedatabase.app"];
  const STORE = { cache: "floma.memory", secret: "floma.firebaseSecret" };

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

  /**
   * The database URL as https://<name>.firebaseio.com (or ...firebasedatabase.app), without a trailing
   * slash or ".json"; null for anything else, so the secret is never sent elsewhere (memory_sync.py).
   */
  function normalizeDbUrl(url) {
    let text = String(url || "").trim().replace(/\/+$/, "");
    if (text.endsWith(".json")) text = text.slice(0, -5).replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(text);
    } catch (e) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !DB_HOSTS.some((h) => host.endsWith(h)) || parsed.pathname.replace(/\//g, "")
        || parsed.search || parsed.hash) return null;
    return `https://${host}`;
  }

  // --- Firebase Realtime Database client (REST; same calls as memory_sync.py / FirebaseMemoryService.kt) ---

  function client(url, secret) {
    const base = normalizeDbUrl(url);
    if (!base) throw new SyncError("BAD_URL");
    const root = window.FLOMA_PLATFORM.memory_sync.root;
    const pinnedRoot = window.FLOMA_PLATFORM.chat_sessions.pinned_root;
    const at = (...parts) => parts.map((p) => String(p).split("/").map(encodeURIComponent).join("/")).join("/");
    async function call(method, body, path = root) {
      // The legacy database secret goes in the auth parameter (the REST API's way for it).
      const address = `${base}/${path}.json?auth=${encodeURIComponent(secret)}`;
      let response;
      try {
        response = await fetch(address, {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch (e) {
        throw new SyncError("NETWORK"); // never the URL: it holds the secret
      }
      const text = await response.text();
      if (!response.ok) {
        const s = response.status;
        throw new SyncError(s === 401 || s === 403 ? "AUTH" : s === 404 ? "NOT_FOUND" : s === 429 ? "RATE_LIMITED"
          : s >= 500 || s === 423 ? "SERVER" : "UNKNOWN", `HTTP ${s}`);
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch (e) {
        throw new SyncError("UNKNOWN", "not JSON");
      }
    }
    return {
      async getMemory() {
        const data = await call("GET");
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
      },
      async putCategories(nodes) {
        await call("PATCH", nodes);
      },
      // Step 70: pinned chats, whole, under chat_sessions.pinned_root/<persona>/<chat id>.
      async getPinned() {
        const data = await call("GET", undefined, at(pinnedRoot));
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
      },
      async putPinned(who, id, node) {
        await call(node ? "PUT" : "DELETE", node || undefined, at(pinnedRoot, who, id));
      },
      // Step 73: a synced setting ({value, updated_at, device}) at its own path, e.g. floma/settings/voice_preset.
      async getNode(nodePath) {
        return call("GET", undefined, at(...nodePath.split("/")));
      },
      async putNode(nodePath, node) {
        await call("PUT", node, at(...nodePath.split("/")));
      },
    };
  }

  const fact = (line) => line.trim().replace(/^(- |\* |\u2022 )/, "").trim();

  /** A summary without topics: its new lines go into the catch-all topic (memory_sync.summary_category). */
  function summaryAsSections(summary, previous) {
    const key = window.FLOMA_PLATFORM.memory_sync.summary_category || "notes";
    const known = new Set(Object.values(previous).flatMap((n) => (n || "").split("\n")).map(fact).filter(Boolean));
    const fresh = (summary || "").split("\n").map(fact).filter((f) => f && !known.has(f)).map((f) => `- ${f}`);
    const merged = { ...previous };
    if (fresh.length) merged[key] = unionNotes(previous[key] || "", fresh.join("\n"));
    return merged;
  }

  /** A category's notes from both sides on first connect: the database's lines, then this device's others. */
  function unionNotes(remote, local) {
    const lines = (text) => (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const seen = new Set(lines(remote));
    return [...lines(remote), ...lines(local).filter((l) => !seen.has(l))].join("\n");
  }

  /** Same rule as Android and the desktop: unpushed local edits win, else the remote node wins. */
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
    lastError: null, lastSync: 0, lastSaved: 0,
  }, read(STORE.cache, {}));
  const savedListeners = []; // called after facts reached Firebase (the chat's "saved" toast)
  let busy = Promise.resolve(); // one sync job at a time
  let dbUrl = () => null;

  const save = () => write(STORE.cache, state);
  const secret = () => read(STORE.secret, null);
  const serial = (job) => (busy = busy.then(job, job).catch(() => {}));
  const configured = () => Boolean(normalizeDbUrl(dbUrl()) && (secret() || "").trim());

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
    return configured() && Date.now() >= state.nextAttempt ? client(dbUrl(), secret().trim()) : null;
  }

  /** The pull itself: { remote: the categories that exist remotely, changed } or null if nothing was pulled. */
  async function pullOnce(force) {
    const api = available();
    if (!api || (!force && Date.now() - state.lastPull < PULL_INTERVAL_MS)) return null;
    try {
      const nodes = await api.getMemory();
      const remote = {};
      for (const c of window.FLOMA_PLATFORM.memory_categories) {
        if (c.key in nodes) remote[c.key] = Core.notesFromNode(nodes[c.key]);
      }
      const merged = mergeRemote(state.sections, remote, Object.keys(state.pending));
      const changed = JSON.stringify(merged) !== JSON.stringify(state.sections);
      state.sections = merged;
      state.lastPull = Date.now();
      succeeded();
      save();
      return { remote: Object.keys(remote), changed };
    } catch (e) {
      failed(e);
      return null;
    }
  }

  async function pullNow(force) {
    const pulled = await pullOnce(force);
    return Boolean(pulled && pulled.changed);
  }

  async function pushNow() {
    const pending = { ...state.pending };
    if (!Object.keys(pending).length) return 0;
    const api = available();
    if (!api) return 0;
    const now = Date.now();
    const nodes = {};
    for (const [key, notes] of Object.entries(pending)) nodes[key] = Core.memoryNode(key, notes, now, DEVICE);
    try {
      await api.putCategories(nodes);
    } catch (e) {
      failed(e);
      return 0;
    }
    for (const [key, notes] of Object.entries(pending)) {
      if (state.pending[key] === notes) delete state.pending[key]; // unless re-queued with newer notes
    }
    succeeded();
    state.lastSaved = Date.now();
    save();
    const count = Object.keys(nodes).length;
    for (const listener of savedListeners) {
      try { listener(count); } catch (e) { console.error(e); }
    }
    return count;
  }

  /** Summarizes [batch] into the notes and queues the changed categories; false if the model failed. */
  async function summarizeIntoNotes(batch, summarize) {
    await pullNow(true); // build on what the other devices learned
    const previous = { ...state.sections };
    let result;
    try {
      result = await summarize(state.summary || null, previous, batch.map((m) => ({ role: m.role, text: m.text })));
    } catch (e) {
      return false; // no model right now: retried later
    }
    if (!result.summary.trim()) return false;
    // A topic left blank keeps its facts (a small model skipping it must never wipe them), and a reply
    // with no topics at all still saves its facts, in the catch-all topic (memory_sync.py does the same).
    const given = Object.fromEntries(Object.entries(result.sections || {}).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v.trim()]));
    const kept = Object.fromEntries(Object.entries(previous).filter(([, v]) => v && v.trim()));
    const sections = Object.keys(given).length ? { ...kept, ...given } : summaryAsSections(result.summary, previous);
    // Queued for Firebase only when it's set up; before that the notes stay local (the first connect merges them).
    if (configured()) for (const [key, notes] of Object.entries(sections)) if (previous[key] !== notes) state.pending[key] = notes;
    Object.assign(state, { summary: result.summary, sections, coveredTs: Math.max(state.coveredTs, batch[batch.length - 1].ts) });
    save();
    return true;
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
    if (!(await summarizeIntoNotes(batch, summarize))) return false;
    await pushNow();
    return batch[batch.length - 1].ts;
  }

  /**
   * A chat that ended: everything in it that isn't in the notes yet (not only the older messages) is
   * summarized into facts, saved in the local notes and queued for Firebase (pushed now when it can
   * be). True once the facts are safe in the notes (or there was nothing new to learn), so the chat
   * may be deleted later; false if the model couldn't summarize it (no key, offline). [since] as in foldNow.
   */
  async function distillNow(messages, summarize, since = state.coveredTs) {
    const fresh = messages.filter((m) => !m.local && m.ts && m.ts > since);
    if (fresh.length >= 2 && !(await summarizeIntoNotes(fresh, summarize))) return false;
    await pushNow();
    return true;
  }

  /**
   * New credentials: skip the backoff and merge both sides. A category only this browser has is uploaded;
   * one on both sides keeps the database's facts plus this browser's others (nothing is overwritten).
   */
  async function syncNowJob() {
    state.nextAttempt = 0;
    const before = { ...state.sections };
    const pulled = await pullOnce(true);
    if (pulled) {
      for (const [key, notes] of Object.entries(before)) {
        if (key in state.pending || !notes.trim()) continue;
        if (!pulled.remote.includes(key)) {
          state.pending[key] = notes; // only this browser has it: upload
          continue;
        }
        const merged = unionNotes(state.sections[key], notes);
        if (merged !== (state.sections[key] || "")) {
          state.sections[key] = merged;
          state.pending[key] = merged;
        }
      }
      save();
    }
    await pushNow();
  }

  /** App start: always pulls (no pull interval, no old backoff), then pushes what's still queued. */
  async function refreshOnStartJob() {
    if (!configured()) return false;
    state.nextAttempt = 0;
    const pulled = await pullOnce(true);
    await pushNow();
    return Boolean(pulled);
  }

  /**
   * The chat's "סיכום שיחה" button (Step 70): a thorough pass over the whole conversation (not only what's new
   * since the last checkpoint), merged into the notes and pushed. "done" | "empty" | "failed" (no model now).
   */
  async function summarizeChatJob(messages, summarize) {
    const chat = messages.filter((m) => !m.local && m.ts && m.text && m.text.trim());
    if (chat.length < 2) return "empty";
    if (!(await summarizeIntoNotes(chat, summarize))) return "failed";
    await pushNow();
    return "done";
  }

  /**
   * "סיכום זיכרון": the user's own edit of one topic (Step 70). Saved locally at once and pushed to Firebase when
   * it's connected; an empty list removes the topic (an empty node in Firebase). False for an unknown topic.
   */
  async function setFactsJob(key, list) {
    if (!window.FLOMA_PLATFORM.memory_categories.some((c) => c.key === key)) return false;
    const seen = new Set();
    const clean = [];
    for (const line of list) {
      const f = fact(String(line).replace(/\s+/g, " "));
      if (f && !seen.has(f)) { seen.add(f); clean.push(f); }
    }
    const notes = clean.slice(0, window.FLOMA_PLATFORM.memory_sync.max_facts).map((f) => `- ${f}`).join("\n");
    if ((state.sections[key] || "") === notes) return true;
    if (notes) state.sections[key] = notes;
    else delete state.sections[key];
    if (configured()) state.pending[key] = notes; // before Firebase is set up the edit stays local
    save();
    await pushNow();
    return true;
  }

  async function editFactJob(key, index, text) {
    const list = facts()[key] || [];
    if (index < 0 || index >= list.length) return false;
    list[index] = text;
    return setFactsJob(key, list.filter((f) => f.trim()));
  }

  async function deleteFactJob(key, index) {
    const list = facts()[key] || [];
    if (index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    return setFactsJob(key, list);
  }

  async function addFactJob(text, key) {
    const note = String(text || "").replace(/\s+/g, " ").trim();
    if (!note) return false;
    const topic = key || window.FLOMA_PLATFORM.memory_sync.summary_category || "notes";
    return setFactsJob(topic, [...(facts()[topic] || []), note]);
  }

  /**
   * Every pinned chat in Firebase ({persona: {id: node}}), or null when it can't be read right now. The memory's
   * backoff is respected, but a pinned-chat failure never changes it (the facts keep syncing; this is retried
   * on the next start, pin or sync).
   */
  async function fetchPinnedJob() {
    const api = available();
    if (!api) return null;
    try {
      return await api.getPinned();
    } catch (e) {
      return null;
    }
  }

  /** Uploads one pinned chat (node null: removes it); false when it couldn't be written (retried later). */
  async function putPinnedJob(who, id, node) {
    const api = available();
    if (!api) return false;
    try {
      await api.putPinned(who, id, node);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Step 73: a synced setting's node, or null (none yet, or unreachable); never touches the memory's backoff. */
  async function fetchNodeJob(nodePath) {
    const api = available();
    if (!api) return null;
    try {
      const node = await api.getNode(nodePath);
      return node && typeof node === "object" && !Array.isArray(node) ? node : null;
    } catch (e) {
      return null;
    }
  }

  /** Uploads a synced setting's node; false when it couldn't be written (the next start or change retries). */
  async function putNodeJob(nodePath, node) {
    const api = available();
    if (!api) return false;
    try {
      await api.putNode(nodePath, node);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** The saved facts by category key (Settings → "סיכום זיכרון"). */
  function facts() {
    const result = {};
    for (const [key, notes] of Object.entries(state.sections)) {
      const list = Core.memoryNode(key, notes, 0, DEVICE).facts;
      if (list.length) result[key] = list;
    }
    return result;
  }

  window.FlomaMemory = {
    normalizeDbUrl,
    setDatabaseUrl(fn) { dbUrl = fn; },
    /** What goes inside the prompt's <memory> block (always the local copy). */
    notes: () => Core.memoryNotes(state.sections, state.summary),
    status: () => {
      const all = facts();
      return { configured: configured(), lastSync: state.lastSync, lastError: state.lastError,
        pending: Object.keys(state.pending).length, topics: Object.keys(all).length,
        facts: Object.values(all).reduce((n, list) => n + list.length, 0), lastSaved: state.lastSaved };
    },
    facts,
    pendingKeys: () => Object.keys(state.pending),
    onSaved(listener) { savedListeners.push(listener); },
    refreshOnStart: () => serial(refreshOnStartJob),
    hasSecret: () => !!secret(),
    setSecret(value) { write(STORE.secret, value ? value.trim() : null); },
    pull: (force = false) => serial(() => pullNow(force)),
    push: () => serial(pushNow),
    fold: (messages, summarize, since) => serial(() => foldNow(messages, summarize, since)),
    distill: (messages, summarize, since) => serial(() => distillNow(messages, summarize, since)),
    syncNow: () => serial(syncNowJob),
    summarizeChat: (messages, summarize) => serial(() => summarizeChatJob(messages, summarize)),
    setFacts: (key, list) => serial(() => setFactsJob(key, list)),
    editFact: (key, index, text) => serial(() => editFactJob(key, index, text)),
    deleteFact: (key, index) => serial(() => deleteFactJob(key, index)),
    addFact: (text, key) => serial(() => addFactJob(text, key)),
    configured: () => configured(),
    fetchPinned: () => serial(fetchPinnedJob),
    putPinned: (who, id, node) => serial(() => putPinnedJob(who, id, node)),
    fetchNode: (nodePath) => serial(() => fetchNodeJob(nodePath)),
    putNode: (nodePath, node) => serial(() => putNodeJob(nodePath, node)),
    /** "Delete all chats": the chats go, the facts stay (here and in Firebase); only the bookmark resets. */
    forgetLocal() { state.coveredTs = 0; save(); },
    _mergeRemote: mergeRemote,
  };
})();
