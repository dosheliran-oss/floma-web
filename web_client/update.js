/*
 * Floma web client - fresh files after every deploy, and a note when a new version was just loaded (Step 59).
 *
 * The published site (web_client/assemble_site.js) stamps every script and stylesheet with ?v=<its hash>, so a
 * browser or GitHub Pages' cache can't serve an old copy next to a new page, and stamps the page with its build:
 *   <meta name="floma-build" content="1.59.0-<engine>-<web hash>">
 * and the same build into persona/version.json ("web_build"). On load the app reads version.json (no-store):
 *   - the page is older than the site (a cached HTML) → reload once, for the new files,
 *   - the page is new to this browser (another build was seen before) → a small "updated to 1.59.0" toast,
 *   - otherwise nothing. Offline, or without a stamp (the repository's own index.html: "dev"), nothing happens.
 * decide() is pure (checked by check_update.js); app.js does the fetch, the reload and the toast.
 */
(function () {
  "use strict";

  /** This page's build ("dev" when it isn't the published, stamped site). */
  function pageBuild(doc = document) {
    const meta = doc.querySelector('meta[name="floma-build"]');
    return meta ? meta.getAttribute("content") || "dev" : "dev";
  }

  /**
   * What to do now: "reload" | "toast" | "none".
   * loaded: this page's build; remote: version.json's web_build (null offline); seen: the build this browser ran last;
   * reloadedFor: the build a reload was already tried for (this tab), so a stubborn cache never loops.
   */
  function decide({ loaded, remote, seen, reloadedFor }) {
    if (!loaded || loaded === "dev") return "none";
    if (remote && remote !== loaded && reloadedFor !== remote) return "reload";
    if (seen && seen !== loaded) return "toast";
    return "none";
  }

  /** "1.59.0-2f78b6d965f0-ab12cd34" → { app: "1.59.0", engine: "2f78b6d965f0" } (dev: empty). */
  function parts(build) {
    const [app = "", engine = ""] = String(build || "").split("-");
    return build && build !== "dev" ? { app, engine } : { app: "", engine: "" };
  }

  /** Whether version [a] is newer than [b] ("1.10.0" > "1.9.9"); invalid versions are never newer. */
  function newer(a, b) {
    const parse = (v) => (/^\d+(\.\d+){0,3}$/.test(String(v || "")) ? String(v).split(".").map(Number) : null);
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return false;
    for (let i = 0; i < 4; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  const api = { pageBuild, decide, parts, newer };
  if (typeof window !== "undefined") window.FlomaUpdate = api;
  if (typeof module !== "undefined") module.exports = api;
})();
