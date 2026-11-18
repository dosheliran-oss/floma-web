/*
 * Floma web app - the Floma engine in the browser: the message router, the prompt layout around
 * the active persona, the Gemini client with model fallback, and local (offline) answers. No UI
 * code here (that's app.js), so the logic can be tried in Chrome on its own.
 *
 * Floma (persona/floma_platform.js) is the platform; the assistant is a profile from
 * persona/personas.js ("toby" or the neutral "floma"). Same rules as persona.py and the Android
 * core, checked against persona-tests/persona_cases.json:
 *   floma_platform.js + personas.js -> FlomaCore.buildPrompt, avatarImage, offlineAnswer, ...
 *   MessageRouter.kt       -> FlomaCore.route / modelFor
 *   SeriousModeCommand.kt  -> FlomaCore.detectSeriousMode
 *   GeminiModels.kt        -> FlomaCore.MODELS
 *   AIService.kt           -> FlomaCore.complete / verifyKey
 *
 * A classic script (not an ES module) on purpose: Chrome blocks modules on file:// pages, and
 * this client must open by double-clicking index.html.
 */
(function () {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
  // Models and emotions come from the Floma platform file (like Android's GeminiModels / CharacterState).
  const MODELS = { DEFAULT: window.FLOMA_PLATFORM.models.default, RESEARCH: window.FLOMA_PLATFORM.models.research };
  const EMOTIONS = window.FLOMA_PLATFORM.emotions.map((e) => e.key);
  const RECENT_WINDOW = 20;

  const DEFAULT_SETTINGS = {
    persona: "floma", // the assistant profile (personas.js): Floma by default, "toby" is the add-on
    assistantName: "",
    theme: "midnight", // floma_platform.js "themes"
    modelChoice: "AUTO", // AUTO | FLASH | LITE
    voiceRate: 1,
    voicePitch: 1,
    personality: "FRIENDLY", // FRIENDLY | PLAYFUL | PROFESSIONAL | CONCISE
    humorLevel: 0.6,
    language: "HEBREW", // HEBREW | ENGLISH
    customInstructions: "",
    seriousMode: false,
    webSearch: true, // the "Web search" extension; off = never attach Google Search
    speakReplies: false, // Toby reads his replies aloud (browser/OS text-to-speech); opt-in on the web
  };

  // --- Router (MessageRouter.kt) ----------------------------------------------------------------

  const UPGRADE_KEYWORDS = ["בדוק", "בצע מחקר"];
  const JOKE_KEYWORDS = ["בדיחה", "בדיחות", "ספר לי בדיחה"];
  const LIVE_DATA_KEYWORDS = [
    "לוטו", "הגרלת", "מספרי הלוטו", "מספר הטלפון", "מספר טלפון", "המספר של", "הטלפון של",
    "מזג האוויר", "מזג אוויר", "שער הדולר", "שער היורו", "חדשות", "תוצאות",
    "lottery", "lotto", "phone number", "weather", "exchange rate", "news",
  ];
  const SEARCH_KEYWORDS = [...UPGRADE_KEYWORDS, ...JOKE_KEYWORDS, ...LIVE_DATA_KEYWORDS];
  const PC_KEYWORDS = ["במחשב", "למחשב", "on the pc", "on my pc", "on the computer", "on my computer"];

  // Device commands are only *recognized* here, so Toby can say they need the Android app. The
  // full grammar lives in DeviceActionHandler.kt / PcCommandParser.kt.
  const PC_STARTS = ["פצל מסך", "פצל את המסך", "תפצל מסך", "תפצל את המסך", "split screen", "split the screen",
    "פתח תיקייה", "פתח תיקיה", "תפתח תיקייה", "תפתח תיקיה", "open folder", "open the folder"];
  const PHONE_STARTS = [
    "הדלק פנס", "תדליק פנס", "תדליק את הפנס", "כבה פנס", "תכבה פנס", "תכבה את הפנס", "turn on the flashlight",
    "turn off the flashlight", "flashlight", "תעיר אותי", "wake me", "שעון מעורר", "קבע שעון מעורר",
    "תקבע שעון מעורר", "set an alarm", "set alarm", "קבע טיימר", "תקבע טיימר", "תפעיל טיימר", "set a timer",
    "start a timer", "התקשר", "תתקשר", "חייג", "תחייג", "call", "dial", "שלח הודעה", "תשלח הודעה",
    "send a message", "send a text", "נווט", "תנווט", "navigate", "פתח", "תפתח", "open", "launch",
  ];
  const ACTION_VERBS = ["פתח", "תפתח", "סגור", "תסגור", "הפעל", "תפעיל", "כבה", "תכבה", "נגן", "תנגן", "כתוב",
    "תכתוב", "צור", "תיצור", "מחק", "תמחק", "שנה", "תשנה", "פצל", "תפצל", "open", "close", "start", "launch",
    "play", "pause", "stop", "write", "create", "delete", "change", "set", "split"];
  const POLITE_PREFIXES = ["היי", "הי", "טובי", "בבקשה", "אפשר", "תוכל", "hey", "hi", "toby", "please", "can you", "could you"];

  const CONTACT_HE = /^(?:(?:מה|תן לי|תני לי|תביא לי|יש לך|אפשר|תגיד לי|תמצא לי)\s+)?(?:את\s+)?(?:ה?מספר(?:\s+ה?טלפון)?|ה?טלפון|ה?נייד)\s+של\s+(.+)$/;
  const CONTACT_EN_OF = /^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:phone\s+)?number\s+(?:of|for)\s+(.+)$/;

  function normalize(text) {
    return text.toLowerCase().replace(/[,!?;"'״׳\-()…]/g, " ").replace(/\s+/g, " ").trim();
  }

  function startsWithWord(text, phrase) {
    return text.startsWith(phrase) && (text.length === phrase.length || text[phrase.length] === " ");
  }

  function stripPolite(command) {
    let result = command;
    for (;;) {
      const prefix = POLITE_PREFIXES.find((p) => startsWithWord(result, p));
      if (!prefix) return result;
      result = result.slice(prefix.length).trim();
    }
  }

  function modelFor(text) {
    const lower = text.toLowerCase();
    return SEARCH_KEYWORDS.some((k) => lower.includes(k)) ? MODELS.RESEARCH : MODELS.DEFAULT;
  }

  function targetsPc(text) {
    const padded = ` ${text.toLowerCase()} `;
    return PC_KEYWORDS.some((k) => padded.includes(` ${k} `));
  }

  /** SeriousModeCommand.kt: "ENTER", "EXIT" or null. */
  function detectSeriousMode(text) {
    const normalized = text.toLowerCase().replace(/[,!?.;:"'״׳\-()…]/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    const padded = ` ${normalized} `;
    const exits = ["אפשר לצחוק", "אפשר לחזור לצחוק", "תחזור לצחוק", "חזור לצחוק", "תחזור להיות מצחיק",
      "חזור להיות מצחיק", "בוא נצחק", "you can joke again", "joke mode on", "back to jokes"];
    if (exits.some((p) => padded.includes(` ${p} `))) return "EXIT";
    const words = normalized.split(" ");
    if (words.includes("ברצינות")) return "ENTER";
    const followers = ["כבר", "עם", "די", "טובי", "לצחוק", "להתבדח", "עכשיו", "זהו", "נו", "יאללה"];
    const enough = words.indexOf("מספיק");
    if (enough >= 0 && (words.length <= 2 || (enough === 0 && followers.includes(words[1])) ||
        (enough === 1 && words[0] === "די"))) return "ENTER";
    return null;
  }

  /**
   * Same order as MessageRouter.kt. Returns { seriousChange, route } where route is one of
   *   { kind: "unavailable", extension: "pc" | "phone" | "contacts" }  - needs the Android app
   *   { kind: "model", model, webSearch }
   */
  function route(text, settings) {
    const trimmed = text.trim();
    const seriousChange = detectSeriousMode(trimmed);
    const command = stripPolite(normalize(trimmed));
    const isPc = PC_STARTS.some((p) => command.startsWith(p)) ||
      (targetsPc(command) && ACTION_VERBS.some((v) => command.startsWith(`${v} `)));
    if (isPc) return { seriousChange, route: { kind: "unavailable", extension: "pc" } };
    if (PHONE_STARTS.some((p) => startsWithWord(command, p)) && !startsWithWord(command, "call me")) {
      return { seriousChange, route: { kind: "unavailable", extension: "phone" } };
    }
    const model = modelFor(trimmed);
    const contact = CONTACT_HE.exec(command) || CONTACT_EN_OF.exec(command);
    // A business number is still worth a web search; only a personal contact needs the phone.
    if (contact && !(settings.webSearch && model === MODELS.RESEARCH)) {
      return { seriousChange, route: { kind: "unavailable", extension: "contacts" } };
    }
    const webSearch = settings.webSearch && model === MODELS.RESEARCH;
    return { seriousChange, route: { kind: "model", model: webSearch ? MODELS.RESEARCH : MODELS.DEFAULT, webSearch } };
  }

  // --- Platform and persona (../persona/*.js; same rules as persona.py / PromptManager.kt) -------

  const P = () => {
    if (!window.FLOMA_PLATFORM) throw new Error("persona/floma_platform.js is not loaded");
    return window.FLOMA_PLATFORM;
  };
  const DEFAULT_PERSONA = "floma"; // Floma, the neutral assistant, is the default; Toby is an add-on

  function personas() {
    if (!window.FLOMA_PERSONAS) throw new Error("persona/personas.js is not loaded");
    return window.FLOMA_PERSONAS;
  }

  /** The assistant profile; unknown ids load Toby. */
  function profile(persona) {
    const all = personas();
    return all[persona || DEFAULT_PERSONA] || all[DEFAULT_PERSONA];
  }

  function personaId(persona) { return persona in personas() ? persona : DEFAULT_PERSONA; }

  /** The user's name for the assistant, or the persona's; another persona's default name follows the active one. */
  function assistantName(name, persona) {
    const trimmed = (name || "").trim();
    const active = profile(persona).default_name;
    const defaults = Object.values(personas()).map((p) => p.default_name);
    return !trimmed || (trimmed !== active && defaults.includes(trimmed)) ? active : trimmed;
  }

  /** Switching persona: a name that was the old persona's default follows the new one; a chosen name stays. */
  function nameAfterSwitch(name, oldPersona, newPersona) {
    const trimmed = (name || "").trim();
    return !trimmed || trimmed === profile(oldPersona).default_name ? profile(newPersona).default_name : trimmed;
  }

  /** Replaces {key} placeholders; the user's own text (name, notes, answer) is filled last. */
  function fill(template, values) {
    const late = ["name", "notes", "answer", "question", "text"];
    const keys = Object.keys(values).filter((k) => !late.includes(k)).concat(late.filter((k) => k in values));
    let out = template;
    for (const key of keys) out = out.split(`{${key}}`).join(String(values[key]));
    return out;
  }

  function humorPercent(level) {
    const value = typeof level === "number" && !Number.isNaN(level) ? level : DEFAULT_SETTINGS.humorLevel;
    return Math.floor(Math.min(1, Math.max(0, value)) * 100 + 0.5);
  }

  /** The shared builder: identical output to persona.py and PromptManager.kt (persona-tests). */
  function buildPrompt({ platform, name, personality, humor, language, serious, webSearch, memory = "", custom = "", persona = DEFAULT_PERSONA }) {
    const p = P();
    const prof = profile(persona);
    const who = assistantName(name, persona);
    const where = p.platforms[platform];
    const [kill1, kill2] = p.kill_phrases;
    const percent = humorPercent(humor);
    const lines = [fill(prof.intro, { here: where.here, name: who }), "", "# Floma, on all your devices"];
    lines.push(...p.ecosystem.map((l) => fill(l, { name: who })));
    lines.push("", "# Personality");
    if (serious) {
      lines.push(fill(prof.serious, { kill1, kill2, focus: where.focus }));
    } else if (prof.personalities) {
      lines.push(prof.personalities[personality] || prof.personalities.FRIENDLY);
      lines.push(fill(prof.humor_dial, { humor: percent }));
      if (prof.humorous_personalities.includes(personality) && percent > 0) {
        lines.push("", "# Your attitude", ...prof.attitude.map((l) => fill(l, { kill1, kill2 })));
      }
    } else {
      lines.push(prof.style);
    }
    lines.push("", "# Being a companion", ...p.companion);
    lines.push("", "# Language", fill(p.language, { language }), "", "# Length", p.length);
    lines.push("", "# What you can do here", where.can, webSearch ? p.web_search_on : p.web_search_off);
    if (webSearch && !serious && (prof.humor_sources || []).length) {
      lines.push("", "# Humor sources", prof.humor_sources_intro, ...prof.humor_sources.map((s) => `- ${s}`), prof.humor_sources_outro);
    }
    lines.push("", "# Reply format", ...p.reply_format, ...p.emotions.map((e) => `  ${e.key}: ${e.when}`));
    if (memory.trim()) {
      lines.push("", "# What you remember about the user", p.memory_intro, "<memory>", memory.trim(), "</memory>");
    }
    if (custom.trim()) lines.push("", "# The user's own instructions", p.custom_intro, custom.trim());
    return lines.join("\n").trim();
  }

  function systemPrompt(settings, webSearch, memory = "") {
    return buildPrompt({
      platform: "web",
      name: settings.assistantName || "",
      personality: settings.personality,
      humor: settings.humorLevel,
      language: settings.language === "ENGLISH" ? "English" : "Hebrew",
      serious: !!settings.seriousMode,
      webSearch,
      memory,
      custom: settings.customInstructions || "",
      persona: settings.persona || DEFAULT_PERSONA,
    });
  }

  /** What goes inside <memory>: the shared category notes, or the local summary. */
  function memoryNotes(sections, summary = "") {
    const p = P();
    const parts = [];
    for (const c of p.memory_categories) {
      const notes = (sections[c.key] || "").trim();
      if (notes) parts.push(`${fill(p.memory_section, { title: c.title })}\n${notes}`);
    }
    const text = parts.length ? parts.join("\n\n") : (summary || "").trim();
    return text.slice(0, p.memory_max_chars).trimEnd();
  }

  function summarizerPrompt(name) {
    const p = P();
    return `${fill(p.summarizer, { name })}\n${p.memory_categories.map((c) => `- ${c.key}: ${c.description}`).join("\n")}`;
  }

  /** One bullet line as a fact: the "- " / "* " / "• " bullet and surrounding spaces dropped. */
  function fact(line) {
    const trimmed = line.trim();
    for (const bullet of ["- ", "* ", "\u2022 "]) if (trimmed.startsWith(bullet)) return trimmed.slice(bullet.length).trim();
    return trimmed;
  }

  /**
   * One category as stored in the Firebase memory (memory_sync.root/<key>): the facts only, plus when
   * and where they were last written. Never conversation text (same as persona.py and MemoryFiles.kt).
   */
  function memoryNode(key, notes, updatedAt, device) {
    const facts = notes.replace(/\r\n/g, "\n").split("\n").map(fact).filter(Boolean);
    return { facts: facts.slice(0, P().memory_sync.max_facts), updated_at: Math.trunc(updatedAt), device };
  }

  /** A category's notes ("- fact" lines) from a Firebase node; anything unreadable reads as empty. */
  function notesFromNode(node) {
    let facts = node && typeof node === "object" && !Array.isArray(node) ? node.facts : null;
    if (typeof facts === "string") facts = facts.split("\n");
    if (facts && typeof facts === "object" && !Array.isArray(facts)) { // an array with gaps, keyed by index
      facts = Object.keys(facts).sort((a, b) => (/^\d+$/.test(a) ? +a : 0) - (/^\d+$/.test(b) ? +b : 0)).map((k) => facts[k]);
    }
    if (!Array.isArray(facts)) return "";
    // Strings and whole numbers only (not booleans or floats: they print differently on each platform).
    return facts
      .filter((f) => typeof f === "string" || Number.isInteger(f))
      .map((f) => fact(String(f)))
      .filter(Boolean)
      .map((f) => `- ${f}`)
      .join("\n");
  }

  // --- Gemini client (AIService.kt) -------------------------------------------------------------

  class AiError extends Error {
    /**
     * kind: MISSING_KEY | INVALID_KEY | RATE_LIMITED | QUOTA_EXCEEDED | SERVER | NETWORK | TIMEOUT |
     * REFUSED | BAD_RESPONSE. Toby's line and pose for each are in the persona file (errorLine).
     */
    constructor(kind, detail) {
      super(`${kind}${detail ? `: ${detail}` : ""}`);
      this.kind = kind;
    }
  }

  function errorFor(status, body) {
    if (status === 401 || status === 403) return "INVALID_KEY";
    if (status === 400 && body.includes("API_KEY_INVALID")) return "INVALID_KEY";
    // RESOURCE_EXHAUSTED: a daily quota ("...PerDay..." in the QuotaFailure) is gone for hours,
    // a per-minute limit only for a moment.
    if (status === 429) return body.includes("PerDay") ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
    if (status >= 500) return "SERVER";
    return "BAD_RESPONSE";
  }

  async function post(apiKey, model, body) {
    // A hung request must end: after waiting.timeout_ms Toby says Gemini took too long.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), P().waiting.timeout_ms);
    try {
      let response;
      try {
        response = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: "POST",
          // Header, not ?key=, so the key never appears in URLs, history or logs.
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        throw new AiError(controller.signal.aborted ? "TIMEOUT" : "NETWORK", e.message);
      }
      let text;
      try {
        text = await response.text();
      } catch (e) {
        throw new AiError(controller.signal.aborted ? "TIMEOUT" : "NETWORK", e.message);
      }
      if (!response.ok) throw new AiError(errorFor(response.status, text), `HTTP ${response.status}`);
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  function parseResponse(raw) {
    let json;
    try { json = JSON.parse(raw); } catch (e) { throw new AiError("BAD_RESPONSE", "unparseable"); }
    const candidate = json.candidates && json.candidates[0];
    if (!candidate) throw new AiError("REFUSED", "no candidates");
    if (candidate.finishReason === "MAX_TOKENS") throw new AiError("BAD_RESPONSE", "cut off");
    if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(candidate.finishReason)) {
      throw new AiError("REFUSED", candidate.finishReason);
    }
    const parts = (candidate.content && candidate.content.parts) || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
    let reply;
    try { reply = JSON.parse(text); } catch (e) { throw new AiError("BAD_RESPONSE", "reply is not JSON"); }
    const replyText = String(reply.text || "").trim();
    if (!replyText) throw new AiError("BAD_RESPONSE", "empty reply");
    const meta = candidate.groundingMetadata;
    const sources = [];
    if (meta && Array.isArray(meta.groundingChunks)) {
      for (const chunk of meta.groundingChunks) {
        const uri = chunk.web && chunk.web.uri;
        if (uri && uri.startsWith("https://") && !sources.some((s) => s.uri === uri)) {
          sources.push({ title: chunk.web.title || uri, uri });
        }
      }
    }
    return {
      text: replyText,
      emotion: EMOTIONS.includes(reply.emotion) ? reply.emotion : P().avatar.default,
      sources,
      // Google requires showing the Search Suggestions chip when grounding was used.
      searchWidget: (meta && meta.searchEntryPoint && meta.searchEntryPoint.renderedContent) || null,
    };
  }

  /** Gemini `contents`, merging consecutive same-role turns, starting with a user turn. */
  function contents(history) {
    const turns = history.slice(-RECENT_WINDOW);
    while (turns.length && turns[0].role !== "user") turns.shift();
    const merged = [];
    for (const turn of turns) {
      const last = merged[merged.length - 1];
      if (last && last.role === turn.role) last.parts[0].text += `\n\n${turn.text}`;
      else merged.push({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] });
    }
    return merged;
  }

  /** Puts a picture ({ mime, data: base64 }) before the newest user turn's text, as Gemini inline_data. */
  function withImage(turns, image) {
    const last = turns[turns.length - 1];
    if (image && last && last.role === "user") last.parts.unshift({ inline_data: { mime_type: image.mime, data: image.data } });
    return turns;
  }

  function requestBody(prompt, history, model, webSearch, image = null) {
    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, emotion: { type: "STRING", enum: EMOTIONS } },
        required: ["text", "emotion"],
      },
    };
    if (model === MODELS.DEFAULT) generationConfig.thinkingConfig = { thinkingLevel: "low" };
    const body = { systemInstruction: { parts: [{ text: prompt }] }, contents: withImage(contents(history), image), generationConfig };
    if (webSearch) body.tools = [{ google_search: {} }];
    return body;
  }

  /**
   * Toby's next reply. history: [{ role: "user" | "assistant", text }]. With webSearch, a refused
   * search request (no Search quota on the key: 429, or a 400) is retried once without the tool.
   * memory: what goes inside <memory> (memoryNotes).
   */
  // --- Models and fallback --------------------------------------------------------------------

  /** The model to try first: the user's fixed choice (FLASH / LITE), or the router's pick (AUTO). */
  function modelForChoice(choice, routed) {
    const fixed = P().models.choices.find((c) => c.key === choice && c.model);
    return fixed ? fixed.model : routed;
  }

  /** [first, then every other model in the fallback order]. */
  function modelChain(first) {
    return [first, ...P().models.fallback_order.filter((m) => m !== first)];
  }

  const fallsBack = (kind) => P().models.fallback_errors.includes(kind);
  const goesOffline = (kind) => P().models.offline_errors.includes(kind);

  /**
   * The assistant's next reply. The first model is the user's choice or the router's; if it times
   * out, fails, is unreachable or out of quota, the next model in the chain is tried quietly. Key and
   * content problems (invalid key, refusal) are not retried. Returns the reply plus which model answered.
   */
  async function complete(apiKey, settings, history, routeInfo, memory = "", image = null) {
    if (!apiKey) throw new AiError("MISSING_KEY");
    const chain = modelChain(modelForChoice(settings.modelChoice, routeInfo.model));
    let failure = null;
    for (const model of chain) {
      try {
        const reply = await completeWith(apiKey, settings, history, model, routeInfo.webSearch, memory, image);
        return Object.assign(reply, { model, fellBack: model !== chain[0] });
      } catch (e) {
        if (!(e instanceof AiError) || !fallsBack(e.kind)) throw e;
        failure = e;
      }
    }
    throw failure;
  }

  async function completeWith(apiKey, settings, history, model, webSearch, memory, image) {
    if (webSearch) {
      try {
        return parseResponse(await post(apiKey, model, requestBody(systemPrompt(settings, true, memory), history, model, true, image)));
      } catch (e) {
        if (!(e instanceof AiError) || !["RATE_LIMITED", "QUOTA_EXCEEDED", "BAD_RESPONSE"].includes(e.kind)) throw e;
      }
    }
    return parseResponse(await post(apiKey, model, requestBody(systemPrompt(settings, false, memory), history, model, false, image)));
  }

  /**
   * Folds older conversation into the memory notes (AIService.summarizeMemory): returns
   * { summary, sections: { key: notes } }. Uses the cheap model.
   */
  async function summarizeMemory(apiKey, name, previousSummary, previousSections, conversation) {
    const p = P();
    const transcript = conversation.map((t) => `${t.role === "user" ? "User" : name}: ${t.text}`).join("\n");
    const current = p.memory_categories.filter((c) => (previousSections[c.key] || "").trim())
      .map((c) => `[${c.key}]\n${previousSections[c.key]}`);
    const userContent = [
      "<current_notes>", (previousSummary || "").trim() || "(none yet)", "</current_notes>", "",
      "<current_sections>", ...(current.length ? current : ["(none yet)"]), "</current_sections>", "",
      "<new_conversation>", transcript, "</new_conversation>",
    ].join("\n");
    const properties = {};
    for (const c of p.memory_categories) properties[c.key] = { type: "STRING" };
    const body = {
      systemInstruction: { parts: [{ text: summarizerPrompt(name) }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            sections: { type: "OBJECT", properties, required: p.memory_categories.map((c) => c.key) },
          },
          required: ["summary", "sections"],
        },
        thinkingConfig: { thinkingLevel: "low" },
      },
    };
    const raw = JSON.parse(await post(apiKey, MODELS.DEFAULT, body));
    const parts = (raw.candidates && raw.candidates[0] && raw.candidates[0].content && raw.candidates[0].content.parts) || [];
    let json;
    try {
      json = JSON.parse(parts.filter((x) => !x.thought).map((x) => x.text || "").join(""));
    } catch (e) {
      throw new AiError("BAD_RESPONSE", "memory reply is not JSON");
    }
    const sections = {};
    for (const c of p.memory_categories) {
      const notes = String((json.sections || {})[c.key] || "").trim();
      if (notes) sections[c.key] = notes;
    }
    return { summary: String(json.summary || "").trim(), sections };
  }

  /** null if Google accepts the key, otherwise an AiError kind (no tokens are spent). */
  async function verifyKey(apiKey) {
    try {
      const response = await fetch(`${API_BASE}?pageSize=1`, { headers: { "x-goog-api-key": apiKey.trim() } });
      if (response.ok) return null;
      return errorFor(response.status, await response.text());
    } catch (e) {
      return "NETWORK";
    }
  }

  // --- The assistant in the chat UI (persona.py: avatar_image, avatar_for, chat_line, ...) -------

  function emotionEntry(emotion) {
    const p = P();
    return p.emotions.find((e) => e.key === emotion) || p.emotions.find((e) => e.key === p.avatar.default);
  }

  /** The persona's picture for an emotion: Toby's art per emotion, or the neutral assistant's logo. */
  function avatarImage(emotion, persona) {
    const prof = profile(persona);
    const images = prof.images || {};
    return images[emotion] || images[P().avatar.default] || prof.logo;
  }

  /** True if the persona has per-emotion art that moves (Toby); a logo stays still. */
  function animated(persona) { return Object.keys(profile(persona).images || {}).length > 0; }

  function greeting(language, name, persona) {
    const lines = profile(persona).greeting;
    return fill(lines[language] || lines.HEBREW, { name: assistantName(name, persona) });
  }

  /** The emotion's body language ("breathe", "bounce", ...), animated by styles.css. */
  function emotionMotion(emotion) { return emotionEntry(emotion).motion; }

  /** Toby's pose for an app event: "default", "greeting", "thinking", "action_done", ... */
  function avatarFor(event) {
    const avatar = P().avatar;
    return avatar[event] || avatar.default;
  }

  /** A waiting line ("typing" | "slow" | "very_slow") in the chat language. */
  function chatLine(key, language, name, persona) {
    const p = P();
    const lines = p.chat_lines[language] || p.chat_lines.HEBREW;
    return fill(lines[key], { name: assistantName(name, persona) });
  }

  /** [what Toby says, the emotion he shows] for a failed request; unknown kinds read as BAD_RESPONSE. */
  function errorLine(kind, language) {
    const errors = P().errors;
    const entry = errors[kind] || errors.BAD_RESPONSE;
    return [entry[language] || entry.HEBREW, entry.emotion];
  }

  /**
   * Toby's friendly reply when the browser can't do something ("pc" | "phone" | "contacts"): he says
   * he's in the browser and which Floma app can do it. Local only, never sent to the model.
   */
  function unavailableLine(extension, language, platform = "web") {
    const lines = P().platforms[platform].unavailable[extension];
    return lines[language] || lines.HEBREW;
  }

  /** "typing", then "slow" after ~2.5 s, then "very_slow" after ~12 s of waiting. */
  function typingStage(elapsedMs) {
    const waiting = P().waiting;
    if (elapsedMs >= waiting.very_slow_after_ms) return "very_slow";
    if (elapsedMs >= waiting.slow_after_ms) return "slow";
    return "typing";
  }

  // --- Themes ---------------------------------------------------------------------------------

  /** A theme's colors (unknown ids get the default theme), without its label. */
  function theme(themeId) {
    const p = P();
    const chosen = p.themes[themeId] || p.themes[p.default_theme];
    const colors = {};
    for (const [k, v] of Object.entries(chosen)) if (k !== "label") colors[k] = v;
    return colors;
  }

  const label = (entry, language) => entry.label[language] || entry.label.HEBREW;

  // --- Local mode: answers without any server (persona.py offline_answer) ----------------------

  /** Lowercase words separated by single spaces: punctuation and Hebrew vowel marks removed. */
  function normalizeWords(text) {
    return text.toLowerCase().replace(/[\u0591-\u05c7]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).join(" ");
  }

  const containsWords = (norm, pattern) => ` ${norm} `.includes(` ${normalizeWords(pattern)} `);

  /** now: { year, month (1-12), day, weekday (0 = Monday), hour, minute }. */
  function formatDate(now, language) {
    const off = P().offline;
    const lang = off.date_format[language] ? language : "HEBREW";
    return fill(off.date_format[lang], {
      weekday: off.weekdays[lang][now.weekday], day: now.day, month: off.months[lang][now.month - 1], year: now.year,
    });
  }

  /** The current time as offlineAnswer's `now`. */
  function nowParts(date = new Date()) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
      weekday: (date.getDay() + 6) % 7, hour: date.getHours(), minute: date.getMinutes() };
  }

  /**
   * What the assistant says when no model can be reached: time, date or memory questions answered on
   * the device, a repeat of an earlier answer to the very same question, a hello or thanks, or an honest
   * "I'm in local mode". history: earlier messages, not including this one. Returns { text, emotion, kind }.
   */
  function offlineAnswer(text, language, now, notes = "", history = [], hasImage = false, hasDocument = false) {
    const off = P().offline;
    const lang = off.date_format[language] ? language : "HEBREW";
    const norm = normalizeWords(text);
    if (hasImage) { // seeing a picture needs the model: say so instead of guessing
      const vision = P().vision.offline;
      return { text: vision.reply[lang], emotion: vision.emotion, kind: "image_offline" };
    }
    if (hasDocument) { // so does reading a document
      const docs = P().documents.offline;
      return { text: docs.reply[lang], emotion: docs.emotion, kind: "document_offline" };
    }
    const intent = (key) => {
      const entry = off.intents.find((i) => i.key === key);
      return entry.patterns.some((pattern) => containsWords(norm, pattern)) ? entry : null;
    };
    const reply = (entry, kind, values = {}) => ({ text: fill(entry.reply[lang], values), emotion: entry.emotion, kind });
    const pad = (n) => String(n).padStart(2, "0");

    let entry = intent("time");
    if (entry) return reply(entry, "time", { time: `${pad(now.hour)}:${pad(now.minute)}` });
    entry = intent("date");
    if (entry) return reply(entry, "date", { date: formatDate(now, lang) });
    entry = intent("memory");
    if (entry) {
      if (notes.trim()) return reply(entry, "memory", { notes: notes.trim() });
      return { text: entry.empty[lang], emotion: entry.emotion, kind: "memory" };
    }
    if (norm) {
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === "user" && !m.local && normalizeWords(m.text || "") === norm) {
          const answer = history.slice(i + 1).find((a) => a.role === "assistant" && !a.local && !a.error);
          if (answer) return reply(off.cached, "cached", { answer: answer.text.trim() });
          break;
        }
      }
    }
    for (const key of ["greeting", "thanks"]) {
      entry = intent(key);
      if (entry) return reply(entry, key);
    }
    return reply(off.fallback, "fallback");
  }

  // --- Wake words ---------------------------------------------------------------------------

  function wakePhrases(persona, name = "") {
    const prof = profile(persona);
    const phrases = [...prof.wake_words];
    const custom = (name || "").trim();
    if (custom && custom !== prof.default_name) phrases.push(`hey ${custom}`, `היי ${custom}`);
    return phrases.map(normalizeWords);
  }

  function isWakePhrase(transcript, persona, name = "") {
    const norm = normalizeWords(transcript);
    return Boolean(norm) && wakePhrases(persona, name).some((phrase) => ` ${norm} `.includes(` ${phrase} `));
  }

  /** The text sent with a picture: what the user wrote, or "What's in this picture?". */
  function imagePrompt(text, language) {
    const lines = P().vision.default_prompt;
    return text.trim() || lines[language] || lines.HEBREW;
  }

  // --- Documents (persona.py document_context): lengths count Unicode code points everywhere ---

  function cleanDocumentText(text) {
    let out = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f﻿]/g, ""); // control characters and byte-order marks
    out = (out + "\n").replace(/[ \t]+\n/g, "\n");
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * The message sent to Gemini for a document: its text inside <document> tags (material, not
   * instructions), then the question. Longer than max_chars: the beginning and the end are kept.
   * Returns { prompt, chars, truncated, omitted, question }.
   */
  function documentContext(name, text, question, language, pages = 0) {
    const d = P().documents;
    let points = Array.from(cleanDocumentText(text));
    const chars = points.length;
    let omitted = 0;
    let body = points.join("");
    if (chars > d.max_chars) {
      omitted = chars - d.head_chars - d.tail_chars;
      const note = fill(d.omitted_note, { omitted });
      body = `${points.slice(0, d.head_chars).join("").trimEnd()}\n\n${note}\n\n${points.slice(chars - d.tail_chars).join("").trimStart()}`;
    }
    points = null;
    const asked = question.trim() || d.default_prompt[language] || d.default_prompt.HEBREW;
    const safeName = Array.from(name.replace(/[<>"]/g, "").trim()).slice(0, 120).join("") || "document";
    const prompt = fill(d.context_template, {
      name: safeName, pages: pages || "", chars, truncated: omitted ? ' truncated="true"' : "", question: asked, text: body,
    });
    return { prompt, chars, truncated: omitted > 0, omitted, question: asked };
  }

  function documentLine(key, language) {
    const lines = P().documents[key];
    return lines[language] || lines.HEBREW;
  }

  // --- Cloud voice (ElevenLabs): the same request on every platform (persona/floma_platform.js) ---

  function validVoiceId(voiceId) {
    return Boolean(voiceId) && new RegExp(P().cloud_voice.voice_id_pattern).test(String(voiceId).trim());
  }

  /** What is read aloud: links dropped, whitespace collapsed, at most max_chars code points. */
  function speechText(text) {
    const limit = P().cloud_voice.max_chars;
    const clean = String(text).replace(/https?:\/\/[^ \t\r\n\f\v]+/g, "").replace(/[ \t\r\n\f\v]+/g, " ").replace(/^ +| +$/g, "");
    const points = Array.from(clean);
    if (points.length <= limit) return clean;
    const cut = points.slice(0, limit);
    let end = -1;
    for (let i = cut.length - 1; i >= 0; i--) if (".!?…".includes(cut[i])) { end = i; break; }
    if (end >= Math.floor(limit / 2)) return cut.slice(0, end + 1).join("");
    const space = cut.lastIndexOf(" ");
    return (space > 0 ? cut.slice(0, space) : cut).join("").replace(/^ +| +$/g, "");
  }

  /** The ElevenLabs request ({url, language, body}; the output format is added by the caller), or null. */
  function cloudVoiceRequest(text, voiceId) {
    const c = P().cloud_voice;
    const spoken = speechText(text);
    if (!spoken) return null;
    const language = /[\u0590-\u05ff]/.test(spoken) ? "HEBREW" : "ENGLISH";
    const voice = validVoiceId(voiceId) ? String(voiceId).trim() : c.default_voice_id;
    return { url: c.endpoint.replace("{voice_id}", voice), language, body: { text: spoken, model_id: c.models[language] } };
  }

  window.FlomaCore = {
    MODELS, EMOTIONS, DEFAULT_SETTINGS, AiError,
    route, modelFor, detectSeriousMode, systemPrompt, buildPrompt, memoryNotes, summarizerPrompt,
    memoryNode, notesFromNode, complete, summarizeMemory, verifyKey,
    personas, profile, personaId, assistantName, nameAfterSwitch,
    avatarImage, animated, greeting, emotionMotion, avatarFor, chatLine, errorLine, typingStage, unavailableLine,
    theme, label, modelForChoice, modelChain, fallsBack, goesOffline,
    normalizeWords, formatDate, nowParts, offlineAnswer, wakePhrases, isWakePhrase, imagePrompt, withImage,
    cleanDocumentText, documentContext, documentLine, validVoiceId, speechText, cloudVoiceRequest,
  };
})();
