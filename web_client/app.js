/*
 * Floma web client - UI: chat screen, settings drawer, first-launch key dialog.
 *
 * Storage (this browser only): the Gemini key, settings and the last messages live in
 * localStorage. The key is never written into the HTML or any file in the repository; it is
 * sent only to Google, in the x-goog-api-key header.
 */
(function () {
  "use strict";

  const Core = window.FlomaCore;
  const Memory = window.FlomaMemory;
  const Voice = window.FlomaVoice;
  const STORE = { key: "floma.apiKey", settings: "floma.settings", history: "floma.history" };
  const MAX_STORED = 200;
  const AVATAR_DIR = "../app/src/main/res/drawable-nodpi/";

  const STRINGS = {
    HEBREW: {
      settings: "הגדרות", close: "סגירה", send: "שליחה", placeholder: "כתבו לטובי…",
      subtitle: "בדפדפן, בכל מכשיר", empty: "היי, אני טובי. על מה נדבר?",
      sectionToby: "טובי", name: "שם", personality: "אישיות", humor: "רמת הומור", language: "שפה",
      serious: "מצב רציני (בלי בדיחות)", instructions: "הוראות משלכם",
      pFriendly: "הומוריסטי וחברותי", pPlayful: "הומוריסטי מאוד", pProfessional: "רציני ומקצועי", pConcise: "רציני ותמציתי",
      sectionModel: "מודל (Gemini)", keySaved: "מפתח שמור בדפדפן הזה.", keyMissing: "אין מפתח שמור.",
      changeKey: "החלפת מפתח", removeKey: "מחיקת מפתח", addKey: "הוספת מפתח",
      sectionMemory: "זיכרון", memoryHint: "ההודעות האחרונות נשמרות בדפדפן הזה בלבד.", clearChat: "מחיקת השיחה",
      confirmClear: "למחוק את כל השיחה מהדפדפן הזה?", confirmRemoveKey: "למחוק את המפתח מהדפדפן הזה?",
      sectionExtensions: "תוספים", extSearch: "חיפוש באינטרנט (Google Search)",
      extPc: "המחשב (Toby PC companion)", extPhone: "פעולות בטלפון ואנשי קשר", extGithub: "זיכרון משותף (GitHub)",
      needsAndroid: "זמין רק באפליקציית האנדרואיד", needsApps: "זמין באפליקציית המחשב ובאפליקציית האנדרואיד",
      githubHint: "אותו מאגר זיכרון כמו בטלפון ובמחשב, כדי שטובי יזכור אותך בכל מקום. הטוקן נשמר רק בדפדפן הזה (localStorage), לא מוצפן.",
      githubToken: "טוקן GitHub (Contents: read & write)", githubRepo: "מאגר הזיכרון",
      githubSave: "שמירה וסנכרון", githubRemove: "ניתוק",
      githubOff: "לא מחובר: טובי זוכר רק את מה שנאמר בדפדפן הזה.", githubWaiting: "מחובר, ממתין לסנכרון הראשון.",
      githubSynced: "סונכרן לאחרונה ב-{time}.", githubError: "הסנכרון נכשל ({error}). טובי ממשיך עם העותק המקומי וינסה שוב.",
      githubPending: " {count} קבצים ממתינים להעלאה.", githubTokenSaved: "טוקן שמור. אפשר להדביק חדש כדי להחליף.",
      keyTitle: "נחבר את טובי ל-Gemini",
      keyBody: "כדי לדבר, טובי צריך מפתח API משלכם מ-Google AI Studio. יצירת מפתח היא בחינם.",
      keyStorage: "המפתח נשמר רק בדפדפן הזה (localStorage), לא בקובץ ה-HTML, ונשלח רק ל-Google. במחשב משותף כדאי למחוק אותו בסוף.",
      keyGet: "להשגת מפתח בחינם: aistudio.google.com", keySave: "שמירה והתחלה", keyLater: "אחר כך",
      keyChecking: "בודק את המפתח מול Google…", keyInvalid: "Google דחתה את המפתח. כדאי לוודא שהעתקתם את כולו.",
      keyOffline: "אי אפשר להגיע ל-Google כרגע. המפתח נשמר, ננסה אותו בהודעה הבאה.",
      micStart: "הכתבה", micStop: "הפסקת ההכתבה", listening: "מקשיב… דברו עכשיו",
      voicePermission: "כדי להכתיב צריך לאשר לאתר גישה למיקרופון.", voiceNoMatch: "לא הצלחתי לשמוע. נסו שוב.",
      voiceNetwork: "ההכתבה צריכה אינטרנט. כדאי לבדוק את החיבור ולנסות שוב.", voiceNoMic: "לא נמצא מיקרופון.",
      voiceUnavailable: "זיהוי דיבור לא זמין בדפדפן הזה בשפה הזו.", voiceGeneric: "ההכתבה נעצרה באופן לא צפוי. נסו שוב.",
      speakReplies: "טובי מקריא את התשובות שלו",
      speakHint: "בקול של הדפדפן או של המערכת. הוא מפסיק כשמקלידים, מכתיבים או שולחים הודעה (או ב-Esc).",
      speakNoVoice: "אין בדפדפן הזה קול בשפה הזו, אז ההקראה עלולה להישמע לא נכון.",
      speakUnsupported: "הדפדפן הזה לא יודע להקריא טקסט.",
      sectionApp: "אפליקציה", installApp: "התקנת Floma",
      installReady: "אפשר להתקין את טובי כאפליקציה בחלון משלו, במחשב או בטלפון.",
      installed: "Floma מותקנת ופועלת בחלון משלה.",
      installBrowser: "כדי להתקין: בתפריט של Chrome ← התקנה (או סמל ההתקנה בשורת הכתובת).",
      installNeedsServer: "כדי להתקין, פתחו את הדף דרך serve.py או מאתר https, לא כקובץ שנפתח בלחיצה כפולה.",
      offline: "אין אינטרנט כרגע. אפשר לגלול ולקרוא, ואענה כשהחיבור יחזור.",
      sources: "מקורות:",
    },
    ENGLISH: {
      settings: "Settings", close: "Close", send: "Send", placeholder: "Message Toby…",
      subtitle: "Web app, on any device", empty: "Hi, I'm Toby. What's up?",
      sectionToby: "Toby", name: "Name", personality: "Personality", humor: "Humor level", language: "Language",
      serious: "Serious mode (no jokes)", instructions: "Your own instructions",
      pFriendly: "Humorous and friendly", pPlayful: "Very humorous", pProfessional: "Serious and professional", pConcise: "Serious and concise",
      sectionModel: "Model (Gemini)", keySaved: "A key is saved in this browser.", keyMissing: "No key saved.",
      changeKey: "Change key", removeKey: "Remove key", addKey: "Add key",
      sectionMemory: "Memory", memoryHint: "Recent messages are kept in this browser only.", clearChat: "Clear chat",
      confirmClear: "Delete the whole chat from this browser?", confirmRemoveKey: "Remove the key from this browser?",
      sectionExtensions: "Extensions", extSearch: "Web search (Google Search)",
      extPc: "PC (Toby PC companion)", extPhone: "Phone actions and contacts", extGithub: "Shared memory (GitHub)",
      needsAndroid: "Only in the Android app", needsApps: "In the desktop and Android apps",
      githubHint: "The same memory repository as the phone and the PC, so Toby remembers you everywhere. The token is stored only in this browser (localStorage), unencrypted.",
      githubToken: "GitHub token (Contents: read & write)", githubRepo: "Memory repository",
      githubSave: "Save and sync", githubRemove: "Disconnect",
      githubOff: "Not connected: Toby only remembers what was said in this browser.", githubWaiting: "Connected, waiting for the first sync.",
      githubSynced: "Last synced at {time}.", githubError: "Sync failed ({error}). Toby keeps using the local copy and will retry.",
      githubPending: " {count} file(s) waiting to upload.", githubTokenSaved: "A token is saved. Paste a new one to replace it.",
      keyTitle: "Connect Toby to Gemini",
      keyBody: "Toby needs your own Google AI Studio API key to chat. Creating one is free.",
      keyStorage: "The key is stored only in this browser (localStorage), never in the HTML file, and is sent only to Google. On a shared computer, remove it when you're done.",
      keyGet: "Get a free key at aistudio.google.com", keySave: "Save and start", keyLater: "Later",
      keyChecking: "Checking the key with Google…", keyInvalid: "Google rejected this key. Check that you copied all of it.",
      keyOffline: "Can't reach Google right now. The key was saved; it will be tried with your next message.",
      micStart: "Dictate a message", micStop: "Stop dictating", listening: "Listening… speak now",
      voicePermission: "Allow microphone access for this site to dictate.", voiceNoMatch: "I didn't catch that. Try again.",
      voiceNetwork: "Dictation needs the internet. Check the connection and try again.", voiceNoMic: "No microphone found.",
      voiceUnavailable: "Speech recognition isn't available in this browser for this language.",
      voiceGeneric: "Dictation stopped unexpectedly. Try again.",
      speakReplies: "Toby reads his replies aloud",
      speakHint: "With the browser's or system's voice. He stops when you type, dictate or send a message (or press Esc).",
      speakNoVoice: "This browser has no voice for this language, so it may sound wrong.",
      speakUnsupported: "This browser can't read text aloud.",
      sectionApp: "App", installApp: "Install Floma",
      installReady: "Install Toby as an app in his own window, on a computer or a phone.",
      installed: "Floma is installed and running in its own window.",
      installBrowser: "To install: Chrome menu > Install (or the install icon in the address bar).",
      installNeedsServer: "To install, open the page through serve.py or an https site, not as a double-clicked file.",
      offline: "You're offline. You can scroll and read; I'll answer once the connection is back.",
      sources: "Sources:",
    },
  };

  // --- Storage: every access guarded, the page must work without it (private windows etc.) ---

  function load(name, fallback) {
    try {
      const raw = localStorage.getItem(name);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function save(name, value) {
    try {
      if (value == null) localStorage.removeItem(name);
      else localStorage.setItem(name, JSON.stringify(value));
    } catch (e) { /* storage full or blocked: keep working in memory */ }
  }

  const state = {
    apiKey: load(STORE.key, null),
    settings: Object.assign({}, Core.DEFAULT_SETTINGS, load(STORE.settings, {})),
    // { role: "user" | "assistant", text, local?, error?, sources?, searchWidget?, action? }
    messages: load(STORE.history, []),
    thinking: false,
    thinkingSince: 0,
  };
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let typingTimer = null;

  const $ = (id) => document.getElementById(id);
  const t = (key) => STRINGS[state.settings.language][key] || STRINGS.ENGLISH[key] || key;

  // --- Rendering ---

  function applyLanguage() {
    const hebrew = state.settings.language !== "ENGLISH";
    document.documentElement.lang = hebrew ? "he" : "en";
    document.documentElement.dir = hebrew ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nLabel)); });
    updateSubtitle();
  }

  /** The shared dark palette (persona file, "theme") as CSS variables; styles.css has the same fallbacks. */
  function applyTheme() {
    const theme = (window.FLOMA_PERSONA && window.FLOMA_PERSONA.theme) || {};
    for (const [name, value] of Object.entries(theme)) {
      document.documentElement.style.setProperty(`--${name.replace(/_/g, "-")}`, value);
    }
  }

  function updateSubtitle() {
    $("subtitle").textContent = state.thinking
      ? Core.chatLine("typing", state.settings.language, state.settings.assistantName)
      : t("subtitle");
  }

  /** Toby's art and body language for an emotion (both from the persona file), with a little hop. */
  function setEmotion(emotion) {
    const avatar = $("avatar");
    const image = `${AVATAR_DIR}${Core.emotionImage(emotion)}`;
    if (!avatar.src.endsWith(image.replace("../", ""))) avatar.src = image;
    avatar.dataset.motion = Core.emotionMotion(emotion);
    const wrap = $("avatarWrap");
    wrap.classList.remove("hop");
    void wrap.offsetWidth; // restart the animation
    wrap.classList.add("hop");
  }

  function renderMessage(message) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role === "user" ? "user" : "toby"}${message.local ? " local" : ""}${message.error ? " error" : ""}`;
    bubble.dir = "auto";
    bubble.textContent = message.text; // never innerHTML: replies are untrusted text

    if (message.sources && message.sources.length) {
      const list = document.createElement("ul");
      list.className = "sources";
      list.append(t("sources"));
      for (const source of message.sources) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = source.uri;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title;
        item.append(link);
        list.append(item);
      }
      bubble.append(list);
    }
    if (message.searchWidget) {
      // Google's Search Suggestions chip. Its HTML stays in a sandbox without scripts.
      const frame = document.createElement("iframe");
      frame.className = "search-widget";
      frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.srcdoc = `<base target="_blank">${message.searchWidget}`;
      bubble.append(frame);
    }
    if (message.action === "addKey") {
      const actions = document.createElement("div");
      actions.className = "actions";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("addKey");
      button.addEventListener("click", openKeyDialog);
      actions.append(button);
      bubble.append(actions);
    }
    return bubble;
  }

  /** Rebuilds the whole chat (startup, language change); new messages go through addMessage. */
  function renderChat() {
    const chat = $("chat");
    chat.replaceChildren();
    if (!state.messages.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = t("empty");
      chat.append(empty);
    }
    for (const message of state.messages) chat.append(renderMessage(message));
    if (state.thinking) chat.append(typingIndicator());
    chat.scrollTop = chat.scrollHeight;
    $("send").disabled = state.thinking;
  }

  function scrollToEnd() {
    const chat = $("chat");
    chat.scrollTo({ top: chat.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }

  // --- "Toby is typing..." ---

  /** Three bouncing dots in a Toby bubble, plus a quiet caption once Gemini is slow. */
  function typingIndicator() {
    const box = document.createElement("div");
    box.className = "typing";
    box.id = "typing";
    const bubble = document.createElement("div");
    bubble.className = "typing-dots";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-label", Core.chatLine("typing", state.settings.language, state.settings.assistantName));
    for (let i = 0; i < 3; i++) bubble.append(document.createElement("span"));
    const caption = document.createElement("p");
    caption.className = "typing-caption";
    caption.id = "typingCaption";
    box.append(bubble, caption);
    return box;
  }

  function updateTypingCaption() {
    const caption = $("typingCaption");
    if (!caption) return;
    const stage = Core.typingStage(Date.now() - state.thinkingSince);
    const text = stage === "typing" ? "" : Core.chatLine(stage, state.settings.language, state.settings.assistantName);
    if (caption.textContent !== text) {
      caption.textContent = text;
      caption.classList.toggle("shown", Boolean(text));
      scrollToEnd();
    }
  }

  function setThinking(on) {
    state.thinking = on;
    $("send").disabled = on;
    const existing = $("typing");
    if (existing) existing.remove();
    clearInterval(typingTimer);
    if (on) {
      state.thinkingSince = Date.now();
      $("chat").append(typingIndicator());
      typingTimer = setInterval(updateTypingCaption, 250);
      scrollToEnd();
    }
    updateSubtitle();
  }

  function persist() {
    save(STORE.history, state.messages.slice(-MAX_STORED));
    if (state.messages.length > MAX_STORED) state.messages = state.messages.slice(-MAX_STORED);
  }

  /** Appends one bubble with an entry animation, keeping the typing indicator last. */
  function addMessage(message) {
    if (!message.ts) message.ts = Date.now(); // memory folding tracks what it already covered
    state.messages.push(message);
    const trimmed = state.messages.length > MAX_STORED;
    persist();
    if (trimmed) {
      renderChat();
      return;
    }
    const chat = $("chat");
    const empty = chat.querySelector(".empty");
    if (empty) empty.remove();
    const bubble = renderMessage(message);
    bubble.classList.add("enter");
    const typing = $("typing");
    if (typing) chat.insertBefore(bubble, typing);
    else chat.append(bubble);
    scrollToEnd();
  }

  /** Toby explains a failed request in his own words (persona file), never as a raw error. */
  function showError(kind) {
    const [text, emotion] = Core.errorLine(kind, state.settings.language);
    addMessage({
      role: "assistant", text, local: true, error: true,
      action: kind === "INVALID_KEY" || kind === "MISSING_KEY" ? "addKey" : undefined,
    });
    setEmotion(emotion);
  }

  // --- Sending ---

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || state.thinking) return;
    Voice.stopSpeaking(); // a new message interrupts Toby
    dictation.cancel(); // and late dictation results must not refill the cleared field
    const { route, seriousChange } = Core.route(trimmed, state.settings);

    if (seriousChange) {
      state.settings.seriousMode = seriousChange === "ENTER";
      save(STORE.settings, state.settings);
      fillSettings();
    }

    if (route.kind === "unavailable") {
      // The browser can't do this: Toby says where he is and which Floma app can (persona file).
      // Local-only, like Android's device bubbles: never sent to the model.
      addMessage({ role: "user", text: trimmed, local: true });
      addMessage({ role: "assistant", text: Core.unavailableLine(route.extension, state.settings.language), local: true });
      setEmotion(Core.avatarFor("unavailable"));
      return;
    }

    addMessage({ role: "user", text: trimmed });
    if (!state.apiKey) {
      showError("MISSING_KEY");
      return;
    }

    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.text }));
    try {
      // The shared notes come from the local copy, so a GitHub outage never delays or breaks a reply.
      const reply = await Core.complete(state.apiKey, state.settings, history, route, Memory.notes());
      setThinking(false);
      addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget });
      setEmotion(reply.emotion);
      if (state.settings.speakReplies) Voice.speak(reply.text, state.settings.language);
      updateMemory();
    } catch (e) {
      setThinking(false);
      if (!(e instanceof Core.AiError)) console.error(e); // a bug: still answered kindly below
      showError(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE");
    }
  }

  // --- Shared memory (background; failures only show in Settings) ---

  /** After a reply: pull what the other devices learned, then fold older messages into notes. */
  function updateMemory() {
    const key = state.apiKey;
    const name = state.settings.assistantName || "Toby";
    const messages = state.messages.slice();
    Memory.pull()
      .then(() => Memory.fold(messages, (summary, sections, conversation) =>
        Core.summarizeMemory(key, name, summary, sections, conversation)))
      .then(fillSettings);
  }

  function memoryStatusText() {
    const status = Memory.status();
    if (!status.configured) return t("githubOff");
    let text = status.lastError ? t("githubError").replace("{error}", status.lastError)
      : status.lastSync ? t("githubSynced").replace("{time}", new Date(status.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
        : t("githubWaiting");
    if (status.pending) text += t("githubPending").replace("{count}", status.pending);
    return text;
  }

  // --- Settings drawer ---

  function fillSettings() {
    const s = state.settings;
    $("assistantName").textContent = s.assistantName || "Toby";
    $("setName").value = s.assistantName;
    $("setPersonality").value = s.personality;
    $("setHumor").value = s.humorLevel;
    $("setLanguage").value = s.language;
    $("setSerious").checked = s.seriousMode;
    $("setInstructions").value = s.customInstructions;
    $("setWebSearch").checked = s.webSearch;
    $("keyStatus").textContent = t(state.apiKey ? "keySaved" : "keyMissing");
    $("removeKey").disabled = !state.apiKey;
    $("changeKey").textContent = t(state.apiKey ? "changeKey" : "addKey");
    $("githubStatus").textContent = memoryStatusText();
    $("githubToken").placeholder = Memory.hasToken() ? t("githubTokenSaved") : "github_pat_…";
    if (document.activeElement !== $("githubRepo")) $("githubRepo").value = s.githubRepo || Memory.DEFAULT_REPOSITORY;
    $("githubRemove").disabled = !Memory.hasToken();
    if ($("installStatus")) fillInstall();
    fillVoiceSettings();
    $("offlineBanner").textContent = t("offline");
  }

  function bindSetting(id, field, read) {
    $(id).addEventListener("change", () => {
      state.settings[field] = read($(id));
      save(STORE.settings, state.settings);
      if (field === "language") {
        applyLanguage();
        renderChat();
      }
      fillSettings();
    });
  }

  function setDrawer(open) {
    $("settings").hidden = !open;
    $("scrim").hidden = !open;
    $("openSettings").setAttribute("aria-expanded", String(open));
    if (open) $("closeSettings").focus();
    else $("openSettings").focus();
  }

  // --- Key dialog ---

  function openKeyDialog() {
    $("keyInput").value = "";
    $("keyError").textContent = "";
    $("keySave").disabled = false;
    if (!$("keyDialog").open) $("keyDialog").showModal();
    $("keyInput").focus();
  }

  async function submitKey(event) {
    event.preventDefault();
    const key = $("keyInput").value.trim();
    if (!key) return;
    $("keySave").disabled = true;
    $("keyError").textContent = t("keyChecking");
    const problem = await Core.verifyKey(key);
    if (problem === "INVALID_KEY") {
      $("keyError").textContent = t("keyInvalid");
      $("keySave").disabled = false;
      return;
    }
    state.apiKey = key;
    save(STORE.key, key);
    fillSettings();
    if (problem === "NETWORK") {
      $("keyError").textContent = t("keyOffline");
      setTimeout(() => $("keyDialog").close(), 1800);
    } else {
      $("keyDialog").close();
    }
    $("input").focus();
  }

  // --- Voice: dictation into the text field, Toby reading his replies aloud ---

  let textBeforeDictation = "";

  function setVoiceStatus(key, kind) {
    const status = $("voiceStatus");
    status.hidden = !key;
    status.textContent = key ? t(key) : "";
    status.dataset.kind = kind || "";
  }

  /** Grows the text field with its content (up to the CSS max-height), borders included. */
  function autoGrow() {
    const input = $("input");
    input.style.height = "";
    const border = input.offsetHeight - input.clientHeight;
    input.style.height = `${input.scrollHeight + border}px`;
    input.style.overflowY = input.scrollHeight > input.clientHeight + 1 ? "auto" : "hidden";
  }

  const dictation = Voice.createDictation({
    onText(text) {
      $("input").value = [textBeforeDictation.trim(), text].filter(Boolean).join(" ");
      autoGrow();
    },
    onState(listening) {
      const mic = $("mic");
      mic.classList.toggle("listening", listening);
      mic.setAttribute("aria-pressed", String(listening));
      mic.setAttribute("aria-label", t(listening ? "micStop" : "micStart"));
      mic.title = t(listening ? "micStop" : "micStart");
      if (listening) setVoiceStatus("listening", "listening");
      else if ($("voiceStatus").dataset.kind === "listening") setVoiceStatus(null);
      if (!listening) $("input").focus();
    },
    onError(key) { setVoiceStatus(key, "error"); },
  });

  function toggleDictation() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    Voice.stopSpeaking(); // the microphone must not hear Toby
    textBeforeDictation = $("input").value;
    dictation.start(state.settings.language);
  }

  function fillVoiceSettings() {
    $("mic").hidden = !Voice.dictationSupported;
    $("setSpeak").checked = Boolean(state.settings.speakReplies);
    $("setSpeak").disabled = !Voice.speechSupported;
    $("speakHint").textContent = !Voice.speechSupported ? t("speakUnsupported")
      : state.settings.speakReplies && !Voice.hasVoiceFor(state.settings.language) ? t("speakNoVoice")
        : t("speakHint");
  }

  // --- Installable web app (PWA) ---

  let installPrompt = null;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function fillInstall() {
    const canInstall = Boolean(installPrompt);
    $("installApp").hidden = !canInstall;
    $("installStatus").textContent = standalone() ? t("installed")
      : canInstall ? t("installReady")
        : location.protocol === "file:" ? t("installNeedsServer") : t("installBrowser");
  }

  function setupPwa() {
    // Service workers (offline + install) only run on http(s) pages, not on a double-clicked file.
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker not registered", e));
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault(); // offered from Settings instead of Chrome's mini-bar
      installPrompt = event;
      fillInstall();
    });
    window.addEventListener("appinstalled", () => {
      installPrompt = null;
      fillInstall();
    });
    $("installApp").addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      fillInstall();
    });
    document.documentElement.classList.toggle("standalone", standalone());
    const updateOnline = () => {
      $("offlineBanner").hidden = navigator.onLine;
      $("offlineBanner").textContent = t("offline");
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    updateOnline();
    fillInstall();
  }

  // --- Wiring ---

  function init() {
    setupPwa();
    applyTheme();
    applyLanguage();
    fillSettings();
    renderChat();
    const lastToby = [...state.messages].reverse().find((m) => m.role === "assistant" && !m.error);
    setEmotion(Core.avatarFor(lastToby ? "greeting" : "default"));
    $("avatar").addEventListener("error", () => { $("avatar").style.visibility = "hidden"; });

    $("composer").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = $("input").value;
      $("input").value = "";
      autoGrow();
      send(text);
    });
    $("input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $("composer").requestSubmit();
      }
    });
    $("input").addEventListener("input", (event) => {
      if (event.inputType && !dictation.listening) Voice.stopSpeaking(); // typing interrupts Toby
      autoGrow();
    });
    $("mic").addEventListener("click", toggleDictation);

    $("openSettings").addEventListener("click", () => setDrawer(true));
    $("closeSettings").addEventListener("click", () => setDrawer(false));
    $("scrim").addEventListener("click", () => setDrawer(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("settings").hidden) setDrawer(false);
      else if (event.key === "Escape") {
        Voice.stopSpeaking();
        if (dictation.listening) dictation.cancel();
      }
    });

    bindSetting("setName", "assistantName", (el) => el.value.trim());
    bindSetting("setPersonality", "personality", (el) => el.value);
    bindSetting("setHumor", "humorLevel", (el) => Number(el.value));
    bindSetting("setLanguage", "language", (el) => el.value);
    bindSetting("setSerious", "seriousMode", (el) => el.checked);
    bindSetting("setInstructions", "customInstructions", (el) => el.value);
    bindSetting("setWebSearch", "webSearch", (el) => el.checked);
    bindSetting("setSpeak", "speakReplies", (el) => el.checked);
    $("setSpeak").addEventListener("change", () => { if (!state.settings.speakReplies) Voice.stopSpeaking(); });

    $("changeKey").addEventListener("click", openKeyDialog);
    $("removeKey").addEventListener("click", () => {
      if (!confirm(t("confirmRemoveKey"))) return;
      state.apiKey = null;
      save(STORE.key, null);
      fillSettings();
    });
    $("clearChat").addEventListener("click", () => {
      if (!confirm(t("confirmClear"))) return;
      state.messages = [];
      Voice.stopSpeaking();
      persist();
      Memory.forgetLocal(); // like Android: the local notes go too (GitHub keeps its files)
      renderChat();
      setEmotion(Core.avatarFor("default"));
    });

    $("githubSave").addEventListener("click", () => {
      const token = $("githubToken").value.trim();
      if (token) Memory.setToken(token);
      $("githubToken").value = "";
      state.settings.githubRepo = $("githubRepo").value.trim() || Memory.DEFAULT_REPOSITORY;
      save(STORE.settings, state.settings);
      fillSettings();
      Memory.syncNow().then(fillSettings);
    });
    $("githubRemove").addEventListener("click", () => {
      Memory.setToken(null);
      fillSettings();
    });

    $("keyForm").addEventListener("submit", submitKey);
    $("keyLater").addEventListener("click", () => $("keyDialog").close());

    // Notes the phone or the PC added since last time (throttled; harmless offline).
    Memory.setRepository(() => state.settings.githubRepo || Memory.DEFAULT_REPOSITORY);
    Memory.pull().then(fillSettings);

    // First launch (or the key was removed): ask for it before anything else.
    if (!state.apiKey) openKeyDialog();
    else $("input").focus();
  }

  init();
})();
