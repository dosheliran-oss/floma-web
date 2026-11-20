/*
 * Floma web client - the legal Smart Query Launcher for the restricted (❌) catalog sites.
 *
 * A port of pc_companion/launcher.py with the same tables and regular expressions (persona/sites_catalog.js,
 * rules.launcher), pinned by the shared "sites.launches" cases. It never contacts a restricted site: it
 * reads the details out of the question (name, city, street, phone; product; book; flight) and builds the
 * site's official link, which the user opens in their own browser.
 * A people lookup also gets (Step 56) every Israeli format of the phone number, the name in English letters
 * and cascading search tiers (name + street + city, name + city, name only) with Google search links.
 * Step 57: email lookups (the address, username and domain to copy; a Google search for its public mentions;
 * Have I Been Pwned, Hunter.io, Gravatar) and corporate / professional lookups (רשם החברות, גיידסטאר, LinkedIn).
 * Step 58: a term in quotes is taken exactly as written; buying prompts for Gemini; "can you check phone numbers?".
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
  const stripChars = (w) => w.replace(/^[?!.,:;"'-]+|[?!.,:;"'-]+$/g, "");
  const title = (text) => text.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  function padded(question) {
    return ` ${String(question).toLowerCase().replace(/״/g, '"').split(/\s+/).filter(Boolean).join(" ")} `;
  }

  function mentions(text, phrase) {
    return word(`[והבלמשכ]?${esc(phrase.toLowerCase())}`).test(text);
  }

  /** people | shopping | flights | books | property | email | corporate, or null. */
  function kindOf(question) {
    const p = padded(question);
    const named = Catalog.restrictedNamed(question);
    if (named.length) return named[0].launcher_kind;
    if (pattern("PHONE").test(question) && [" של מי ", " מי ", " whose ", " who "].some((w) => p.includes(w))) return "people";
    if (L().triggers.email.some((t) => mentions(p, t))) return "email";
    if (pattern("EMAIL").test(question) && !L().compose_words.some((w) => mentions(p, w))) return "email";
    for (const kind of ["books", "people", "property", "flights", "shopping", "corporate"]) {
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

  /** The first term in quotes, exactly as written ("" when there's none) (launcher.quoted). */
  function quoted(text) {
    const found = pattern("QUOTED").exec(String(text || ""));
    return found ? found[1].trim() : "";
  }

  function subject(question, kind) {
    const exact = quoted(question);
    if (exact) return exact;
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

  /** {street, city, text without them} - for people lookups and the property portals (launcher._address). */
  function address(start) {
    let text = start;
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
      city = isAscii(place[0]) ? L().places[place[0]][1] : place[0];
      text = text.replace(new RegExp(`(?:\\b(?:in|from)\\s+)?[במלו]?${esc(place[0])}`, "giu"), " ");
    }
    return { street, city, text };
  }

  // --- People: phone formats, English names, search tiers (Step 56) ---

  /** Every standard Israeli way to write [phone] (launcher.phone_formats). */
  function phoneFormats(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return [];
    const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
    let area;
    let rest;
    if (local.length === 10 && "57".includes(local[1])) {
      area = local.slice(0, 3);
      rest = local.slice(3);
    } else if (local.length === 9) {
      area = local.slice(0, 2);
      rest = local.slice(2);
    } else {
      return [phone];
    }
    return [`+972-${area.slice(1)}-${rest}`, `+972${local.slice(1)}`, local, `${area}-${rest}`,
      `${area}-${rest.slice(0, 3)}-${rest.slice(3)}`];
  }

  const hebrew = (text) => /[\u05d0-\u05ea]/.test(text);

  function transliterateWord(word) {
    const t = L().translit;
    if (t.names[word] !== undefined || !hebrew(word)) return t.names[word] !== undefined ? t.names[word] : word;
    const pieces = [];
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      const last = i === word.length - 1;
      const next = last ? "" : word[i + 1];
      let piece;
      if ("וי".includes(ch) && next === ch && i > 0) {
        piece = ch === "ו" ? "v" : "y";
        i++;
      } else if (i === 0 && t.first[ch] !== undefined) {
        piece = t.first[ch];
      } else if (last && t.last[ch] !== undefined) {
        piece = t.last[ch];
      } else {
        piece = t.letters[ch] !== undefined ? t.letters[ch] : ch;
      }
      if (piece && pieces.length && !t.vowels.includes(pieces[pieces.length - 1].slice(-1)) && !t.vowels.includes(piece[0])) {
        pieces.push("a");
      }
      if (piece) pieces.push(piece);
    }
    const out = pieces.join("");
    return out.slice(0, 1).toUpperCase() + out.slice(1);
  }

  /** [name] in English letters ("משה כהן" → "Moshe Cohen"); "" when it has no Hebrew letters. */
  function transliterate(name) {
    if (!hebrew(name)) return "";
    const clean = String(name).replace(/'/g, "").replace(/"/g, "").replace(/״/g, "").replace(/׳/g, "");
    return clean.split(/\s+/).filter(Boolean).map((w) => w.split("-").map(transliterateWord).join("-")).filter(Boolean).join(" ");
  }

  /** The cascading search, narrowest first (launcher.tiers). */
  function tiers(fields) {
    const name = [fields.first_name || "", fields.last_name || ""].filter(Boolean).join(" ");
    if (!name) return [];
    const found = [];
    if (fields.street && fields.city) found.push({ level: 1, query: `${name} ${fields.street} ${fields.city}` });
    if (fields.city) found.push({ level: 2, query: `${name} ${fields.city}` });
    found.push({ level: 3, query: name });
    return found;
  }

  function googleLink(query, title, exact = "") {
    let q = query;
    if (exact && q.includes(exact)) q = q.replace(exact, `"${exact}"`);
    return { title, uri: L().google_search.replace("{q}", Catalog.quote(q, "")), site: "google", deep: true };
  }

  function peopleExtras(launch) {
    const f = launch.fields;
    const t = L().text;
    const name = [f.first_name || "", f.last_name || ""].filter(Boolean).join(" ");
    launch.name_en = transliterate(name);
    launch.phone_formats = phoneFormats(f.phone || "");
    launch.tiers = tiers(f);
    const google = launch.tiers.map((tier) =>
      googleLink(tier.query, `${t.google.HEBREW} · ${tier.level}. ${t[`tier_${tier.level}`].HEBREW}`, name));
    if (launch.name_en) {
      const city = f.city || "";
      const cityEn = L().places[city] ? L().places[city][1] : (isAscii(city) ? city : "");
      const query = [launch.name_en, cityEn].filter(Boolean).join(" ");
      google.push(googleLink(query, `${t.google.HEBREW} · ${t.google_en.HEBREW}: ${query}`, launch.name_en));
    }
    if (launch.phone_formats.length > 1) {
      google.push(googleLink(launch.phone_formats.map((x) => `"${x}"`).join(" OR "), `${t.google.HEBREW} · ${t.google_phone.HEBREW}`));
    }
    launch.links = [...google, ...launch.links];
  }

  /** The structured details of [question] for a [kind] lookup (launcher.extract). */
  function extract(question, kind, today = new Date()) {
    if (kind === "shopping") return { product: subject(question, kind) };
    if (kind === "books") return { book: subject(question, kind) };
    if (kind === "property") {
      const where = address(question);
      return { street: where.street, city: where.city };
    }
    if (kind === "email") {
      const found = pattern("EMAIL").exec(question);
      if (!found) return { email: "", email_user: "", email_domain: "" };
      const user = found[1].toLowerCase();
      const domain = found[2].toLowerCase();
      return { email: `${user}@${domain}`, email_user: user, email_domain: domain };
    }
    if (kind === "corporate") return { name: subject(question, kind) };
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
    let start = question;
    for (const part of question.match(pattern("PHONE", true)) || []) start = start.replace(new RegExp(esc(part), "giu"), " ");
    const where = address(start);
    const { street, city } = where;
    let text = where.text;
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
    const q = ["product", "book", "name"].map((k) => fields[k]).filter(Boolean).join(" ");
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
      address: [fields.street || "", fields.city || ""].filter(Boolean).join(" "),
      domain: fields.email_domain || "",
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
      for (const [k, v] of shown) {
        lines.push(`${L().labels[k][lang]}: ${v}`);
        if (k === "last_name" && launch.name_en) lines.push(`${L().labels.name_en[lang]}: ${launch.name_en}`);
      }
    } else {
      lines.push(t.no_details[lang]);
    }
    if (launch.phone_formats.length > 1) lines.push("", t.phone_formats[lang], ...launch.phone_formats.map((f) => `• ${f}`));
    if (launch.tiers.length) {
      lines.push("", t.tiers[lang]);
      for (const tier of launch.tiers) lines.push(`${tier.level}. ${t[`tier_${tier.level}`][lang]}: ${tier.query}`);
      lines.push(t.tiers_note[lang]);
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
    let key = kind;
    if (kind === "people" && fields.phone && !fields.first_name) key = "people_phone";
    if (kind === "flights" && fields.flight) key = "flights_number";
    let chosen = named;
    if (!named.length || L().fill_kinds.includes(kind)) { // the named directories first, then the kind's others
      const others = L().defaults[key].map((id) => sites().find((s) => s.id === id)).filter((s) => !named.includes(s));
      chosen = [...named, ...others];
    }
    const publicFields = Object.fromEntries(Object.entries(fields).filter(([k]) => !k.startsWith("_")));
    const max = L().max_links_by_kind[kind] || L().max_links;
    const launch = { kind, fields: publicFields, links: chosen.slice(0, max).map((s) => linkFor(s, fields)),
      name_en: "", phone_formats: [], tiers: [] };
    if (kind === "people") peopleExtras(launch);
    if (kind === "email" && fields.email) {
      const t = L().text;
      launch.links = [googleLink(`"${fields.email}"`, `${t.google.HEBREW} · ${t.google_email.HEBREW}`), ...launch.links];
    }
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

  /** Kinds the launcher answers before any catalog source (people/phone, property/address, email, company). */
  const firstKind = (kind) => L().first_kinds.includes(kind);

  /** What Gemini (with Google Search) is asked for a book / product with buying intent (launcher.buy_search_prompt). */
  function buySearchPrompt(question, launch, facts, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const t = L().text;
    const what = t.buy_what[lang][launch.kind];
    const item = launch.fields.book || launch.fields.product || "";
    return t.buy_search[lang].split("{question}").join(question).split("{what_lower}").join(what.toLowerCase())
      .split("{what}").join(what).split("{item}").join(item).split("{facts}").join(facts.join("\n") || t.no_facts[lang]);
  }

  /** The answer to "can you check phone numbers / emails?", or null (launcher.capability_reply). */
  function capabilityReply(question, language) {
    if (pattern("PHONE").test(question) || pattern("EMAIL").test(question) || quoted(question)) return null;
    const c = L().capability;
    const p = padded(question);
    if (!c.ask.some((a) => mentions(p, a)) || !c.topics.some((w) => mentions(p, w))) return null;
    const allowed = new Set([...c.words, ...c.topics].map((w) => w.toLowerCase()));
    for (let w of p.split(" ")) {
      w = w.replace(/^[?!.,:;"'-]+|[?!.,:;"'-]+$/g, "");
      const bare = "והבלמשכ".includes(w[0]) && w.length > 2 ? w.slice(1) : w;
      if (w && !allowed.has(w) && !allowed.has(bare)) return null;
    }
    return L().text.capability[language === "ENGLISH" ? "ENGLISH" : "HEBREW"];
  }

  /** What Gemini (with Google Search) is asked for an email lookup (launcher.email_search_prompt). */
  function emailSearchPrompt(launch, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    return L().text.email_search[lang].replace("{email}", launch.fields.email || "");
  }

  window.FlomaLauncher = { plan, kindOf, extract, linkFor, blockedHost, convert, phoneFormats, transliterate, tiers, firstKind,
    emailSearchPrompt, quoted, buySearchPrompt, capabilityReply, buyKind: (kind) => L().buy_kinds.includes(kind) };
})();
