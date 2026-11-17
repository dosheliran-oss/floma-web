/*
 * Floma web client - the chat core: Toby's persona prompt, the message router and the Gemini
 * client. No UI code here (that's app.js), so the logic can be tried in Chrome on its own.
 *
 * This is a browser port of the Android core. The Android files are the source of truth;
 * when they change, update the matching part here:
 *   toby_persona.js        -> FlomaCore.systemPrompt (shared file, assembled like persona.py)
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
  const MODELS = { DEFAULT: "gemini-3.5-flash-lite", RESEARCH: "gemini-3.5-flash" };
  // Toby's emotions come from the shared persona file (like Android's CharacterState and chat_core.py).
  const EMOTIONS = window.FLOMA_PERSONA.emotions.map((e) => e.key);
  const RECENT_WINDOW = 20;

  const DEFAULT_SETTINGS = {
    assistantName: "Toby",
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

  // --- Persona (shared ../persona/toby_persona.js; same assembly as persona.py / PromptManager.kt) ---

  const P = () => {
    if (!window.FLOMA_PERSONA) throw new Error("persona/toby_persona.js is not loaded");
    return window.FLOMA_PERSONA;
  };

  /** Replaces {key} placeholders; the user's own text (name, notes) is filled last. */
  function fill(template, values) {
    const late = ["name", "notes"];
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
  function buildPrompt({ platform, name, personality, humor, language, serious, webSearch, memory = "", custom = "" }) {
    const p = P();
    const who = name.trim() || p.default_name;
    const where = p.platforms[platform];
    const [kill1, kill2] = p.kill_phrases;
    const percent = humorPercent(humor);
    const lines = [fill(p.intro, { here: where.here, name: who }), "", "# Floma, on all your devices"];
    lines.push(...p.ecosystem.map((l) => fill(l, { name: who })));
    lines.push("", "# Personality");
    if (serious) {
      lines.push(fill(p.serious, { kill1, kill2, focus: where.focus }));
    } else {
      lines.push(p.personalities[personality] || p.personalities.FRIENDLY);
      lines.push(fill(p.humor_dial, { humor: percent }));
      if (p.humorous_personalities.includes(personality) && percent > 0) {
        lines.push("", "# Your attitude", ...p.attitude.map((l) => fill(l, { kill1, kill2 })));
      }
    }
    lines.push("", "# Being a companion", ...p.companion);
    lines.push("", "# Language", fill(p.language, { language }), "", "# Length", p.length);
    lines.push("", "# What you can do here", where.can, webSearch ? p.web_search_on : p.web_search_off);
    if (webSearch && !serious && p.humor_sources.length) {
      lines.push("", "# Humor sources", p.humor_sources_intro, ...p.humor_sources.map((s) => `- ${s}`), p.humor_sources_outro);
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

  function renderMemoryFile(key, notes, date) {
    const p = P();
    const c = p.memory_categories.find((x) => x.key === key);
    return fill(p.memory_file, { title: c.title, description: c.description, date, notes: notes.trim() });
  }

  function parseMemoryFile(content) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    while (lines.length && (!lines[0].trim() || lines[0].startsWith("# ") ||
        (lines[0].startsWith("_Toby's notes") && lines[0].trimEnd().endsWith("_")))) lines.shift();
    return lines.join("\n").trim();
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
    const timer = setTimeout(() => controller.abort(), window.FLOMA_PERSONA.waiting.timeout_ms);
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

  function requestBody(prompt, history, model, webSearch) {
    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, emotion: { type: "STRING", enum: EMOTIONS } },
        required: ["text", "emotion"],
      },
    };
    if (model === MODELS.DEFAULT) generationConfig.thinkingConfig = { thinkingLevel: "low" };
    const body = { systemInstruction: { parts: [{ text: prompt }] }, contents: contents(history), generationConfig };
    if (webSearch) body.tools = [{ google_search: {} }];
    return body;
  }

  /**
   * Toby's next reply. history: [{ role: "user" | "assistant", text }]. With webSearch, a refused
   * search request (no Search quota on the key: 429, or a 400) is retried once without the tool.
   * memory: what goes inside <memory> (memoryNotes).
   */
  async function complete(apiKey, settings, history, routeInfo, memory = "") {
    if (!apiKey) throw new AiError("MISSING_KEY");
    const { model, webSearch } = routeInfo;
    if (webSearch) {
      try {
        return parseResponse(await post(apiKey, model, requestBody(systemPrompt(settings, true, memory), history, model, true)));
      } catch (e) {
        if (!(e instanceof AiError) || !["RATE_LIMITED", "QUOTA_EXCEEDED", "BAD_RESPONSE"].includes(e.kind)) throw e;
      }
    }
    return parseResponse(await post(apiKey, model, requestBody(systemPrompt(settings, false, memory), history, model, false)));
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

  // --- Toby in the chat UI (persona.py: emotion_image, avatar_for, chat_line, error_line) ---------

  function emotionEntry(emotion) {
    const p = P();
    return p.emotions.find((e) => e.key === emotion) || p.emotions.find((e) => e.key === p.avatar.default);
  }

  /** The avatar file for an emotion; unknown values show the default pose. */
  function emotionImage(emotion) { return emotionEntry(emotion).image; }

  /** The emotion's body language ("breathe", "bounce", ...), animated by styles.css. */
  function emotionMotion(emotion) { return emotionEntry(emotion).motion; }

  /** Toby's pose for an app event: "default", "greeting", "thinking", "action_done", ... */
  function avatarFor(event) {
    const avatar = P().avatar;
    return avatar[event] || avatar.default;
  }

  /** A waiting line ("typing" | "slow" | "very_slow") in the chat language. */
  function chatLine(key, language, name) {
    const p = P();
    const lines = p.chat_lines[language] || p.chat_lines.HEBREW;
    return fill(lines[key], { name: (name || "").trim() || p.default_name });
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

  window.FlomaCore = {
    MODELS, EMOTIONS, DEFAULT_SETTINGS, AiError,
    route, modelFor, detectSeriousMode, systemPrompt, buildPrompt, memoryNotes, summarizerPrompt,
    renderMemoryFile, parseMemoryFile, complete, summarizeMemory, verifyKey,
    emotionImage, emotionMotion, avatarFor, chatLine, errorLine, typingStage, unavailableLine,
  };
})();
