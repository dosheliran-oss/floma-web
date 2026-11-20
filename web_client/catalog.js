/*
 * Floma web client - the built-in sites catalog: routing, requests and compact summaries.
 *
 * The same rules as the desktop (pc_companion/sites_catalog.py), from the same data: persona/sites_catalog.js
 * (window.FLOMA_SITES, generated from sites_catalog.json). The shared cases in persona-tests/persona_cases.json
 * ("sites") pin every route, request address, summary and reply to the desktop's.
 *
 * The browser reads the 14 open JSON APIs itself (they allow it - CORS); news (RSS) and web pages can't be
 * read from a browser, so they go to Gemini's Google Search (with the facts already fetched) or wait for
 * the desktop app.
 */
(function () {
  "use strict";

  const data = () => window.FLOMA_SITES;
  const rules = () => data().rules;
  const sites = () => data().sites;
  const connectable = () => sites().filter((s) => s.connectable);

  /** Python's urllib.parse.quote: UTF-8 percent-encoding; letters, digits, "_.-~" and [safe] stay. */
  function quote(text, safe = "/") {
    let out = "";
    for (const byte of new TextEncoder().encode(String(text))) {
      const ch = String.fromCharCode(byte);
      out += /[A-Za-z0-9_.\-~]/.test(ch) || (byte < 128 && safe.includes(ch)) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    return out;
  }

  /** Lowercased words, punctuation as spaces (sites_catalog._plain). */
  function plain(text) {
    return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}_\s'"-]/gu, " ").replace(/״/g, '"')
      .split(/\s+/).filter(Boolean).join(" ");
  }

  function hasPhrase(padded, phrase) {
    const p = plain(phrase);
    if (!p) return false;
    const ambiguous = rules().ambiguous; // "מספר" (number) isn't "מ" + "ספר" (book)
    return padded.includes(` ${p} `) || [...rules().hebrew_prefixes].some((x) => padded.includes(` ${x}${p} `)
      && !ambiguous.includes(x + p));
  }

  /** How a source can be named: id, name, the parts in and out of parentheses, without " API". */
  function siteNames(site) {
    const parts = new Set([site.id, site.name, ...site.name.split(/[()]/)]);
    return new Set([...parts].map((p) => plain(p).replace(/\s+api$/, "")).filter((n) => n.length > 2));
  }

  function named(question, site) {
    const padded = ` ${plain(question)} `;
    return [...siteNames(site)].some((n) => hasPhrase(padded, n));
  }

  function score(question, site) {
    const padded = ` ${plain(question)} `;
    let value = [...siteNames(site)].some((n) => hasPhrase(padded, n)) ? 3 : 0;
    for (const keyword of site.keywords) {
      if (hasPhrase(padded, keyword)) value += keyword.trim().includes(" ") ? 2 : 1;
    }
    return value;
  }

  /** The 0-2 connectable sources [question] goes to, best first (sites_catalog.route). */
  function route(question, wantsLookup, cloudAvailable) {
    const ranked = [];
    for (const site of connectable()) {
      const value = score(question, site);
      if (value <= 0) continue;
      if (named(question, site) || wantsLookup || !cloudAvailable || site.always_local) ranked.push([value, site]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    if (!ranked.length) return [];
    const best = ranked[0][0];
    return ranked.slice(0, rules().max_routed).filter(([value]) => value * 2 >= best).map(([, site]) => site);
  }

  /** ❌ sites the question names, by name or brand keyword. */
  function restrictedNamed(question) {
    const padded = ` ${plain(question)} `;
    return sites().filter((s) => !s.connectable && (named(question, s) || s.keywords.some((k) => hasPhrase(padded, k))));
  }

  function subjectTerms(question, site, others = []) {
    const routing = new Set();
    for (const source of [site, ...others]) {
      for (const phrase of [...source.keywords, source.name, source.id]) plain(phrase).split(" ").forEach((w) => routing.add(w));
    }
    if (others.length) for (const city of Object.keys(rules().cities)) plain(city).split(" ").forEach((w) => routing.add(w));
    const stop = new Set(rules().stopwords);
    const prefixes = rules().hebrew_prefixes;
    const words = [];
    for (const word of plain(question).split(" ").filter(Boolean)) {
      const bare = prefixes.includes(word[0]) && [...word].length > 2 ? word.slice(1) : word;
      if ([...word].length < 2 || stop.has(word) || routing.has(word) || (bare !== word && (routing.has(bare) || stop.has(bare)))) continue;
      words.push(word);
    }
    return words;
  }

  /** The address to fetch for [question], or null (sites_catalog.request_url). */
  function requestUrl(question, site, others = []) {
    if (site.id === "openmeteo") {
      const padded = ` ${plain(question)} `;
      const cities = rules().cities;
      const city = Object.keys(cities).sort((a, b) => b.length - a.length).find((c) => hasPhrase(padded, c));
      const [lat, lon] = city ? cities[city] : [32.08, 34.78];
      return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2";
    }
    const terms = subjectTerms(question, site, others);
    if (site.parser === "rss" && !terms.length) return rules().top_headlines;
    if (site.query_template && terms.length) {
      return site.query_template.replace("{q}", quote(site.id === "pokeapi" ? terms.join("-") : terms.join(" ")));
    }
    if (site.url.includes("{q}")) return terms.length ? site.url.replace("{q}", quote(terms.join(" "))) : null;
    return site.url;
  }

  // --- Compact summaries (the same lines as the desktop) ---

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  const unescape = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e.toLowerCase() in ENTITIES ? ENTITIES[e.toLowerCase()] : m;
  });

  function clip(text, limit = rules().max_field) {
    let t = unescape(String(text == null ? "" : text).replace(/<[^>]+>/g, " ")).split(/\s+/).filter(Boolean).join(" ");
    t = t.replace(/ ([.,;:!?])/g, "$1");
    if (t.length <= limit) return t;
    const cut = t.slice(0, limit);
    const space = cut.lastIndexOf(" ");
    return (space >= 0 ? cut.slice(0, space) : cut) + "…";
  }

  /** A value as text, the same on every platform: whole numbers without ".0", booleans as yes/no. */
  function val(value) {
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  }

  const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length)
    || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
  const fields = (pairs) => pairs.filter(([, v]) => !empty(v)).map(([k, v]) => `${k}: ${val(v)}`).join("; ");
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const or = (v, fallback) => (v == null || v === "" || v === 0 || v === false ? fallback : v); // Python's "x or y"

  function pick(items, terms, text, limit = rules().max_items) {
    let list = arr(items).filter((i) => i && typeof i === "object" && !Array.isArray(i));
    if (terms.length) {
      const hits = list.filter((i) => terms.some((t) => text(i).toLowerCase().includes(t)));
      if (hits.length) list = hits;
    }
    return list.slice(0, limit);
  }

  const PARSERS = {
    pokeapi(d) {
      if ("results" in d) return [`Pokémon (first 60): ${arr(d.results).slice(0, 60).map((r) => r.name).join(", ")}`];
      const stats = arr(d.stats).map((s) => `${s.stat.name} ${s.base_stat}`).join(", ");
      return [fields([["Pokémon", d.name], ["#", d.id], ["types", arr(d.types).map((t) => t.type.name).join(", ")],
        ["height", `${val(or(d.height, 0) / 10)} m`], ["weight", `${val(or(d.weight, 0) / 10)} kg`],
        ["abilities", arr(d.abilities).map((a) => a.ability.name).join(", ")], ["base stats", stats]])];
    },
    tvmaze(d) {
      const shows = Array.isArray(d) ? d.map((x) => ("show" in obj(x) ? x.show : x)) : [];
      return shows.slice(0, 4).map((s) => fields([["Show", s.name], ["premiered", s.premiered], ["ended", s.ended],
        ["status", s.status], ["genres", arr(s.genres).join(", ")], ["rating", obj(s.rating).average],
        ["network", obj(or(s.network, or(s.webChannel, {}))).name], ["summary", clip(s.summary)]]));
    },
    rickandmorty(d, terms) {
      return pick(or(d.results, []), terms, (c) => c.name || "").map((c) => fields([["Character", c.name],
        ["status", c.status], ["species", c.species], ["gender", c.gender], ["origin", obj(c.origin).name],
        ["location", obj(c.location).name], ["episodes", arr(c.episode).length]]));
    },
    themealdb(d) {
      return arr(d.meals).slice(0, 3).map((m) => {
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
          if (String(or(m[`strIngredient${i}`], "")).trim()) {
            ingredients.push(`${String(or(m[`strMeasure${i}`], "")).trim()} ${m[`strIngredient${i}`]}`.trim());
          }
        }
        return fields([["Recipe", m.strMeal], ["category", m.strCategory], ["cuisine", m.strArea],
          ["ingredients", ingredients.join(", ")], ["instructions", clip(m.strInstructions, 600)]]);
      });
    },
    openlibrary(d) {
      return arr(d.docs).slice(0, 5).map((x) => fields([["Book", x.title], ["author", arr(x.author_name).join(", ")],
        ["first published", x.first_publish_year], ["editions", x.edition_count], ["languages", arr(x.language).slice(0, 5).join(", ")]]));
    },
    artic(d) {
      return arr(d.data).slice(0, 5).map((a) => fields([["Artwork", a.title], ["artist", clip(a.artist_display, 120)],
        ["date", a.date_display], ["medium", a.medium_display], ["origin", a.place_of_origin]]));
    },
    dogceo(d, terms) {
      const names = Object.entries(obj(d.message)).map(([b, sub]) => (arr(sub).length ? `${b} (${sub.join(", ")})` : b));
      const asked = names.filter((n) => terms.some((t) => n.includes(t)));
      if (asked.length) return [`Dog breeds matching: ${asked.join(", ")}`, `${names.length} breeds are listed in total.`];
      return [`Dog breeds (${names.length}): ${names.slice(0, 80).join(", ")}`];
    },
    jikan(d) {
      return arr(d.data).slice(0, 4).map((a) => fields([["Anime", a.title], ["English title", a.title_english], ["year", a.year],
        ["episodes", a.episodes], ["score", a.score], ["status", a.status], ["genres", arr(a.genres).map((g) => g.name || "").join(", ")],
        ["synopsis", clip(a.synopsis)]]));
    },
    swapi(d, terms) {
      const people = Array.isArray(d) ? d : or(d.results, []);
      return pick(people, terms, (p) => p.name || "").map((p) => fields([["Character", p.name], ["height", p.height],
        ["mass", p.mass], ["birth year", p.birth_year], ["gender", p.gender], ["eye color", p.eye_color], ["hair color", p.hair_color]]));
    },
    hpapi(d, terms) {
      return pick(Array.isArray(d) ? d : [], terms, (c) => c.name || "").map((c) => fields([["Character", c.name], ["house", c.house],
        ["species", c.species], ["born", c.dateOfBirth], ["patronus", c.patronus], ["actor", c.actor],
        ["wand", Object.values(obj(c.wand)).filter((v) => v).map(val).join(", ")], ["alive", c.alive]]));
    },
    scryfall(d) {
      return arr(d.data).slice(0, 4).map((c) => fields([["Card", c.name], ["mana cost", c.mana_cost], ["type", c.type_line],
        ["text", clip(c.oracle_text, 200)], ["set", c.set_name], ["price USD", obj(c.prices).usd]]));
    },
    disney(d, terms) {
      let found = d.data;
      found = found && typeof found === "object" && !Array.isArray(found) ? [found] : arr(found);
      return pick(found, terms, (c) => c.name || "", 4).map((c) => fields([["Character", c.name],
        ["films", arr(c.films).slice(0, 6).join(", ")], ["TV shows", arr(c.tvShows).slice(0, 6).join(", ")],
        ["video games", arr(c.videoGames).slice(0, 4).join(", ")]]));
    },
    openmeteo(d) {
      const now = obj(d.current_weather);
      const codes = rules().weather_codes;
      const lines = [fields([["Weather now", String(now.weathercode) in codes ? codes[String(now.weathercode)] : `code ${val(now.weathercode)}`],
        ["temperature", now.temperature != null ? `${val(now.temperature)}°C` : null],
        ["wind", now.windspeed != null ? `${val(now.windspeed)} km/h` : null], ["measured at", now.time],
        ["location", `${val(d.latitude)}, ${val(d.longitude)}`]])];
      const daily = obj(d.daily);
      arr(daily.time).forEach((day, i) => {
        const rain = arr(daily.precipitation_probability_max);
        lines.push(fields([["Forecast", day], ["max", `${val(daily.temperature_2m_max[i])}°C`],
          ["min", `${val(daily.temperature_2m_min[i])}°C`],
          ["chance of rain", i < rain.length && rain[i] != null ? `${val(rain[i])}%` : null]]));
      });
      return lines;
    },
    jsonplaceholder(d, terms) {
      return pick(Array.isArray(d) ? d : [], terms, (u) => `${u.name || ""} ${u.username || ""}`).map((u) => fields([
        ["Demo user", u.name], ["username", u.username], ["email", u.email], ["city", obj(u.address).city],
        ["company", obj(u.company).name]]));
    },
  };

  /** An open API's reply as compact fact lines (sites_catalog.summarize; RSS is read on the PC only). */
  function summarize(site, text, question) {
    const parsed = JSON.parse(text);
    const value = parsed && typeof parsed === "object" ? parsed : {};
    return PARSERS[site.parser](value, subjectTerms(question, site)).filter(Boolean);
  }

  /** The answer without a model: each source's facts under its name (sites_catalog.local_reply). */
  function localReply(results, language, pending = []) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const text = rules().reply_text;
    const out = [text.intro[lang]];
    for (const result of results) {
      out.push("");
      if (result.error) {
        out.push(text.failed[lang].replace("{name}", result.site.name));
        continue;
      }
      out.push(`${result.site.name}:`);
      const lines = result.lines || [];
      if (lines.length) lines.forEach((l) => out.push(`- ${l}`));
      else out.push(text.nothing[lang]);
    }
    if (pending.length) {
      const what = pending.every((s) => s.parser === "rss") ? text.news[lang]
        : text.pages[lang].replace("{names}", pending.map((s) => s.name).join(", "));
      out.push("", text.needs[lang].replace("{what}", what));
    }
    return out.join("\n");
  }

  /** An open JSON API: this device reads it itself (news and pages need the PC or Gemini's search). */
  const deviceReadable = (site) => site.type === "open_api";

  /** The open-API sources of [chosen] fetched here: [{site, lines, error}]. [fetchJson]: (url) => text. */
  async function fetchFacts(question, chosen, fetchText) {
    const results = [];
    for (const site of chosen) {
      if (!deviceReadable(site)) continue;
      const url = requestUrl(question, site, chosen.filter((s) => s !== site));
      if (!url) {
        results.push({ site, lines: [], error: false });
        continue;
      }
      try {
        results.push({ site, lines: summarize(site, await fetchText(url), question), error: false });
      } catch (e) {
        results.push({ site, lines: [], error: true });
      }
    }
    return results;
  }

  window.FlomaCatalog = {
    quote, plain, route, named, restrictedNamed, subjectTerms, requestUrl, summarize, localReply, deviceReadable,
    fetchFacts, siteNames, byId: (id) => sites().find((s) => s.id === id),
  };
})();
