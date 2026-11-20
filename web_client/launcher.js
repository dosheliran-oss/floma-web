/*
 * Floma web client - the legal Smart Query Launcher for the restricted (❌) catalog sites.
 *
 * A port of pc_companion/launcher.py with the same tables and regular expressions (persona/sites_catalog.js,
 * rules.launcher), pinned by the shared "sites.launches" cases. It never contacts a restricted site: it
 * reads the details out of the question (name, city, street, phone; product; book; flight) and builds the
 * site's official link, which the user opens in their own browser.
 */
(function () {
  "use strict";

  const Catalog = window.FlomaCatalog;
  const L = () => window.FLOMA_SITES.rules.launcher;
  const sites = () => window.FLOMA_SITES.sites;
  const WORD = "\\p{L}\\p{N}_";

  /** A Python pattern (shared) as a JavaScript one: Unicode \w, no escapes that "u" mode rejects. */
  function convert(source) {
    let out = "";
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === "\\") {
        const next = source[i + 1];
        i++;
        if (next === "w") out += inClass ? WORD : `[${WORD}]`;
        else if (next === "W") out += inClass ? "" : `[^${WORD}]`;
        else if (next === '"' || next === "'") out += next;
        else out += ch + next;
        continue;
      }
      if (ch === "[" && !inClass) inClass = true;
      else if (ch === "]" && inClass) inClass = false;
      out += ch;
    }
    return out;
  }

  const patterns = {};
  function pattern(name, global = false) {
    const key = name + (global ? "/g" : "");
    if (!patterns[key]) {
      const p = L().patterns[name];
      patterns[key] = new RegExp(convert(p.source), `u${p.ignore_case ? "i" : ""}${global ? "g" : ""}`);
    }
    return patterns[key];
  }

  // (no "\-" outside a class: "u" mode rejects it, and "-" needs no escape there)
  const esc = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = (body, flags = "u") => new RegExp(`(?<![${WORD}])${body}(?![${WORD}])`, flags);
  const isAlnum = (ch) => /[\p{L}\p{N}]/u.test(ch);
  const isAscii = (text) => /^[\x00-\x7F]*$/.test(text);
  const stripChars = (w) => w.replace(/^[?!.,:;"']+|[?!.,:;"']+$/g, "");
  const title = (text) => text.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  function padded(question) {
    return ` ${String(question).toLowerCase().split(/\s+/).filter(Boolean).join(" ")} `;
  }

  function mentions(text, phrase) {
    return word(`[והבלמשכ]?${esc(phrase.toLowerCase())}`).test(text);
  }

  /** people | shopping | flights | books, or null. */
  function kindOf(question) {
    const p = padded(question);
    const named = Catalog.restrictedNamed(question);
    if (named.length) return named[0].launcher_kind;
    if (pattern("PHONE").test(question) && [" של מי ", " מי ", " whose ", " who "].some((w) => p.includes(w))) return "people";
    for (const kind of ["books", "people", "flights", "shopping"]) {
      if (L().triggers[kind].some((t) => mentions(p, t))) {
        if (kind === "shopping" && L().book_words.some((w) => mentions(p, w))) return "books";
        return kind;
      }
    }
    return null;
  }

  function findPlace(text, places) {
    let best = null;
    const lower = text.toLowerCase();
    const sorted = [...places].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    for (const name of sorted) {
      for (const prefix of ["", "ב", "מ", "ל", "ו", "וב", "ומ", "ול", "in ", "from ", "to "]) {
        const i = lower.indexOf(prefix + name);
        if (i >= 0 && (i === 0 || !isAlnum(lower[i - 1])) && (best === null || i < best[1])) best = [name, i];
      }
    }
    return best;
  }

  function dateOf(text, today) {
    let y, m, d;
    const iso = pattern("DATE_ISO").exec(text);
    if (iso) {
      [y, m, d] = iso.slice(1, 4).map(Number);
    } else {
      const dmy = pattern("DATE_DMY").exec(text);
      if (!dmy) return "";
      d = Number(dmy[1]);
      m = Number(dmy[2]);
      y = dmy[3] ? Number(dmy[3]) : today.getFullYear();
      if (y < 100) y += 2000;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1) return "";
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function namesOf(site) {
    return new Set([...Catalog.siteNames(site), ...site.keywords.map((k) => k.toLowerCase())]);
  }

  function subject(question, kind) {
    let text = question;
    for (const site of sites()) {
      if (site.connectable) continue;
      for (const name of namesOf(site)) {
        text = text.replace(word(esc(name), "giu"), " ");
        text = text.replace(word(`[בל]${esc(name)}`, "giu"), " ");
      }
    }
    const triggers = [...L().triggers[kind], ...L().triggers.shopping].sort((a, b) => b.length - a.length);
    for (const trigger of triggers) text = text.replace(word(esc(trigger), "giu"), " ");
    const filler = new Set(L().filler);
    const books = new Set(L().book_words);
    return text.split(/\s+/).map(stripChars).filter((w) => w && !filler.has(w.toLowerCase()) && !books.has(w.toLowerCase())).join(" ");
  }

  /** The structured details of [question] for a [kind] lookup (launcher.extract). */
  function extract(question, kind, today = new Date()) {
    if (kind === "shopping") return { product: subject(question, kind) };
    if (kind === "books") return { book: subject(question, kind) };
    const places = L().places;
    if (kind === "flights") {
      const flight = pattern("FLIGHT").exec(question) || pattern("FLIGHT_AFTER_WORD").exec(question);
      const found = { flight: flight ? `${flight[1]}${flight[2]}`.toUpperCase() : "" };
      let origin = "";
      let destination = "";
      const en = /from\s+([a-z' ]+?)\s+to\s+([a-z' ]+?)(?:\s+on|\s+\d|\s*$|[?.,])/i.exec(question);
      if (en) {
        origin = en[1].trim().toLowerCase();
        destination = en[2].trim().toLowerCase();
      } else {
        for (const name of Object.keys(places).sort((a, b) => b.length - a.length)) {
          if (!origin && word(`מ${esc(name)}`).test(question)) origin = name;
          if (!destination && word(`ל${esc(name)}`).test(question)) destination = name;
        }
      }
      found.origin = places[origin] ? places[origin][1] : (origin ? title(origin) : "");
      found.destination = places[destination] ? places[destination][1] : (destination ? title(destination) : "");
      found.date = dateOf(question, today);
      found._origin = origin;
      found._destination = destination;
      return found;
    }
    // people
    const phoneMatch = pattern("PHONE").exec(question);
    const phone = phoneMatch ? phoneMatch[0].replace(/\s/g, "") : "";
    let text = question;
    for (const part of question.match(pattern("PHONE", true)) || []) text = text.replace(new RegExp(esc(part), "giu"), " ");
    let street = "";
    const he = pattern("STREET_HE").exec(text);
    const en = he ? null : pattern("STREET_EN").exec(text);
    if (he) {
      street = [he[1].trim(), he[2] || ""].filter(Boolean).join(" ");
      text = `${text.slice(0, he.index)} ${text.slice(he.index + he[0].length)}`;
    } else if (en) {
      street = [(en[1] || "").trim(), en[2].trim()].filter(Boolean).join(" ");
      text = `${text.slice(0, en.index)} ${text.slice(en.index + en[0].length)}`;
    }
    const place = findPlace(text, L().israeli_cities);
    let city = "";
    if (place) {
      city = isAscii(place[0]) ? places[place[0]][1] : place[0];
      text = text.replace(new RegExp(`(?:\\b(?:in|from)\\s+)?[במלו]?${esc(place[0])}`, "giu"), " ");
    }
    for (const trigger of [...L().triggers.people].sort((a, b) => b.length - a.length)) {
      text = text.replace(word(esc(trigger), "giu"), " ");
    }
    for (const site of sites()) {
      if (site.launcher_kind !== "people") continue;
      for (const name of namesOf(site)) text = text.replace(word(`[בל]?${esc(name)}`, "giu"), " ");
    }
    const filler = new Set(L().filler);
    const words = text.split(/\s+/).map(stripChars).filter((w) => w && !filler.has(w.toLowerCase()) && !/^\d+$/.test(w));
    return { first_name: words[0] || "", last_name: words.slice(1, 3).join(" "), city, street, phone };
  }

  const code = (place) => (L().places[place] ? L().places[place][0] || "" : "");

  /** The site's official deep link, or its official search page (launcher.link_for). */
  function linkFor(site, fields) {
    const template = site.launcher_url_template;
    const q = ["product", "book"].map((k) => fields[k]).filter(Boolean).join(" ");
    const originCode = code(fields._origin || "");
    const destinationCode = code(fields._destination || "");
    let flightsQuery = "";
    if (fields.origin && fields.destination) {
      flightsQuery = `Flights from ${fields.origin} to ${fields.destination}${fields.date ? ` on ${fields.date}` : ""}`;
    }
    const values = {
      q, flight: fields.flight || "", date: fields.date || "",
      date_yymmdd: fields.date ? fields.date.replace(/-/g, "").slice(2) : "",
      origin_code: originCode.toLowerCase(), destination_code: destinationCode.toLowerCase(),
      ORIGIN_CODE: originCode, DESTINATION_CODE: destinationCode, flights_query: flightsQuery,
    };
    if (template) {
      const needed = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const optional = new Set(["date", "date_yymmdd"]);
      if (needed.every((n) => values[n] || optional.has(n))) {
        let uri = template;
        for (const name of needed) uri = uri.replace(`{${name}}`, Catalog.quote(values[name] || "", ""));
        uri = uri.replace(/(?<!:)\/{2,}/g, "/");
        if (!values.date && template.endsWith("{date}")) uri = uri.replace(/\/+$/, "");
        return { title: site.name, uri, site: site.id, deep: true };
      }
    }
    return { title: site.name, uri: site.url, site: site.id, deep: false };
  }

  function text(launch, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const t = L().text;
    const lines = [t.badge[lang], "", t.intro[lang], ""];
    const shown = Object.entries(launch.fields).filter(([, v]) => v);
    if (shown.length) {
      lines.push(t.summary[lang]);
      for (const [k, v] of shown) lines.push(`${L().labels[k][lang]}: ${v}`);
    } else {
      lines.push(t.no_details[lang]);
    }
    return lines.join("\n");
  }

  function sources(launch, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    return launch.links.map((l) => ({ title: l.title + (l.deep ? "" : ` ${L().text.form_note[lang]}`), uri: l.uri }));
  }

  /** The launcher's answer, or null when [question] isn't a lookup on a restricted site. */
  function plan(question, today = new Date()) {
    const kind = kindOf(question);
    if (!kind) return null;
    const fields = extract(question, kind, today);
    const named = Catalog.restrictedNamed(question).filter((s) => s.launcher_kind === kind);
    let chosen = named;
    if (!named.length) {
      let key = kind;
      if (kind === "people" && fields.phone && !fields.first_name) key = "people_phone";
      if (kind === "flights" && fields.flight) key = "flights_number";
      chosen = L().defaults[key].map((id) => sites().find((s) => s.id === id));
    }
    const publicFields = Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith("_")));
    const launch = { kind, fields: publicFields, links: chosen.slice(0, L().max_links).map((s) => linkFor(s, fields)) };
    launch.text = (language) => text(launch, language);
    launch.sources = (language) => sources(launch, language);
    return launch;
  }

  // --- The guard: restricted domains are never contacted ---

  function family(host) {
    const parts = host.toLowerCase().split(".");
    const two = ["co.il", "org.il", "gov.il", "ac.il", "net.il", "co.uk", "com.au"];
    if (parts.length >= 3 && two.includes(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  }

  const hostOf = (address) => {
    try {
      return new URL(address.replace(/[{}]/g, "")).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  };

  function blockedHost(host) {
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    if (!h) return false;
    const allowed = new Set();
    for (const s of sites().filter((x) => x.connectable)) {
      for (const a of [s.url, s.query_template || "", window.FLOMA_SITES.rules.top_headlines]) {
        const x = hostOf(a.replace("{q}", "q"));
        if (x) allowed.add(x);
      }
    }
    if (allowed.has(h)) return false;
    const families = new Set();
    for (const s of sites().filter((x) => !x.connectable)) {
      for (const a of [s.url, s.launcher_url_template || ""]) {
        const x = hostOf(a);
        if (x) families.add(family(x));
      }
    }
    return families.has(family(h));
  }

  window.FlomaLauncher = { plan, kindOf, extract, linkFor, blockedHost, convert };
})();
