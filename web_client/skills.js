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

  function search(query, config, vault) {
    const asked = analyze(query, config, vault);
    const { terms } = asked;
    const prefixes = config.hebrew_prefixes;
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
  const IMPLEMENTED = ["vault", "phone", "translate"];
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

  window.FlomaSkills = {
    norm, variants, levenshtein, analyze, search, reply, resolve, answer, activatedText, mentionMatches, mentionToken,
    findNumber, phoneInfo, phoneMatches, translateRequest, translateCaption, translateText, textLanguage,
    skills, byId, name, description, text, vault: vaultData,
  };
})();
