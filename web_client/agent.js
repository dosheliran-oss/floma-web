// Floma - the agent's isolated network on the web (Step 66): a port of pc_companion/agent_network.py's failover for
// the browser - Tier 1 the user's free Cloudflare relay (relay/cloudflare_worker.js, X-Floma-Relay-Key), then Tier 3
// a one-off direct request (no cookies, no referrer, no cache). A browser can't use a SOCKS proxy or Tor, so Tier 2 is
// the PC's alone. A restricted (❌) site is refused before any tier. The shared "agent_network" cases in
// persona_cases.json pin the failover decision to the desktop's (persona-tests/check_web_agent.js).
(function () {
  "use strict";

  const STORE = "floma.agentRelay"; // {url, key} - stays in this browser only, like the Gemini key
  const UPSTREAM_STATUS = "X-Floma-Upstream-Status";
  const FINAL_URL = "X-Floma-Final-Url";
  const TIMEOUT_MS = 15000;
  const state = { lastTier: null, lastAttempts: [] };

  function relays() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      return saved && typeof saved.url === "string" && saved.url.startsWith("https://") ? [saved] : [];
    } catch (e) {
      return [];
    }
  }

  function setRelay(url, key) {
    const clean = String(url || "").trim();
    if (!clean.startsWith("https://")) throw new Error("https only");
    localStorage.setItem(STORE, JSON.stringify({ url: clean, key: String(key || "") }));
  }

  function clearRelay() {
    localStorage.removeItem(STORE);
  }

  const label = (url) => {
    try {
      return new URL(url).hostname || "relay";
    } catch (e) {
      return "relay";
    }
  };

  /** Why this answer moves on to the next tier ("relay_401", "http_429"...), or null to keep it. */
  function shouldFailOver(response) {
    if (response.relayError) return `relay_${response.status}`;
    if (response.status === 429 || response.status >= 500) return `http_${response.status}`;
    return null;
  }

  function errorKind(error) {
    const text = String((error && (error.name + " " + error.message)) || "");
    return /abort|timeout|timed out/i.test(text) ? "timeout" : "network";
  }

  /** [tier, label, async call] in order → {response | null, attempts}. A blocked error stops every tier. */
  async function runTiers(tiers) {
    const attempts = [];
    for (const [tier, endpoint, call] of tiers) {
      let response;
      try {
        response = await call();
      } catch (e) {
        if (e && e.blocked) throw e;
        attempts.push({ tier, endpoint, ok: false, error: errorKind(e) });
        continue;
      }
      const reason = shouldFailOver(response);
      if (reason) {
        attempts.push({ tier, endpoint, ok: false, error: reason });
        continue;
      }
      attempts.push({ tier, endpoint, ok: true, error: null });
      return { response, attempts };
    }
    return { response: null, attempts };
  }

  function blocked(host) {
    const error = new Error("restricted");
    error.blocked = true;
    error.host = host;
    return error;
  }

  async function withTimeout(fetcher, url, init, ms) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ms);
    try {
      return await fetcher(url, { ...init, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET [url] as text through the first tier that answers. Throws for a restricted site or when every tier fails. */
  async function fetchText(url, options = {}) {
    const fetcher = options.fetcher || ((u, i) => fetch(u, i));
    const isBlocked = options.blockedHost || ((h) => window.FlomaLauncher.blockedHost(h));
    const host = new URL(url).hostname;
    if (isBlocked(host)) throw blocked(host);
    const ms = options.timeoutMs || TIMEOUT_MS;
    const tiers = (options.relays || relays()).map((relay) => ["relay", label(relay.url), async () => {
      const r = await withTimeout(fetcher, relay.url, {
        method: "POST", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", "X-Floma-Relay-Key": relay.key || "" },
        body: JSON.stringify({ url, method: "GET", headers: { Accept: "application/json, text/plain, */*" } }),
      }, ms);
      const upstream = r.headers.get(UPSTREAM_STATUS);
      if (upstream === null) return { status: r.status, text: "", url, tier: "relay", relayError: true };
      return { status: Number(upstream), text: await r.text(), url: r.headers.get(FINAL_URL) || url, tier: "relay" };
    }]);
    tiers.push(["direct", "direct", async () => {
      const r = await withTimeout(fetcher, url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }, ms);
      return { status: r.status, text: r.status < 400 ? await r.text() : "", url: r.url || url, tier: "direct" };
    }]);
    const { response, attempts } = await runTiers(tiers);
    state.lastAttempts = attempts;
    state.lastTier = response ? response.tier : null;
    if (!response) {
      const error = new Error("every network tier failed");
      error.attempts = attempts;
      throw error;
    }
    const finalHost = new URL(response.url || url).hostname;
    if (isBlocked(finalHost)) throw blocked(finalHost);
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    return response.text;
  }

  /** GET <relay>/health with the key: true when the relay answers "ok". */
  async function health(relay, fetcher) {
    const f = fetcher || ((u, i) => fetch(u, i));
    try {
      const r = await withTimeout(f, `${relay.url.replace(/\/+$/, "")}/health`,
        { cache: "no-store", credentials: "omit", headers: { "X-Floma-Relay-Key": relay.key || "" } }, 8000);
      return r.status === 200;
    } catch (e) {
      return false;
    }
  }

  /** The shared decision over fake tiers (persona_cases.json "agent_network", platform "web"). */
  async function simulate(scenario) {
    const call = (outcome, tier) => async () => {
      if (outcome === "timeout") throw new Error("timed out");
      if (outcome === "network") throw new Error("unreachable");
      if (outcome.startsWith("relay_")) return { status: Number(outcome.slice(6)), tier, relayError: true };
      return { status: outcome === "ok" ? 200 : Number(outcome), tier };
    };
    const tiers = (scenario.relays || []).map((o, i) => ["relay", `relay${i + 1}`, call(o, "relay")]);
    tiers.push(["direct", "direct", call(scenario.direct || "ok", "direct")]);
    const { response, attempts } = await runTiers(tiers);
    return { tier: response ? response.tier : null, status: response ? response.status : null, attempts };
  }

  window.FlomaAgent = {
    fetchText, runTiers, shouldFailOver, simulate, relays, setRelay, clearRelay, health,
    lastTier: () => state.lastTier, lastAttempts: () => state.lastAttempts.slice(),
  };
})();
