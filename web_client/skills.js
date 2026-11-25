// Floma - Skills and the Knowledge Vault on the web (Step 60): a line-for-line port of pc_companion/skills.py and
// knowledge_vault.py over the shared files persona/skills_registry.js (window.FLOMA_SKILLS) and
// persona/knowledge_vault.js (window.FLOMA_VAULT). The shared "skills" cases in persona_cases.json pin every
// result (persona-tests/check_web_skills.js). Plain string work: no model, no network, 0 tokens.
(function () {
  "use strict";

  const registry = () => window.FLOMA_SKILLS;
  const vaultData = () => window.FLOMA_VAULT || { version: 1, categories: {}, content_types: {}, items: [] };

  // --- Reading a question ---------------------------------------------------------------------------

  const MARKS = /[֑-ׇ]/g;
  const QUOTES = /['"`׳״‘’“”]/g;
  const OTHER = /[^0-9a-zא-ת]+/g;

  function norm(text) {
    const t = String(text || "").toLowerCase().replace(MARKS, "").replace(QUOTES, "").replace(OTHER, " ");
    return t.split(" ").filter(Boolean).join(" ");
  }

  function variants(word, prefixes) {
    const out = [word];
    if (word.length >= 4 && prefixes.includes(word[0])) {
      out.push(word.slice(1));
      if (word.length >= 5 && prefixes.includes(word[1])) out.push(word.slice(2));
    }
    return out;
  }

  function levenshtein(a, b) {
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
      }
      previous = current;
    }
    return previous[b.length];
  }

  function vocabulary(table) {
    const phrases = [];
    const words = new Map();
    for (const [key, entry] of Object.entries(table)) {
      for (const synonym of entry.synonyms) {
        const word = norm(synonym);
        if (word.includes(" ")) phrases.push([word, key]);
        else if (word && !words.has(word)) words.set(word, key);
      }
    }
    return [phrases, words];
  }

  const isLatinOrDigit = (c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9");

  function analyze(query, config, vault) {
    const prefixes = config.hebrew_prefixes;
    const stop = new Set(config.stopwords);
    let padded = ` ${norm(query)} `;
    const found = { category: null, content_type: null };
    const vocab = { category: vocabulary(vault.categories), content_type: vocabulary(vault.content_types) };
    for (const kind of ["category", "content_type"]) {
      for (const [phrase, key] of vocab[kind][0]) {
        if (padded.includes(` ${phrase} `)) {
          padded = padded.replace(` ${phrase} `, " ");
          if (found[kind] === null) found[kind] = key;
        }
      }
    }
    const terms = [];
    for (let word of padded.split(" ").filter(Boolean)) {
      if (word.length > 2 && prefixes.includes(word[0]) && isLatinOrDigit(word[1])) word = word.slice(1);
      if (word.length < 2) continue;
      const forms = variants(word, prefixes);
      let claimed = false;
      for (const kind of ["category", "content_type"]) {
        const form = forms.find((f) => vocab[kind][1].has(f));
        if (form !== undefined) {
          if (found[kind] === null) found[kind] = vocab[kind][1].get(form);
          claimed = true;
          break;
        }
      }
      if (claimed || forms.some((f) => stop.has(f))) continue;
      terms.push(word);
    }
    return { category: found.category, content_type: found.content_type, terms };
  }

  // --- Searching ------------------------------------------------------------------------------------

  const address = (url) => norm(String(url).toLowerCase().replace(/^[a-z]+:\/\//, ""));
  const words = (text) => text.split(" ").filter(Boolean);

  function termScore(term, item, prefixes) {
    const title = norm(item.title);
    const tags = item.tags.map(norm);
    const note = norm(item.note);
    const where = address(item.url);
    const titleWords = words(title);
    const tagWords = tags.flatMap(words);
    let best = 0;
    for (const form of variants(term, prefixes)) {
      let inTitle, inTag, inRest;
      if (form.length >= 3) {
        inTitle = title.includes(form);
        inTag = tags.some((t) => t.includes(form));
        inRest = note.includes(form) || where.includes(form);
      } else {
        inTitle = titleWords.includes(form);
        inTag = tagWords.includes(form);
        inRest = words(note).includes(form) || words(where).includes(form);
      }
      let score = 0;
      if (inTitle) score = 3;
      else if (inTag) score = 2;
      else if (inRest) score = 1;
      else if (form.length >= 4 && titleWords.concat(tagWords).some((w) => Math.abs(w.length - form.length) <= 1 && levenshtein(form, w) <= 1)) score = 1;
      best = Math.max(best, score);
    }
    return best;
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function listingOrder(vault) {
    const order = new Map(Object.keys(vault.categories).map((k, i) => [k, i]));
    const rank = (item) => (order.has(item.category) ? order.get(item.category) : order.size);
    return (a, b) => rank(a) - rank(b) || (b.important ? 1 : 0) - (a.important ? 1 : 0)
      || cmp(norm(a.title), norm(b.title)) || cmp(a.id, b.id);
  }

  // Step 64: a pasted address (with its query) finds exactly its item - knowledge_vault.url_key / exact_matches.
  function urlKey(url) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(String(url));
    if (!m) return String(url);
    let host = m[1].replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host + m[2].replace(/\/+$/, "") + (m[3] ? `?${m[3]}` : "") + (m[4] ? `#${m[4]}` : "");
  }

  function exactMatches(query, vault) {
    const found = String(query || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
    const keys = new Set(found.map((u) => urlKey(u.replace(/[.,;)]+$/, ""))));
    return keys.size ? vault.items.filter((i) => keys.has(urlKey(i.url))) : [];
  }

  function search(query, config, vault) {
    const asked = analyze(query, config, vault);
    const { terms } = asked;
    const prefixes = config.hebrew_prefixes;
    const exact = exactMatches(query, vault);
    if (exact.length) return { mode: "search", ...asked, items: exact.slice(0, config.max_results), total: exact.length };
    const filtered = (category, type) => vault.items.filter((i) => (category === null || i.category === category)
      && (type === null || i.content_type === type));
    if (!terms.length) {
      const chosen = filtered(asked.category, asked.content_type).slice().sort(listingOrder(vault));
      return { mode: "list", ...asked, items: chosen.slice(0, config.max_list), total: chosen.length };
    }
    const scored = (pool) => {
      const rows = [];
      for (const item of pool) {
        const scores = terms.map((t) => termScore(t, item, prefixes));
        if (scores.some((s) => s > 0)) {
          let total = scores.reduce((a, b) => a + b, 0) + (terms.length > 1 && norm(item.title).includes(terms.join(" ")) ? 3 : 0);
          total += item.important ? 2 : 0;
          rows.push([scores.filter((s) => s > 0).length, total, item]);
        }
      }
      const strict = rows.filter((r) => r[0] === terms.length);
      const everything = strict.length ? strict : rows;
      everything.sort((a, b) => b[1] - a[1] || (b[2].important ? 1 : 0) - (a[2].important ? 1 : 0)
        || cmp(norm(a[2].title), norm(b[2].title)) || cmp(a[2].id, b[2].id));
      return everything.map((r) => r[2]);
    };
    let found = scored(filtered(asked.category, asked.content_type));
    if (!found.length && (asked.category || asked.content_type)) found = scored(vault.items);
    return { mode: "search", ...asked, items: found.slice(0, config.max_results), total: found.length };
  }

  // --- The reply ------------------------------------------------------------------------------------

  function fill(template, values) {
    let out = template;
    for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value));
    return out;
  }

  const label = (table, key, lang) => (key && table[key] ? table[key][lang] : "");

  function reply(result, skill, vault, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const text = skill.search.text;
    const base = { icon: skill.icon, name: lang === "ENGLISH" ? skill.name_en : skill.name_he };
    const what = [label(vault.categories, result.category, lang), label(vault.content_types, result.content_type, lang)]
      .filter(Boolean).join(" · ");
    const query = result.terms.join(" ");
    if (!vault.items.length) return { text: fill(text.empty[lang], base), sources: [] };
    if (!result.items.length) {
      if (result.mode === "search") return { text: fill(text.not_found[lang], { ...base, query, total: vault.items.length }), sources: [] };
      return { text: fill(text.none_in[lang], { ...base, what }), sources: [] };
    }
    let head;
    if (result.mode === "search") head = fill(text[result.total === 1 ? "found_one" : "found"][lang], { ...base, count: result.total, query });
    else if (what) head = fill(text.listed[lang], { ...base, what, count: result.total });
    else head = fill(text.listed_all[lang], { ...base, count: result.total });
    const lines = [head];
    const grouped = result.mode === "list" && new Set(result.items.map((i) => i.category)).size > 1;
    let current = null;
    for (const item of result.items) {
      if (grouped && item.category !== current) {
        current = item.category;
        const count = result.items.filter((i) => i.category === current).length;
        lines.push("", `${label(vault.categories, current, lang)} (${count})`);
      }
      const star = item.important ? "⭐ " : "";
      const kind = label(vault.content_types, item.content_type, lang);
      const extra = result.mode === "search" ? ` · ${label(vault.categories, item.category, lang)}` : "";
      lines.push(`• ${star}${item.title} (${kind}${extra})`);
    }
    if (result.total > result.items.length) lines.push("", fill(text.more[lang], { count: result.total - result.items.length }));
    const sources = result.items.map((i) => ({ title: (i.important ? "⭐ " : "") + i.title, uri: i.url }));
    return { text: lines.join("\n"), sources };
  }

  // --- Skills ---------------------------------------------------------------------------------------

  // The skills this build has code for; a newer registry's other skills stay hidden until the app updates.
  const IMPLEMENTED = ["vault", "phone", "translate", "calc"];
  const skills = (reg) => (reg || registry()).skills.filter((s) => IMPLEMENTED.includes(s.id));
  const byId = (id, reg) => skills(reg).find((s) => s.id === id) || null;
  const name = (skill, language) => (language === "ENGLISH" ? skill.name_en : skill.name_he);
  const description = (skill, language) => (language === "ENGLISH" ? skill.description_en : skill.description_he);
  const text = (key, language, reg) => (reg || registry()).text[key][language === "ENGLISH" ? "ENGLISH" : "HEBREW"];
  const handles = (skill) => [skill.handle, ...(skill.aliases || [])].map((h) => h.toLowerCase());

  function mentionMatches(token, reg) {
    if (!token.startsWith("@")) return [];
    const typed = token.toLowerCase();
    const typedWords = norm(token.slice(1));
    return skills(reg).filter((s) => handles(s).some((h) => h.startsWith(typed))
      || (typedWords && s.names.some((n) => norm(n).startsWith(typedWords))));
  }

  function mentionToken(value, caret = null) {
    const before = value.slice(0, caret === null ? value.length : caret);
    const parts = before.split(/\s+/).filter(Boolean);
    const word = before.trim() && !/\s/.test(before.slice(-1)) ? parts[parts.length - 1] : "";
    return word.startsWith("@") ? word : null;
  }

  function mentioned(token, reg) {
    const typed = token.toLowerCase().replace(/[.,!?:;]+$/, "");
    if (typed.length < 2) return null;
    const exact = skills(reg).filter((s) => handles(s).includes(typed));
    if (exact.length) return exact[0];
    const starts = skills(reg).filter((s) => handles(s).some((h) => h.startsWith(typed)));
    return starts.length === 1 ? starts[0] : null;
  }

  function startsWith(normText, phrase) {
    const p = norm(phrase);
    if (normText === p) return "";
    if (normText.startsWith(p + " ")) return normText.slice(p.length + 1);
    return null;
  }

  function named(rest, reg) {
    const names = [];
    for (const s of skills(reg)) for (const n of [...s.names, s.handle.slice(1)]) names.push([norm(n), s]);
    names.sort((a, b) => b[0].length - a[0].length); // stable: equal lengths keep their order, as in Python
    for (const [skillName, skill] of names) {
      const after = startsWith(rest, skillName);
      if (after !== null) return [skill, after];
    }
    return null;
  }

  const decision = (skill = null, query = "", activate = false, deactivate = false, auto = false) =>
    ({ skill, query, activate, deactivate, auto });

  function resolve(message, active, autoSwitch, vault, reg) {
    reg = reg || registry();
    const stripped = String(message).split(/\s+/).filter(Boolean).join(" ");
    const normalized = norm(stripped);
    if (reg.exit_phrases.some((p) => startsWith(normalized, p) !== null)) return decision(null, "", false, true);
    const parts = stripped ? stripped.split(" ") : [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("@")) {
        const skill = mentioned(parts[i], reg);
        if (skill && skill.id === "translate") return decision("translate", String(message).trim().replace(parts[i], "").trim(), true);
        if (skill) return decision(skill.id, parts.slice(0, i).concat(parts.slice(i + 1)).join(" "), true);
      }
    }
    for (const phrase of reg.activate_phrases) {
      const rest = startsWith(normalized, phrase);
      if (rest !== null) {
        const found = named(rest, reg);
        if (found) return decision(found[0].id, found[1], true);
      }
    }
    if (active && byId(active, reg)) return decision(active, active === "translate" ? String(message).trim() : stripped);
    if (autoSwitch) {
      // A phone number is the strongest signal, so @phone is checked first (Step 61).
      const phone = byId("phone", reg);
      if (phone && phoneAuto(stripped, normalized, phone)) return decision("phone", stripped, false, false, true);
      // A message that starts with a translate command and has text to translate (Step 63).
      if (byId("translate", reg)) {
        const request = translateRequest(message, reg);
        if (request.command && request.text) return decision("translate", String(message).trim(), false, false, true);
      }
      // A calculation request ("חשב לי...", "פתור משוואה...") or a message that is only math ("2+3*4") (Step 64).
      if (byId("calc", reg) && Calc.auto(stripped, calcConfig(reg))) return decision("calc", stripped, false, false, true);
      for (const skill of skills(reg)) {
        if (skill.id === "vault" && skill.auto_triggers.some((t) => normalized.includes(norm(t)))) {
          const v = vault || vaultData();
          if (search(stripped, skill.search, v).items.length) return decision("vault", stripped, false, false, true);
        }
      }
    }
    return decision();
  }

  function answer(skillId, query, language, vault, reg) {
    const skill = byId(skillId, reg);
    const v = vault || vaultData();
    if (skillId === "phone") return phoneAnswer(query, language, v, reg);
    if (skillId === "calc") return calcAnswer(query, language, reg);
    return reply(search(query, skill.search, v), skill, v, language);
  }

  // --- @phone (Step 61): a port of skills.py's phone functions - no Gemini, no request -------------------

  const NOT_DIGIT = /[^0-9]/g;
  const phoneConfig = (reg) => byId("phone", reg).phone;

  function findNumber(message, reg) {
    const found = new RegExp(phoneConfig(reg).pattern).exec(message || "");
    return found ? found[0] : null;
  }

  function phoneInfo(raw, reg) {
    const cfg = phoneConfig(reg);
    let digits = raw.replace(NOT_DIGIT, "");
    let number;
    let kind;
    let prefix;
    if (raw.trim().startsWith("*")) {
      [number, kind, prefix] = [`*${digits}`, "star", "*"];
    } else {
      if (digits.startsWith("00972")) digits = digits.slice(2);
      number = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
      if (number.startsWith("1800")) [kind, prefix] = ["tollfree", "1-800"];
      else if (number.startsWith("1700")) [kind, prefix] = ["shared", "1-700"];
      else if (number.length === 10 && number.startsWith("05")) [kind, prefix] = ["mobile", number.slice(0, 3)];
      else if (number.length === 10 && number.startsWith("07")) [kind, prefix] = ["voip", number.slice(0, 3)];
      else if (number.length === 9 && "23489".includes(number[1])) [kind, prefix] = ["landline", number.slice(0, 2)];
      else [kind, prefix] = ["unknown", ""];
    }
    const lined = ["mobile", "voip", "landline"].includes(kind);
    let formats;
    if (lined) formats = window.FlomaLauncher.phoneFormats(number);
    else if ((kind === "tollfree" || kind === "shared") && number.length === 10) {
      const rest = number.slice(4);
      formats = [`${number[0]}-${number.slice(1, 4)}-${rest.slice(0, 3)}-${rest.slice(3)}`, number];
    } else formats = [number];
    const display = lined ? formats[formats.length - 1] : formats[0];
    const detail = cfg.prefixes[kind === "voip" ? "07" : prefix] || null;
    return { number, kind, prefix, detail, formats, display };
  }

  function phoneMatches(info, vault) {
    const core = info.number.replace(/^\*/, "").replace(/^0+/, "");
    if (core.length < 8) return [];
    return vault.items.filter((i) => [i.title, i.note, i.tags.join(" "), i.url].join(" ").replace(NOT_DIGIT, "").includes(core));
  }

  function phoneLinks(info, language, reg) {
    const cfg = phoneConfig(reg);
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const L = window.FlomaLauncher;
    const google = L.googleLink(info.formats.map((f) => `"${f}"`).join(" OR "), cfg.text.google[lang]);
    const sites = window.FLOMA_SITES.sites;
    return [google].concat(cfg.sites.map((id) => sites.find((x) => x.id === id)).filter(Boolean)
      .map((site) => L.linkFor(site, { phone: info.display })));
  }

  function phoneAuto(stripped, normalized, skill) {
    const cfg = skill.phone;
    if (!new RegExp(cfg.pattern).test(stripped)) return false;
    if (cfg.lookup_phrases.some((p) => normalized.includes(norm(p)))) return true;
    const filler = new Set(cfg.filler.map(norm));
    return normalized.split(" ").filter((w) => w && !/^[0-9]+$/.test(w)).every((w) => filler.has(w));
  }

  function phoneAnswer(query, language, vault, reg) {
    const skill = byId("phone", reg);
    const cfg = skill.phone;
    const t = cfg.text;
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const raw = findNumber(query, reg);
    if (raw === null) return { text: fill(t.no_number[lang], { icon: skill.icon }), sources: [] };
    const info = phoneInfo(raw, reg);
    const lines = [fill(t.head[lang], { icon: skill.icon, name: name(skill, lang), number: info.display }),
      fill(t.kind[lang], { kind: cfg.kinds[info.kind][lang] })];
    if (["mobile", "voip", "landline"].includes(info.kind)) {
      const detail = info.detail ? info.detail[lang] : t.unknown_carrier[lang];
      lines.push(fill(t.prefix[lang], { prefix: info.prefix, detail }));
      if (info.kind === "mobile" && info.detail) lines.push(t.ported[lang]);
    }
    lines.push("", t.formats[lang], ...info.formats.map((f) => `• ${f}`), "");
    const matches = phoneMatches(info, vault);
    if (matches.length) lines.push(t.vault_found[lang], ...matches.map((i) => `• ${i.title}`));
    else lines.push(t.vault_none[lang]);
    lines.push("", t.links[lang]);
    const sources = phoneLinks(info, lang, reg).map((l) => ({ title: l.title, uri: l.uri }))
      .concat(matches.map((i) => ({ title: i.title, uri: i.url })));
    return { text: lines.join("\n"), sources };
  }

  function activatedText(skillId, language, reg) {
    const skill = byId(skillId, reg);
    return fill(text("activated", language, reg), { icon: skill.icon, name: name(skill, language), description: description(skill, language) });
  }


  // --- @translate (Step 63): a port of skills.py's translate_request - the model call is the app's ---------

  const EDGE = " \t\r\n:-–"; // trimmed around the text to translate
  const HEBREW_LETTER = /[\u05d0-\u05ea]/g;
  const LATIN_LETTER = /[A-Za-z]/g;
  const WORD_CHAR = /[\p{L}\p{N}]/u;
  const translateConfig = (reg) => byId("translate", reg).translate;

  function stripChars(text, chars) {
    let start = 0;
    let end = text.length;
    while (start < end && chars.includes(text[start])) start++;
    while (end > start && chars.includes(text[end - 1])) end--;
    return text.slice(start, end);
  }

  function lead(message, phrases) {
    const low = message.toLowerCase();
    for (const phrase of phrases.slice().sort((a, b) => b.length - a.length)) {
      const p = phrase.toLowerCase();
      if (low.startsWith(p) && (message.length === p.length || !WORD_CHAR.test(message[p.length]))) return [phrase, message.slice(p.length)];
    }
    return null;
  }

  function textLanguage(text) {
    const hebrew = (text.match(HEBREW_LETTER) || []).length;
    const latin = (text.match(LATIN_LETTER) || []).length;
    if (hebrew > latin) return "HEBREW";
    if (latin > hebrew) return "ENGLISH";
    return null;
  }

  function translateRequest(message, reg) {
    const cfg = translateConfig(reg);
    const stripped = String(message).trim(); // the text keeps its own lines and spacing
    const led = lead(stripped, cfg.commands);
    let body = stripChars(led ? led[1] : stripped, EDGE);
    let target = null;
    const colon = body.indexOf(":");
    if (colon >= 0) {
      const padded = ` ${norm(body.slice(0, colon))} `;
      for (const [key, entry] of Object.entries(cfg.targets)) {
        if (entry.phrases.some((p) => padded.includes(` ${norm(p)} `))) {
          target = key;
          break;
        }
      }
      if (led !== null || target !== null) body = body.slice(colon + 1).trim();
    }
    if (target === null) {
      for (const [key, entry] of Object.entries(cfg.targets)) {
        const found = lead(body, entry.phrases);
        if (found !== null) {
          target = key;
          body = stripChars(found[1], EDGE);
          break;
        }
      }
    }
    const source = textLanguage(body);
    const explicit = target !== null;
    if (target === null) target = source === "HEBREW" ? "ENGLISH" : "HEBREW";
    const names = {};
    for (const [key, entry] of Object.entries(cfg.targets)) names[key] = entry.name.ENGLISH;
    const system = cfg.system_prompt.split("{source}").join(source && names[source] ? names[source] : "the original language")
      .split("{target}").join(names[target]);
    return { command: led !== null, text: body, source, target, explicit, system };
  }

  function translateCaption(request, language, local = false, reg) {
    const cfg = translateConfig(reg);
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const name = (key) => (key && cfg.targets[key] ? cfg.targets[key].name[lang] : "?");
    const line = cfg.text.direction[lang].split("{source}").join(name(request.source)).split("{target}").join(name(request.target));
    return line + (local ? ` · ${cfg.text.local[lang]}` : "");
  }

  function translateText(key, language, reg, values = {}) {
    const skill = byId("translate", reg);
    return fill(translateConfig(reg).text[key][language === "ENGLISH" ? "ENGLISH" : "HEBREW"], { icon: skill.icon, ...values });
  }

  // --- @calc (Step 64): a line-for-line port of pc_companion/calc.py - no Gemini, no network, never eval ------------

  const Calc = (function () {
    const SNAP = 1e-12;
    const P10 = [1];
    for (let k = 0; k < 22; k++) P10.push(P10[P10.length - 1] * 10);

    class CalcError extends Error {
      constructor(key, values = {}) {
        super(key);
        this.key = key;
        this.values = values;
      }
    }

    function check(x) {
      if (!Number.isFinite(x)) throw new CalcError("too_big");
      return Math.abs(x) < SNAP ? 0 : x;
    }

    function fixed(a, d) {
      const n = Math.floor(a * P10[d] + 0.5);
      let digits = String(n);
      if (d === 0) return digits;
      digits = digits.padStart(d + 1, "0");
      const whole = digits.slice(0, digits.length - d);
      const frac = digits.slice(digits.length - d).replace(/0+$/, "");
      return whole + (frac ? `.${frac}` : "");
    }

    function fmt(x) {
      if (!Number.isFinite(x)) throw new CalcError("too_big");
      if (Math.abs(x) < SNAP) return "0";
      const sign = x < 0 ? "-" : "";
      const a = Math.abs(x);
      if (a >= 1e15) {
        let e = 0;
        let m = a;
        while (m >= 10) {
          m /= 10;
          e += 1;
        }
        let mant = fixed(m, 11);
        if (mant === "10") {
          mant = "1";
          e += 1;
        }
        return `${sign}${mant}e${e}`;
      }
      let d;
      if (a >= 1) {
        let e = 0;
        while (e < 15 && a >= P10[e + 1]) e += 1;
        d = Math.max(0, 11 - e);
      } else d = 12;
      const s = fixed(a, d);
      return s === "0" ? "0" : sign + s;
    }

    const show = (x) => {
      const s = fmt(x);
      return s.startsWith("-") ? `(${s})` : s;
    };

    const SPACES = " \t\r\n ‎‏";
    const DIGITS = "0123456789";
    const OPS = "+-*/^()%!=";
    const SYMBOLS = [["×", "*"], ["·", "*"], ["⋅", "*"], ["÷", "/"], ["−", "-"], ["–", "-"], ["—", "-"], ["**", "^"],
      ["²", "^2"], ["³", "^3"], ["√", " sqrt "], ["π", " pi "], ["°", " "], ["[", "("], ["]", ")"], ["{", "("],
      ["}", ")"], ["?", " "], ["׳", "'"], ["״", '"']];
    const FUNCTIONS = ["sqrt", "log", "ln", "sin", "cos", "tan", "abs"];
    const SYM = { "+": "+", "-": "-", "*": "×", "/": "÷", "^": "^" };
    const THOUSANDS = /(?<=[0-9]),(?=[0-9]{3}(?![0-9]))/g;
    const PERCENT_OF = /%[ ]*(?:of|מתוך|מ)(?![a-zא-ת])[ ]*-?/g;
    const TIMES_X = /(?<=[0-9.)])[ ]*x[ ]*(?=[0-9.(])/g;
    const COLON_DIV = /(?<=[0-9)])[ ]*:[ ]*(?=[0-9.(])/g; // 6:2 is division (as taught in Israeli schools)
    const DATE = /^[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}$/;
    const byLength = (list) => list.slice().sort((a, b) => b.length - a.length);
    const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "א" && c <= "ת");

    function replaceWord(text, phrase, by) {
      const out = [];
      const p = phrase.toLowerCase();
      let i = 0;
      for (;;) {
        const j = text.indexOf(p, i);
        if (j < 0) {
          out.push(text.slice(i));
          return out.join("");
        }
        const end = j + p.length;
        if ((j === 0 || !isLetter(text[j - 1])) && (end === text.length || !isLetter(text[end]))) out.push(text.slice(i, j), by);
        else out.push(text.slice(i, end));
        i = end;
      }
    }

    const hasWord = (text, phrase) => replaceWord(text, phrase, "\u0000") !== text;

    function symbols(text) {
      let t = text.toLowerCase();
      for (const [a, b] of SYMBOLS) t = t.split(a).join(b);
      for (const c of SPACES) t = t.split(c).join(" ");
      return t.replace(THOUSANDS, "");
    }

    function prepare(body, cfg) {
      let text = symbols(body);
      for (const phrase of byLength(Object.keys(cfg.words))) text = replaceWord(text, phrase, ` ${cfg.words[phrase]} `);
      text = text.replace(PERCENT_OF, "%*");
      const radians = cfg.radian_words.some((w) => hasWord(text, w));
      for (const w of byLength([...cfg.radian_words, ...cfg.degree_words, ...cfg.filler])) text = replaceWord(text, w, " ");
      text = text.replace(COLON_DIV, "/").split(":").join(" ");
      if (!text.includes("=")) text = text.replace(TIMES_X, "*");
      text = text.trim();
      if (text.endsWith("=")) text = text.slice(0, -1).trim();
      return [text, radians];
    }

    function tokenize(text, cfg) {
      const out = [];
      const n = text.length;
      let i = 0;
      while (i < n) {
        const c = text[i];
        if (c === " ") i += 1;
        else if (DIGITS.includes(c) || (c === "." && i + 1 < n && DIGITS.includes(text[i + 1]))) {
          let j = i;
          while (j < n && DIGITS.includes(text[j])) j += 1;
          if (j < n && text[j] === ".") {
            j += 1;
            while (j < n && DIGITS.includes(text[j])) j += 1;
          }
          if (j + 1 < n && text[j] === "e" && (DIGITS.includes(text[j + 1])
            || ("+-".includes(text[j + 1]) && j + 2 < n && DIGITS.includes(text[j + 2])))) {
            j += 2;
            while (j < n && DIGITS.includes(text[j])) j += 1;
          }
          out.push(["num", text.slice(i, j)]);
          i = j;
        } else if (isLetter(c)) {
          let j = i;
          while (j < n && isLetter(text[j])) j += 1;
          let word = text.slice(i, j);
          if (Object.prototype.hasOwnProperty.call(cfg.functions, word)) word = cfg.functions[word];
          if (!FUNCTIONS.includes(word) && !["pi", "e", "x"].includes(word)) throw new CalcError("no_expression");
          out.push(["id", word]);
          i = j;
        } else if (OPS.includes(c)) {
          out.push(["op", c]);
          i += 1;
        } else throw new CalcError("no_expression");
      }
      return out;
    }

    function parse(tokens) {
      if (!tokens.length) throw new CalcError("no_expression");
      let i = 0;
      const peek = () => (i < tokens.length ? tokens[i] : null);
      const isOp = (chars) => {
        const tok = peek();
        return tok !== null && tok[0] === "op" && chars.includes(tok[1]);
      };
      const take = () => tokens[i++];
      const startsPrimary = () => {
        const tok = peek();
        return tok !== null && (tok[0] === "num" || tok[0] === "id" || (tok[0] === "op" && tok[1] === "("));
      };
      function expr() {
        let node = term();
        while (isOp("+-")) {
          const op = take()[1];
          node = ["bin", op, node, term()];
        }
        return node;
      }
      function term() {
        let node = unary();
        for (;;) {
          if (isOp("*/")) {
            const op = take()[1];
            node = ["bin", op, node, unary()];
          } else if (startsPrimary()) node = ["bin", "*", node, power()];
          else return node;
        }
      }
      function unary() {
        if (isOp("-")) {
          take();
          return ["neg", unary()];
        }
        if (isOp("+")) {
          take();
          return unary();
        }
        return power();
      }
      function power() {
        const base = postfix();
        if (isOp("^")) {
          take();
          return ["bin", "^", base, unary()];
        }
        return base;
      }
      function postfix() {
        let node = primary();
        while (isOp("%!")) node = ["post", take()[1], node];
        return node;
      }
      function primary() {
        const tok = peek();
        if (tok === null) throw new CalcError("no_expression");
        if (tok[0] === "num") {
          take();
          return ["num", check(Number(tok[1]))];
        }
        if (tok[0] === "id") {
          take();
          if (FUNCTIONS.includes(tok[1])) {
            const arg = isOp("(") ? group() : power();
            return ["fn", tok[1], arg];
          }
          return tok[1] === "x" ? ["var"] : ["const", tok[1]];
        }
        if (tok[0] === "op" && tok[1] === "(") return group();
        throw new CalcError("no_expression");
      }
      function group() {
        take();
        const node = expr();
        if (isOp(")")) take();
        else if (peek() !== null) throw new CalcError("no_expression");
        return node;
      }
      const node = expr();
      if (peek() !== null) throw new CalcError("no_expression");
      return node;
    }

    const hasVar = (node) => node[0] === "var" || node.slice(1).some((c) => Array.isArray(c) && hasVar(c));

    function applyBin(op, a, b) {
      if (op === "+") return check(a + b);
      if (op === "-") return check(a - b);
      if (op === "*") return check(a * b);
      if (op === "/") {
        if (b === 0) throw new CalcError("div_zero");
        return check(a / b);
      }
      if (a === 0 && b < 0) throw new CalcError("div_zero");
      if (a < 0 && b !== Math.floor(b)) throw new CalcError("pow_negative");
      return check(Math.pow(a, b));
    }

    function applyPost(op, v) {
      if (op === "%") return check(v / 100);
      if (v < 0 || v !== Math.floor(v) || v > 170) throw new CalcError("factorial");
      let r = 1;
      for (let k = 2; k <= v; k += 1) r *= k;
      return check(r);
    }

    function applyFn(name, v, radians) {
      if (name === "sqrt") {
        if (v < 0) throw new CalcError("sqrt_negative");
        return check(Math.sqrt(v));
      }
      if (name === "log" || name === "ln") {
        if (v <= 0) throw new CalcError("log_domain");
        return check(name === "log" ? Math.log10(v) : Math.log(v));
      }
      if (name === "abs") return check(Math.abs(v));
      const angle = radians ? v : v * Math.PI / 180;
      if (name === "sin") return check(Math.sin(angle));
      if (name === "cos") return check(Math.cos(angle));
      if (Math.abs(Math.cos(angle)) < SNAP) throw new CalcError("tan_undefined");
      return check(Math.tan(angle));
    }

    function fnLabel(name, v, radians) {
      if (name === "sqrt") return `√${show(v)}`;
      if (name === "abs") return `|${fmt(v)}|`;
      if (["sin", "cos", "tan"].includes(name) && !radians) return `${name}(${fmt(v)}°)`;
      return `${name}(${fmt(v)})`;
    }

    const constant = (name) => (name === "pi" ? Math.PI : Math.E);

    function evaluate(node, steps, radians) {
      const kind = node[0];
      if (kind === "num") return node[1];
      if (kind === "const") return constant(node[1]);
      if (kind === "var") throw new CalcError("no_expression");
      if (kind === "neg") return check(-evaluate(node[1], steps, radians));
      if (kind === "post") {
        const v = evaluate(node[2], steps, radians);
        const r = applyPost(node[1], v);
        steps.push(`${fmt(v)}${node[1]} = ${fmt(r)}`);
        return r;
      }
      if (kind === "fn") {
        const v = evaluate(node[2], steps, radians);
        const r = applyFn(node[1], v, radians);
        steps.push(`${fnLabel(node[1], v, radians)} = ${fmt(r)}`);
        return r;
      }
      const a = evaluate(node[2], steps, radians);
      const b = evaluate(node[3], steps, radians);
      const r = applyBin(node[1], a, b);
      steps.push(`${show(a)} ${SYM[node[1]]} ${show(b)} = ${fmt(r)}`);
      return r;
    }

    const degree = (p) => (p[2] !== 0 ? 2 : p[1] !== 0 ? 1 : 0);

    function times(p, q) {
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (p[i] !== 0 && q[j] !== 0) {
            if (i + j > 2) throw new CalcError("degree");
            out[i + j] = out[i + j] + p[i] * q[j];
          }
        }
      }
      return out.map(check);
    }

    function poly(node, radians) {
      const kind = node[0];
      if (kind === "num") return [node[1], 0, 0];
      if (kind === "const") return [constant(node[1]), 0, 0];
      if (kind === "var") return [0, 1, 0];
      if (kind === "neg") return poly(node[1], radians).map((c) => check(-c));
      if (kind === "post" || kind === "fn") {
        const p = poly(node[2], radians);
        if (degree(p) > 0) throw new CalcError("not_polynomial");
        return [kind === "post" ? applyPost(node[1], p[0]) : applyFn(node[1], p[0], radians), 0, 0];
      }
      const op = node[1];
      const a = poly(node[2], radians);
      const b = poly(node[3], radians);
      if (op === "+") return [0, 1, 2].map((k) => check(a[k] + b[k]));
      if (op === "-") return [0, 1, 2].map((k) => check(a[k] - b[k]));
      if (op === "*") return times(a, b);
      if (degree(b) > 0) throw new CalcError("not_polynomial");
      if (op === "/") {
        if (b[0] === 0) throw new CalcError("div_zero");
        return a.map((c) => check(c / b[0]));
      }
      if (degree(a) === 0) return [applyBin("^", a[0], b[0]), 0, 0];
      if (b[0] !== Math.floor(b[0]) || b[0] < 0 || b[0] * degree(a) > 2) throw new CalcError("degree");
      let out = [1, 0, 0];
      for (let k = 0; k < b[0]; k += 1) out = times(out, a);
      return out;
    }

    function polyText(p) {
      let out = "";
      for (const power of [2, 1, 0]) {
        const c = p[power];
        if (c === 0) continue;
        const mag = fmt(Math.abs(c));
        const body = power === 0 ? mag : (mag === "1" ? "" : mag) + (power === 2 ? "x²" : "x");
        if (!out) out = (c < 0 ? "-" : "") + body;
        else out += (c < 0 ? " - " : " + ") + body;
      }
      return out || "0";
    }

    const UNIT_TEXT = /-?[0-9]+(?:\.[0-9]+)?|[a-zא-ת]+/g;
    const CURRENCY = [["$", " usd "], ["€", " eur "], ["₪", " ils "], ["£", " gbp "]];
    const CALC_QUOTES = "'\"`‘’“”";

    function unitWords(body) {
      let text = body.toLowerCase();
      for (const [a, b] of CURRENCY) text = text.split(a).join(b);
      for (const [a, b] of SYMBOLS) if ("׳״".includes(a)) text = text.split(a).join(b);
      for (const q of CALC_QUOTES) text = text.split(q).join("");
      text = text.replace(/(?<=[א-ת])-/g, " ").replace(THOUSANDS, "");
      return text.match(UNIT_TEXT) || [];
    }

    function unitOf(word, names) {
      if (Object.prototype.hasOwnProperty.call(names, word)) return names[word];
      if (word.length > 2 && "לבהמו".includes(word[0]) && Object.prototype.hasOwnProperty.call(names, word.slice(1))) return names[word.slice(1)];
      return null;
    }

    const isNumber = (word) => DIGITS.includes(word[0]) || word[0] === "-";

    function convert(body, cfg, language) {
      const units = cfg.units;
      const names = {};
      for (const [key, u] of Object.entries(units)) for (const n of u.names) names[n.toLowerCase()] = key;
      const words = unitWords(body);
      const rateWords = new Set(cfg.rate_words);
      let amount = null;
      let amountAt = -1;
      let rate = null;
      const found = [];
      words.forEach((w, i) => {
        if (isNumber(w)) {
          if (i > 0 && rateWords.has(words[i - 1])) rate = rate !== null ? rate : Number(w);
          else if (amount === null) {
            amount = Number(w);
            amountAt = i;
          }
        } else {
          const key = unitOf(w, names);
          if (key !== null) found.push([i, key]);
        }
      });
      if (found.length < 2) return null;
      let source;
      let target;
      if (amount === null) { // "כמה מטרים בקילומטר" / "how many meters in a km": 1 of the second unit, in the first
        target = found[0][1];
        const other = found.find(([, k]) => k !== target);
        source = other ? other[1] : target;
      } else {
        const after = found.filter(([i]) => i > amountAt).map(([, k]) => k);
        source = after.length ? after[0] : found[0][1];
        const other = found.find(([, k]) => k !== source);
        target = other ? other[1] : source;
      }
      const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
      const t = cfg.text;
      const a = units[source];
      const b = units[target];
      if (a.kind !== b.kind) throw new CalcError("unit_mismatch", { source: a.label[lang], target: b.label[lang] });
      const n = amount === null ? 1 : amount;
      const label = b.label[lang];
      const steps = [];
      let r;
      if (a.kind === "temperature") {
        let c = n;
        if (source === "f") {
          c = check((n - 32) * 5 / 9);
          steps.push(fill(t.f_to_c[lang], { n: fmt(n), r: fmt(c) }));
        } else if (source === "k") {
          c = check(n - 273.15);
          steps.push(fill(t.k_to_c[lang], { n: fmt(n), r: fmt(c) }));
        }
        r = c;
        if (target === "f") {
          r = check(c * 9 / 5 + 32);
          steps.push(fill(t.c_to_f[lang], { n: fmt(c), r: fmt(r) }));
        } else if (target === "k") {
          r = check(c + 273.15);
          steps.push(fill(t.c_to_k[lang], { n: fmt(c), r: fmt(r) }));
        }
      } else if (a.kind === "currency") {
        if (source === target) r = n;
        else if (rate === null || rate <= 0) throw new CalcError("needs_rate");
        else if (source === "ils") {
          r = check(n / rate);
          steps.push(fill(t.rate_divide[lang], { n: fmt(n), rate: fmt(rate), r: fmt(r), to: label }));
        } else {
          r = check(n * rate);
          steps.push(fill(t.rate_multiply[lang], { n: fmt(n), rate: fmt(rate), r: fmt(r), to: label }));
        }
      } else {
        const factor = check(Number(a.factor) / Number(b.factor));
        r = check(n * factor);
        steps.push(fill(t.factor[lang], { source: a.label[lang], factor: fmt(factor), to: label }));
        steps.push(fill(t.multiply[lang], { n: fmt(n), factor: fmt(factor), r: fmt(r), to: label }));
      }
      return { result: `${fmt(r)} ${label}`, steps };
    }

    function solve(body, cfg, language) {
      const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
      const t = cfg.text;
      const [text, radians] = prepare(body, cfg);
      const sides = text.split("=");
      if (sides.length > 2) throw new CalcError("no_expression");
      const trees = sides.map((side) => parse(tokenize(side, cfg)));
      const steps = [];
      if (trees.length === 1 && !hasVar(trees[0])) {
        const value = evaluate(trees[0], steps, radians);
        return { kind: "expression", result: fmt(value), steps };
      }
      if (trees.length === 2 && !hasVar(trees[0]) && !hasVar(trees[1])) {
        const left = evaluate(trees[0], steps, radians);
        const right = evaluate(trees[1], steps, radians);
        const same = fmt(left) === fmt(right);
        return { kind: "check", result: fill(t[same ? "true" : "false"][lang], { left: fmt(left), right: fmt(right) }), steps };
      }
      const left = poly(trees[0], radians);
      const right = trees.length === 2 ? poly(trees[1], radians) : [0, 0, 0];
      const p = [0, 1, 2].map((k) => check(left[k] - right[k]));
      const [c, b, a] = p;
      steps.push(fill(t.arrange[lang], { equation: `${polyText(p)} = 0` }));
      if (a === 0 && b === 0) {
        return { kind: "equation", result: fill(t[c === 0 ? "identity" : "contradiction"][lang], { c: fmt(c) }), steps };
      }
      if (a === 0) {
        const rightSide = check(-c);
        if (c !== 0) steps.push(fill(t.isolate[lang], { left: polyText([0, b, 0]), right: fmt(rightSide) }));
        const x = check(rightSide / b);
        if (b !== 1) steps.push(fill(t.divide[lang], { b: show(b), right: fmt(rightSide), x: fmt(x) }));
        return { kind: "equation", result: `x = ${fmt(x)}`, steps };
      }
      const d = check(b * b - 4 * a * c);
      const a2 = check(2 * a);
      const nb = check(-b);
      steps.push(fill(t.coefficients[lang], { a: fmt(a), b: fmt(b), c: fmt(c) }));
      steps.push(fill(t.discriminant[lang], { a: show(a), b: show(b), c: show(c), d: fmt(d) }));
      if (d > 0) {
        const s = check(Math.sqrt(d));
        const x1 = check((nb + s) / a2);
        const x2 = check((nb - s) / a2);
        steps.push(fill(t.sqrt_d[lang], { s: fmt(s) }));
        steps.push(fill(t.root1[lang], { nb: fmt(nb), s: fmt(s), a2: show(a2), x: fmt(x1) }));
        steps.push(fill(t.root2[lang], { nb: fmt(nb), s: fmt(s), a2: show(a2), x: fmt(x2) }));
        return { kind: "equation", result: `x₁ = ${fmt(x1)}, x₂ = ${fmt(x2)}`, steps };
      }
      if (d === 0) {
        const x = check(nb / a2);
        steps.push(fill(t.double_root[lang], { nb: fmt(nb), a2: show(a2), x: fmt(x) }));
        return { kind: "equation", result: `x = ${fmt(x)}`, steps };
      }
      const re = check(nb / a2);
      const im = check(Math.sqrt(-d) / Math.abs(a2));
      steps.push(fill(t.complex[lang], { re: fmt(re), im: fmt(im) }));
      return { kind: "equation", result: fill(t.complex_result[lang], { re: fmt(re), im: fmt(im) }), steps };
    }

    function run(query, cfg, language) {
      const stripped = String(query || "").split(/\s+/).filter(Boolean).join(" ");
      const led = lead(stripped, cfg.commands);
      const body = stripChars(led ? led[1] : stripped, " :,");
      const out = { command: led !== null, input: body, kind: null, result: null, steps: [], error: null, values: {},
        normalized: null, table: [] };
      try {
        if (!body) throw new CalcError("no_expression");
        const A = window.FlomaCalcAcademic;  // Step 67
        const text = A.normalize(body, cfg); // dictation → formal syntax
        if (text !== A.basic(body, cfg)) out.normalized = text;
        const academic = A.solve(text, cfg, language);
        if (academic !== null) Object.assign(out, academic);
        else {
          const converted = convert(text, cfg, language);
          if (converted !== null) Object.assign(out, { kind: "convert" }, converted);
          else Object.assign(out, solve(text, cfg, language));
        }
      } catch (e) {
        if (!(e && typeof e.key === "string")) throw e; // this file's CalcError or calc_academic.js's
        Object.assign(out, { kind: null, result: null, steps: [], error: e.key, values: e.values || {}, table: [] });
      }
      return out;
    }

    function mathOnly(message) {
      let text = symbols(message).trim();
      if (!text || DATE.test(text) || ![...text].some((c) => DIGITS.includes(c))) return false;
      if (!text.includes("=")) text = text.replace(TIMES_X, "*");
      const operation = [...text].some((c) => "+-*/^%!=".includes(c)) || FUNCTIONS.some((f) => text.includes(f));
      for (const word of byLength([...FUNCTIONS, "pi", "x"])) text = text.split(word).join(" ");
      return operation && [...text].every((c) => DIGITS.includes(c) || OPS.includes(c) || " .,".includes(c));
    }

    const ACADEMIC_KINDS = ["logic", "truth_table", "sets", "linalg", "calculus", "combinatorics"];
    const hasKeyword = (message, cfg) => cfg.academic.keywords.some((k) => message.toLowerCase().includes(k));

    function auto(message, cfg) {
      const done = run(message, cfg, "HEBREW");
      if (done.error !== null) return false;
      if (done.command) return true;
      const A = window.FlomaCalcAcademic;
      if (ACADEMIC_KINDS.includes(done.kind)) {
        // A typed formula, a math keyword, or dictation that became a formula entirely ("לא אמת" stays chat).
        if (A.formalOnly(A.basic(message, cfg)) || hasKeyword(message, cfg)) return true;
        if (done.normalized && A.formalOnly(done.normalized)) {
          return !["logic", "truth_table"].includes(done.kind) || A.hasConnective(done.normalized);
        }
        return false;
      }
      if (hasKeyword(message, cfg)) return true;
      if (done.normalized && mathOnly(done.normalized)) return true;
      return mathOnly(message) && (done.steps.length > 0 || done.kind === "equation" || done.kind === "check");
    }

    function answer(query, language, cfg, icon, name) {
      const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
      const t = cfg.text;
      const done = run(query, cfg, lang);
      if (done.error !== null) return { text: fill(t[done.error][lang], { icon, ...done.values }), sources: [], copy: null };
      const lines = [fill(t.head[lang], { icon, name, kind: t.kinds[done.kind][lang] }), fill(t.input[lang], { input: done.input })];
      if (done.normalized) lines.push(fill(t.normalized[lang], { expr: done.normalized }));
      lines.push(fill(t.result[lang], { result: done.result }), "");
      const shown = done.steps.slice(0, cfg.max_steps);
      if (shown.length) {
        lines.push(t.steps[lang], ...shown.map((s, i) => `${i + 1}. ${s}`));
        if (done.steps.length > shown.length) lines.push(fill(t.more_steps[lang], { count: done.steps.length - shown.length }));
      } else lines.push(t.no_steps[lang]);
      if (done.table.length) lines.push("", t.table[lang], ...done.table);
      lines.push("", t.footer[lang]);
      return { text: lines.join("\n"), sources: [], copy: done.result };
    }

    return { fmt, check, run, auto, answer, mathOnly };
  })();

  const calcConfig = (reg) => byId("calc", reg).calc;

  function calcAnswer(query, language, reg) {
    const skill = byId("calc", reg);
    return Calc.answer(query, language, skill.calc, skill.icon, name(skill, language));
  }

  const calcText = (key, language, reg) => calcConfig(reg).text[key][language === "ENGLISH" ? "ENGLISH" : "HEBREW"];

  window.FlomaSkills = {
    norm, variants, levenshtein, analyze, search, reply, resolve, answer, activatedText, mentionMatches, mentionToken,
    findNumber, phoneInfo, phoneMatches, translateRequest, translateCaption, translateText, textLanguage,
    calcAnswer, calcText, calcFmt: Calc.fmt, calcCheck: Calc.check, calcRun: Calc.run, urlKey, exactMatches,
    skills, byId, name, description, text, vault: vaultData,
  };
})();
