/*
 * Floma web client - the "Custom query sites" list and when a question is about them.
 *
 * The same rules as the desktop engine (pc_companion/site_query.py): a question that names one of the
 * user's sites (by its name, its host or its label, e.g. "ynet") goes to it; a general lookup ("search
 * for...", "חפש") goes to the sites only when Gemini isn't available. A browser can't read other sites
 * itself (they don't allow it), so the web app only tells the user that the desktop app does this.
 */
(function () {
  "use strict";

  const TWO_LEVEL = ["co.il", "org.il", "ac.il", "gov.il", "net.il", "muni.il", "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "co.jp"];
  const PREFIXES = "והבלמשכ";
  const MAX_SITES = 3;
  const config = () => window.FLOMA_PLATFORM.site_query;

  /** A site as an http(s) URL ("ynet.co.il" → "https://ynet.co.il"), keeping {q}; null if it isn't one. */
  function normalize(url) {
    let text = String(url || "").trim();
    if (!text || /\s/.test(text)) return null;
    if (!text.includes("://")) text = `https://${text}`;
    let parsed;
    try {
      parsed = new URL(text.replace("{q}", "Q"));
    } catch (e) {
      return null;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".") || parsed.username || parsed.password) return null;
    return text;
  }

  function host(url) {
    try {
      const name = new URL(url.replace("{q}", "Q")).hostname.toLowerCase();
      return name.startsWith("www.") ? name.slice(4) : name;
    } catch (e) {
      return "";
    }
  }

  function label(url) {
    const parts = host(url).split(".");
    if (parts.length >= 3 && TWO_LEVEL.includes(parts.slice(-2).join("."))) return parts[parts.length - 3];
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  }

  /** The stored list: [{url, name}], valid and unique, at most site_query.max_sites. */
  function clean(entries) {
    const seen = new Set();
    const result = [];
    for (let entry of entries || []) {
      if (typeof entry === "string") entry = { url: entry };
      if (!entry || typeof entry !== "object") continue;
      const url = normalize(entry.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      result.push({ url, name: String(entry.name || "").trim() });
    }
    return result.slice(0, config().max_sites);
  }

  const plain = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu, " ").split(/\s+/).filter(Boolean).join(" ");

  function targeted(question, sites) {
    const padded = ` ${plain(question)} `;
    return sites.filter((site) => [host(site.url), label(site.url), plain(site.name)].filter(Boolean).some((name) =>
      padded.includes(` ${name} `) || [...PREFIXES].some((p) => padded.includes(` ${p}${name} `))
      || (name.length > 3 && padded.includes(name))));
  }

  function wantsLookup(question) {
    const text = ` ${String(question || "").toLowerCase()} `;
    return config().lookup_words.some((w) => text.includes(` ${w}`));
  }

  /** Which sites a question goes to (none = the normal chat path). */
  function plan(question, entries, cloudAvailable) {
    const sites = clean(entries);
    if (!sites.length) return [];
    const named = targeted(question, sites);
    if (named.length) return named.slice(0, MAX_SITES);
    return wantsLookup(question) && !cloudAvailable ? sites.slice(0, MAX_SITES) : [];
  }

  window.FlomaSites = { normalize, clean, host, label, targeted, wantsLookup, plan };
})();
