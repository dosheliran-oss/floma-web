/*
 * Floma web client - UI: chat screen, settings drawer, first-launch key dialog.
 *
 * Storage (this browser only): the Gemini key, settings and the chat sessions live in
 * localStorage. The key is never written into the HTML or any file in the repository; it is
 * sent only to Google, in the x-goog-api-key header.
 *
 * Chat sessions: "floma.sessions" is the index (newest first), each chat's messages are in
 * "floma.chat.<id>". Every chat belongs to one assistant ("floma" or "toby"): the sidebar lists only
 * the current assistant's chats and each assistant has its own open chat ("floma.activeSession" =
 * {persona: id}), so Floma's and Toby's conversations never mix. Chats from before the separation are
 * Floma's.
 *
 * A chat that ends (New chat, another chat or assistant, the next start) is summarized into facts:
 * they go into the local notes and, when it's connected, to the user's Firebase memory (memory.js).
 * Only each assistant's KEEP_SESSIONS newest chats are kept in this browser; an older chat is deleted
 * once its facts are in the notes, and beyond HARD_CAP even if they couldn't be extracted.
 */
(function () {
  "use strict";

  const Core = window.FlomaCore;
  const Memory = window.FlomaMemory;
  const Voice = window.FlomaVoice;
  const Docs = window.FlomaDocuments;
  const STORE = {
    key: "floma.apiKey", elevenKey: "floma.elevenLabsKey", settings: "floma.settings", sessions: "floma.sessions", active: "floma.activeSession",
    chat: (id) => `floma.chat.${id}`,
    legacyHistory: "floma.history", // the single infinite chat before sessions (migrated once)
  };
  const MAX_STORED = 200; // messages per chat
  const KEEP_SESSIONS = 3; // chats kept per assistant once older ones are memorized
  const HARD_CAP = 10; // chats per assistant even when their facts couldn't be extracted yet
  const KEY_PROBLEMS = ["MISSING_KEY", "INVALID_KEY"];
  const KEEP_DOCUMENTS = 3; // document text kept in localStorage for follow-up questions, newest only
  const KEEP_PICTURES = 30; // thumbnails kept in localStorage for the newest messages only
  const AVATAR_DIR = "../app/src/main/res/drawable-nodpi/";

  const STRINGS = {
    HEBREW: {
      settings: "הגדרות", close: "סגירה", send: "שליחה", placeholder: "כתבו ל{name}…",
      subtitle: "בדפדפן, בכל מכשיר", empty: "היי, אני טובי. על מה נדבר?",
      sectionToby: "שם וסגנון", name: "שם", personality: "אישיות", humor: "רמת הומור", language: "שפה",
      serious: "מצב רציני (בלי בדיחות)", instructions: "הוראות משלכם",
      pFriendly: "הומוריסטי וחברותי", pPlayful: "הומוריסטי מאוד", pProfessional: "רציני ומקצועי", pConcise: "רציני ותמציתי",
      sectionModel: "מודל (Gemini)", keySaved: "מפתח שמור בדפדפן הזה.", keyMissing: "אין מפתח: עונה במצב מקומי. המפתח אופציונלי.",
      changeKey: "החלפת מפתח", removeKey: "מחיקת מפתח", addKey: "הוספת מפתח",
      sectionMemory: "זיכרון", memoryHint: "השיחות נשמרות בדפדפן הזה בלבד.", clearChat: "מחיקת כל השיחות",
      confirmClear: "למחוק את כל השיחות מהדפדפן הזה?", confirmRemoveKey: "למחוק את המפתח מהדפדפן הזה?",
      chats: "שיחות", newChat: "שיחה חדשה", untitled: "שיחה חדשה", deleteChat: "מחיקת השיחה",
      confirmDeleteChat: "למחוק את השיחה הזו?", noChats: "עוד אין שיחות קודמות.",
      chatsKept: "רק 3 השיחות האחרונות של {name} נשמרות בדפדפן. לפני שמוחקים שיחה ישנה, העובדות ממנה נשמרות בזיכרון (וב-Firebase כשהוא מחובר).",
      notSaved: "ממתינה לשמירה בזיכרון",
      tobyAddon: "טובי (תוסף ליצן)",
      elevenTitle: "קול ElevenLabs (אופציונלי)", elevenHint: "הקראת התשובות בקול שעיצבתם ב-ElevenLabs. בלי מפתח, או כשאין גישה, הקול של הדפדפן מקריא. המפתח נשמר רק בדפדפן הזה (localStorage), לא מוצפן.", elevenKey: "מפתח API של ElevenLabs", elevenKeySaved: "מפתח שמור", elevenVoice: "מזהה קול (Voice ID)", elevenVoicePlaceholder: "ריק = קול ברירת המחדל", elevenSave: "שמירה", elevenRemove: "הסרה", elevenBadVoice: "זה לא נראה כמו מזהה קול (אותיות וספרות, מעמוד הקול ב-ElevenLabs).", elevenNoKey: "צריך להזין מפתח.", elevenOff: "כבוי: הקול של הדפדפן מקריא את התשובות.", elevenOn: "פעיל: התשובות מוקראות בקול ה-ElevenLabs שלכם.", elevenErrAUTH: "ElevenLabs דחה את המפתח. משתמש בקול של הדפדפן.", elevenErrBAD_VOICE: "ElevenLabs לא מכיר את מזהה הקול. משתמש בקול של הדפדפן.", elevenErrQUOTA: "נגמרו התווים בחשבון ElevenLabs. משתמש בקול של הדפדפן.", elevenErrRATE_LIMITED: "ElevenLabs עמוס. משתמש בקול של הדפדפן לכמה דקות.", elevenErrSERVER: "ElevenLabs עמוס. משתמש בקול של הדפדפן לכמה דקות.", elevenErrNETWORK: "אין גישה ל-ElevenLabs (אין אינטרנט?). משתמש בקול של הדפדפן.", elevenErrUNKNOWN: "ElevenLabs לא ענה כצפוי. משתמש בקול של הדפדפן.",
      sectionExtensions: "תוספים", extSearch: "חיפוש באינטרנט (Google Search)",
      extPc: "המחשב (Toby PC companion)", extPhone: "פעולות בטלפון ואנשי קשר",
      needsAndroid: "זמין רק באפליקציית האנדרואיד", needsApps: "זמין באפליקציית המחשב ובאפליקציית האנדרואיד",
      sectionFirebase: "זיכרון משותף (Firebase)",
      firebaseHint: "אותו זיכרון כמו בטלפון ובמחשב. רק עובדות קצרות נשמרות שם, לא השיחות. הסוד נשמר רק בדפדפן הזה (localStorage), לא מוצפן.",
      firebaseUrl: "כתובת מסד הנתונים", firebaseSecret: "סוד מסד הנתונים (Database secret)",
      firebaseSave: "שמירה וסנכרון", firebaseRemove: "ניתוק", firebaseBadUrl: "זו לא כתובת של Firebase Realtime Database.",
      firebaseOff: "לא מחובר: הזיכרון נשמר רק בדפדפן הזה.", firebaseWaiting: "מחובר, ממתין לסנכרון הראשון.",
      firebaseSynced: "סונכרן לאחרונה ב-{time}.", firebaseError: "הסנכרון נכשל ({error}). הזיכרון המקומי ממשיך לעבוד וננסה שוב.",
      firebasePending: " {count} נושאים ממתינים להעלאה.", firebaseSecretSaved: "סוד שמור. אפשר להדביק חדש כדי להחליף.",
      keyTitle: "חיבור ל-Gemini (אופציונלי)",
      keyBody: "עם מפתח API משלכם מ-Google AI Studio העוזר עונה על הכול. בלי מפתח הוא עונה במצב מקומי. יצירת מפתח היא בחינם.",
      keyStorage: "המפתח נשמר רק בדפדפן הזה (localStorage), לא בקובץ ה-HTML, ונשלח רק ל-Google. במחשב משותף כדאי למחוק אותו בסוף.",
      keyGet: "להשגת מפתח בחינם: aistudio.google.com", keySave: "שמירה והתחלה", keyLater: "אחר כך",
      keyChecking: "בודק את המפתח מול Google…", keyInvalid: "Google דחתה את המפתח. כדאי לוודא שהעתקתם את כולו.",
      keyOffline: "אי אפשר להגיע ל-Google כרגע. המפתח נשמר, ננסה אותו בהודעה הבאה.",
      attach: "צירוף תמונה או מסמך", removeImage: "הסרת הקובץ", picture: "תמונה ששלחת", reading: "קורא את הקובץ…",
      docPages: "{pages} עמודים · {chars} תווים", docPage: "עמוד אחד · {chars} תווים", docChars: "{chars} תווים", docCut: " · קוצר לאורך המותר",
      sectionAssistant: "העוזר", assistantHint: "Floma היא העוזרת שלך: רגועה, מדויקת, בלי דמות. הפעילו את טובי בשביל הליצן השנון עם הדמות המונפשת.",
      personaNote: "אישיות, הומור ומצב ליצן שייכים לטובי. העוזר הניטרלי של Floma תמיד ענייני.",
      sectionAppearance: "מראה", sectionVoice: "קול", voiceRate: "מהירות דיבור", voicePitch: "גובה קול", testVoice: "בדיקת קול",
      testPhrase: "היי, ככה אני נשמע.", modelChoice: "בחירת מודל",
      fallbackHint: "אם מודל לא עונה (זמן המתנה, תקלה או מכסה שנגמרה), Floma עוברת בשקט למודל השני. בלי חיבור בכלל היא עונה במצב מקומי.",
      liveStart: "התחלת שיחה חיה", liveStop: "סיום השיחה החיה", liveListening: "שיחה חיה: מקשיב…",
      liveSpeaking: "שיחה חיה: {name} מדבר…", liveHint: "שיחה חיה (הכפתור ליד המיקרופון): מדברים, {name} עונה בקול ומיד מקשיב שוב. מסיימים בכפתור או ב-Esc.",
      speak: "הקראה", stopSpeak: "עצירת ההקראה", localMode: "מצב מקומי",
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
      settings: "Settings", close: "Close", send: "Send", placeholder: "Message {name}…",
      subtitle: "Web app, on any device", empty: "Hi, I'm Toby. What's up?",
      sectionToby: "Name & style", name: "Name", personality: "Personality", humor: "Humor level", language: "Language",
      serious: "Serious mode (no jokes)", instructions: "Your own instructions",
      pFriendly: "Humorous and friendly", pPlayful: "Very humorous", pProfessional: "Serious and professional", pConcise: "Serious and concise",
      sectionModel: "Model (Gemini)", keySaved: "A key is saved in this browser.", keyMissing: "No key: answering in local mode. The key is optional.",
      changeKey: "Change key", removeKey: "Remove key", addKey: "Add key",
      sectionMemory: "Memory", memoryHint: "Chats are kept in this browser only.", clearChat: "Delete all chats",
      confirmClear: "Delete all chats from this browser?", confirmRemoveKey: "Remove the key from this browser?",
      chats: "Chats", newChat: "New chat", untitled: "New chat", deleteChat: "Delete chat",
      confirmDeleteChat: "Delete this chat?", noChats: "No earlier chats yet.",
      chatsKept: "Only {name}'s 3 most recent chats stay in this browser. Before an older chat is deleted, its facts are saved to memory (and to Firebase when it's connected).",
      notSaved: "Waiting to be saved to memory",
      tobyAddon: "Toby (jester add-on)",
      elevenTitle: "ElevenLabs voice (optional)", elevenHint: "Read replies with a voice you designed in ElevenLabs. Without a key, or when it can't be reached, the browser's voice reads them. The key is stored only in this browser (localStorage), unencrypted.", elevenKey: "ElevenLabs API key", elevenKeySaved: "A key is saved", elevenVoice: "Voice ID", elevenVoicePlaceholder: "Empty = the default voice", elevenSave: "Save", elevenRemove: "Remove", elevenBadVoice: "That doesn't look like a voice ID (letters and digits, from the voice's page in ElevenLabs).", elevenNoKey: "Enter a key first.", elevenOff: "Off: the browser's voice reads replies.", elevenOn: "On: replies are read with your ElevenLabs voice.", elevenErrAUTH: "ElevenLabs rejected the key. Using the browser's voice.", elevenErrBAD_VOICE: "ElevenLabs doesn't know this voice ID. Using the browser's voice.", elevenErrQUOTA: "Your ElevenLabs characters are used up. Using the browser's voice.", elevenErrRATE_LIMITED: "ElevenLabs is busy. Using the browser's voice for a couple of minutes.", elevenErrSERVER: "ElevenLabs is busy. Using the browser's voice for a couple of minutes.", elevenErrNETWORK: "Couldn't reach ElevenLabs (offline?). Using the browser's voice.", elevenErrUNKNOWN: "ElevenLabs didn't answer as expected. Using the browser's voice.",
      sectionExtensions: "Extensions", extSearch: "Web search (Google Search)",
      extPc: "PC (Toby PC companion)", extPhone: "Phone actions and contacts",
      needsAndroid: "Only in the Android app", needsApps: "In the desktop and Android apps",
      sectionFirebase: "Shared memory (Firebase)",
      firebaseHint: "The same memory as on the phone and the PC. Only short facts are stored there, never the chats. The secret is stored only in this browser (localStorage), unencrypted.",
      firebaseUrl: "Database URL", firebaseSecret: "Database secret",
      firebaseSave: "Save and sync", firebaseRemove: "Disconnect", firebaseBadUrl: "That isn't a Firebase Realtime Database URL.",
      firebaseOff: "Not connected: the memory stays in this browser only.", firebaseWaiting: "Connected, waiting for the first sync.",
      firebaseSynced: "Last synced at {time}.", firebaseError: "Sync failed ({error}). The local memory keeps working; it will retry.",
      firebasePending: " {count} topic(s) waiting to upload.", firebaseSecretSaved: "A secret is saved. Paste a new one to replace it.",
      keyTitle: "Connect to Gemini (optional)",
      keyBody: "With your own Google AI Studio API key the assistant can answer anything. Without one it answers in local mode. Creating a key is free.",
      keyStorage: "The key is stored only in this browser (localStorage), never in the HTML file, and is sent only to Google. On a shared computer, remove it when you're done.",
      keyGet: "Get a free key at aistudio.google.com", keySave: "Save and start", keyLater: "Later",
      keyChecking: "Checking the key with Google…", keyInvalid: "Google rejected this key. Check that you copied all of it.",
      keyOffline: "Can't reach Google right now. The key was saved; it will be tried with your next message.",
      attach: "Attach a picture or document", removeImage: "Remove the file", picture: "Your picture", reading: "Reading the file…",
      docPages: "{pages} pages · {chars} characters", docPage: "1 page · {chars} characters", docChars: "{chars} characters", docCut: " · shortened to fit",
      sectionAssistant: "Assistant", assistantHint: "Floma is your assistant: calm, precise, no character act. Turn on Toby for the witty jester with his animated art.",
      personaNote: "Personality, humor and the jester act belong to Toby. The neutral Floma assistant is always matter-of-fact.",
      sectionAppearance: "Appearance", sectionVoice: "Voice", voiceRate: "Speaking speed", voicePitch: "Pitch", testVoice: "Test voice",
      testPhrase: "Hi, this is how I sound.", modelChoice: "Model",
      fallbackHint: "If a model doesn't answer (timeout, outage or used-up quota), Floma quietly switches to the other one. With no connection at all, it answers in local mode.",
      liveStart: "Start a live conversation", liveStop: "End the live conversation", liveListening: "Live conversation: listening…",
      liveSpeaking: "Live conversation: {name} is speaking…", liveHint: "Live conversation (the button next to the mic): you talk, {name} answers out loud and listens again right away. End it with the button or Esc.",
      speak: "Read aloud", stopSpeak: "Stop reading", localMode: "Local mode",
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
    elevenKey: load(STORE.elevenKey, null), // ElevenLabs (optional voice); unencrypted, like the Gemini key
    cloudVoiceError: null, // the last ElevenLabs problem (null after it spoke)
    settings: Object.assign({}, Core.DEFAULT_SETTINGS, load(STORE.settings, {})),
    // [{ id, title, created, updated, memoryTs, unsaved? }], newest first; memoryTs: newest message in the notes
    sessions: [],
    sessionId: null,
    // The open chat: { role: "user" | "assistant", text, ts, local?, notice?, offline?, reason?, sources?, action? }
    messages: [],
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
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder).replace("{name}", assistant()); });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nLabel)); });
    updateSubtitle();
  }

  /** The shared dark palette (persona file, "theme") as CSS variables; styles.css has the same fallbacks. */
  function applyTheme() {
    const theme = Core.theme(state.settings.theme);
    for (const [name, value] of Object.entries(theme)) {
      document.documentElement.style.setProperty(`--${name.replace(/_/g, "-")}`, value);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme.background; // the installed app's title bar follows the theme
  }

  const persona = () => Core.personaId(state.settings.persona);
  const assistant = () => Core.assistantName(state.settings.assistantName, persona());
  const lang = () => state.settings.language;

  function updateSubtitle() {
    $("subtitle").textContent = state.thinking
      ? Core.chatLine("typing", lang(), state.settings.assistantName, persona())
      : t("subtitle");
  }

  /** The assistant's art for an emotion: Toby moves with his mood; Floma's logo stays still. */
  function setEmotion(emotion) {
    const avatar = $("avatar");
    const image = `${AVATAR_DIR}${Core.avatarImage(emotion, persona())}`;
    if (!avatar.src.endsWith(image.replace("../", ""))) avatar.src = image;
    avatar.dataset.motion = Core.animated(persona()) ? Core.emotionMotion(emotion) : "none";
    const wrap = $("avatarWrap");
    wrap.classList.remove("hop");
    void wrap.offsetWidth; // restart the animation
    wrap.classList.add("hop");
  }

  const SPEAKER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z"/></svg>';

  /** Read this message aloud on demand (press again to stop). */
  function speakButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speak";
    button.innerHTML = SPEAKER_ICON; // a fixed icon, never message text
    button.setAttribute("aria-label", t("speak"));
    button.title = t("speak");
    button.addEventListener("click", () => {
      if (Voice.speakingText === text) {
        Voice.stopSpeaking();
        markSpeaking(null);
        return;
      }
      dictation.cancel();
      markSpeaking(button);
      Voice.speak(text, lang(), { ...voiceTuning(), onDone: () => markSpeaking(null) });
    });
    return button;
  }

  function markSpeaking(button) {
    document.querySelectorAll(".speak.speaking").forEach((b) => {
      b.classList.remove("speaking");
      b.setAttribute("aria-label", t("speak"));
    });
    if (button) {
      button.classList.add("speaking");
      button.setAttribute("aria-label", t("stopSpeak"));
    }
  }

  const voiceTuning = () => ({ rate: Number(state.settings.voiceRate) || 1, pitch: Number(state.settings.voicePitch) || 1 });

  function renderMessage(message) {
    const bubble = document.createElement("div");
    // Error bubbles saved before the graceful fallback render as calm notices too.
    const notice = Boolean(message.notice || message.error);
    bubble.className = `bubble ${message.role === "user" ? "user" : "toby"}${message.local ? " local" : ""}${notice ? " notice" : ""}`;
    bubble.dir = "auto";
    bubble.textContent = message.text; // never innerHTML: replies are untrusted text
    if (message.document) bubble.prepend(documentChip(message.document));
    if (message.image && message.image.startsWith("data:image/")) {
      const picture = document.createElement("img");
      picture.className = "bubble-image";
      picture.src = message.image; // a small JPEG thumbnail made in this browser
      picture.alt = t("picture");
      bubble.prepend(picture);
    }

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
    if (message.role === "assistant" && !notice) {
      const footer = document.createElement("div");
      footer.className = "bubble-footer";
      if (message.offline) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = `⚡ ${t("localMode")}`;
        if (message.reason) tag.title = Core.errorLine(message.reason, lang())[0]; // why, without a red bubble
        footer.append(tag);
      }
      footer.append(speakButton(message.text));
      bubble.append(footer);
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
      empty.textContent = Core.greeting(lang(), state.settings.assistantName, persona());
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
    bubble.setAttribute("aria-label", Core.chatLine("typing", lang(), state.settings.assistantName, persona()));
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
    const text = stage === "typing" ? "" : Core.chatLine(stage, lang(), state.settings.assistantName, persona());
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

  /** Saves the open chat (pictures and document text only for the newest messages) and its index entry. */
  function persist() {
    const kept = state.messages.slice(-MAX_STORED);
    const withPictures = kept.length - KEEP_PICTURES;
    const withDocs = new Set(kept.map((m, i) => (m.context ? i : -1)).filter((i) => i >= 0).slice(-KEEP_DOCUMENTS));
    save(STORE.chat(state.sessionId), kept.map((m, i) => {
      let out = m.image && i < withPictures ? { ...m, image: undefined } : m;
      if (out.context && !withDocs.has(i)) out = { ...out, context: undefined };
      return out;
    }));
    if (state.messages.length > MAX_STORED) state.messages = state.messages.slice(-MAX_STORED);
    touchSession();
  }

  // --- Chat sessions ---

  const newSessionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sessionEntry = (id) => state.sessions.find((x) => x.id === id);
  const saveSessions = () => save(STORE.sessions, state.sessions);
  /** The current assistant's chats, newest first (never the other assistant's). */
  const mySessions = () => state.sessions.filter((x) => x.persona === persona());
  /** Each assistant's open chat: {floma: id, toby: id}. */
  let openChats = {};
  const saveOpenChats = () => save(STORE.active, openChats);
  const isOpenSomewhere = (id) => Object.values(openChats).includes(id);

  /** A chat's name: the start of its first message. */
  function sessionTitle(messages) {
    const first = messages.find((m) => m.role === "user" && m.text && m.text.trim());
    if (!first) return "";
    const text = first.text.trim().replace(/\s+/g, " ");
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  }

  /** The open chat joins the list with its first message and moves to the top with every new one. */
  function touchSession() {
    if (!state.messages.length) return;
    let entry = sessionEntry(state.sessionId);
    if (!entry) entry = { id: state.sessionId, title: "", created: Date.now(), updated: 0, memoryTs: 0, persona: persona() };
    entry.title = sessionTitle(state.messages) || entry.title;
    entry.updated = Date.now();
    delete entry.memorized; // new messages: something new to memorize when it ends
    delete entry.unsaved;
    state.sessions = [entry, ...state.sessions.filter((x) => x.id !== entry.id)];
    saveSessions();
    renderSessions();
  }

  /** Startup: the session index, each assistant's open chat, and the old single chat moved into a session. */
  function loadSessions() {
    state.sessions = (load(STORE.sessions, []) || []).filter((x) => x && x.id);
    for (const entry of state.sessions) if (!entry.persona) entry.persona = "floma"; // from before the separation
    const legacy = load(STORE.legacyHistory, null);
    if (Array.isArray(legacy) && legacy.length) {
      const id = newSessionId();
      save(STORE.chat(id), legacy);
      const last = legacy[legacy.length - 1];
      state.sessions.unshift({ id, title: sessionTitle(legacy), created: (legacy[0] && legacy[0].ts) || Date.now(),
        updated: (last && last.ts) || Date.now(), memoryTs: 0, persona: "floma" });
      saveSessions();
      save(STORE.active, { floma: id });
    }
    save(STORE.legacyHistory, null);
    const stored = load(STORE.active, null);
    // Before the separation this was one id (Floma's).
    openChats = stored && typeof stored === "object" ? stored : { floma: stored || "" };
    showPersonaChats();
  }

  /** The current assistant's open chat (else its newest, else a new one) becomes the chat on screen. */
  function showPersonaChats() {
    const mine = mySessions();
    let id = openChats[persona()];
    if (!mine.some((x) => x.id === id)) id = mine.length ? mine[0].id : newSessionId();
    openChats[persona()] = id;
    state.sessionId = id;
    state.messages = sessionEntry(id) ? load(STORE.chat(id), []) : [];
    saveOpenChats();
  }

  /** Opens one of this assistant's chats (id) or a fresh one (null); the chat left behind is memorized. */
  function openSession(id) {
    if (id && !mySessions().some((x) => x.id === id)) return; // another assistant's chat
    const leaving = state.sessionId;
    if (state.thinking || (id && id === leaving) || (!id && !state.messages.length)) {
      setSessions(false);
      $("input").focus();
      return;
    }
    Voice.stopSpeaking();
    setLive(false);
    clearAttachment();
    state.sessionId = id || newSessionId();
    state.messages = id ? load(STORE.chat(id), []) : [];
    openChats[persona()] = state.sessionId;
    saveOpenChats();
    renderChat();
    renderSessions();
    setEmotion(Core.avatarFor(state.messages.length ? "greeting" : "default"));
    setSessions(false);
    $("input").focus();
    retireSession(leaving);
  }

  function deleteSession(id) {
    save(STORE.chat(id), null);
    state.sessions = state.sessions.filter((x) => x.id !== id);
    saveSessions();
    for (const [who, open] of Object.entries(openChats)) if (open === id) openChats[who] = newSessionId();
    saveOpenChats();
    if (id === state.sessionId) {
      state.sessionId = openChats[persona()];
      state.messages = [];
      renderChat();
      setEmotion(Core.avatarFor("default"));
    }
    renderSessions();
  }

  /**
   * Retention for one assistant: its KEEP_SESSIONS newest chats stay; an older one is deleted once its
   * facts are in the notes ("memorized"), and beyond HARD_CAP even if not. Open chats are never deleted.
   */
  function pruneSessions(who) {
    state.sessions.filter((x) => x.persona === who).forEach((entry, position) => {
      if (position < KEEP_SESSIONS || isOpenSomewhere(entry.id)) return;
      if (entry.memorized || position >= HARD_CAP) deleteSession(entry.id);
    });
  }

  function summarizer() {
    const key = state.apiKey;
    const name = assistant();
    return (summary, sections, conversation) => Core.summarizeMemory(key, name, summary, sections, conversation);
  }

  /**
   * A chat that ended (the user moved to another chat or assistant): its facts are extracted into the
   * notes (and Firebase when connected). Once they're in, it's "memorized" and only the newest few chats
   * are kept. If the model can't summarize right now (no key, offline), it stays, marked, for later.
   */
  async function retireSession(id) {
    const entry = sessionEntry(id);
    if (!entry || id === state.sessionId || entry.memorized) return;
    const messages = load(STORE.chat(id), []);
    const saved = await Memory.distill(messages, summarizer(), entry.memoryTs || 0);
    const now = sessionEntry(id);
    if (!now) return; // deleted meanwhile
    if (saved === true && id !== state.sessionId) {
      now.memorized = true;
      now.memoryTs = Math.max(now.memoryTs || 0, ...messages.map((m) => m.ts || 0));
      delete now.unsaved;
    } else if (saved !== true) {
      now.unsaved = true;
    }
    saveSessions();
    pruneSessions(now.persona);
    renderSessions();
    fillSettings();
  }

  /** At startup: every chat that isn't open (either assistant's) is memorized, then each list is trimmed. */
  async function sweepSessions() {
    for (const entry of state.sessions.slice().reverse()) {
      if (entry.id !== state.sessionId) await retireSession(entry.id);
    }
    for (const who of new Set(state.sessions.map((x) => x.persona))) pruneSessions(who);
    renderSessions();
  }

  function renderSessions() {
    const list = $("sessionList");
    list.replaceChildren();
    const hint = $("ephemeralHint");
    hint.hidden = false;
    hint.textContent = t("chatsKept").replace("{name}", assistant());
    if (!mySessions().length) {
      const none = document.createElement("li");
      none.className = "hint";
      none.textContent = t("noChats");
      list.append(none);
    }
    const locale = lang() === "ENGLISH" ? "en" : "he";
    const today = new Date().toDateString();
    for (const entry of mySessions()) {
      const item = document.createElement("li");
      item.className = `session${entry.id === state.sessionId ? " active" : ""}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "session-open";
      if (entry.id === state.sessionId) open.setAttribute("aria-current", "true");
      const title = document.createElement("span");
      title.className = "session-title";
      title.dir = "auto";
      title.textContent = entry.title || t("untitled"); // never innerHTML: titles are what the user typed
      const when = document.createElement("small");
      const updated = new Date(entry.updated);
      when.textContent = updated.toLocaleString(locale, updated.toDateString() === today
        ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });
      if (entry.unsaved) when.textContent += ` · ${t("notSaved")}`;
      open.append(title, when);
      open.addEventListener("click", () => openSession(entry.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "session-delete";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", t("deleteChat"));
      remove.title = t("deleteChat");
      remove.addEventListener("click", () => { if (confirm(t("confirmDeleteChat"))) deleteSession(entry.id); });
      item.append(open, remove);
      list.append(item);
    }
  }

  /** The chats list: a drawer on phones and narrow windows, a fixed column on wide screens (styles.css). */
  const DOCKED = window.matchMedia("(min-width: 1024px)");
  function setSessions(open) {
    const wasOpen = !$("sessions").hidden && !DOCKED.matches;
    $("sessions").hidden = !open;
    $("scrim").hidden = !open || DOCKED.matches;
    $("openSessions").setAttribute("aria-expanded", String(open));
    if (open && !DOCKED.matches) $("closeSessions").focus();
    else if (wasOpen) $("openSessions").focus();
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

  /**
   * A failed request, handled without error bubbles. A missing or rejected key: one calm note with an
   * "Add key" button (not repeated while it's still the latest note) and the key dialog, and the
   * question is still answered in local mode. Anything else (Google down, timeouts, quota, a refusal,
   * a garbled reply): the assistant answers in local mode, the reason only in the tag's tooltip.
   */
  function handleFailure(kind, question, hasImage, hasDocument) {
    if (KEY_PROBLEMS.includes(kind)) {
      // The key is optional: no pop-up. One note per chat (with an "Add key" button), then local mode.
      if (!state.messages.some((m) => m.notice && m.reason === kind)) {
        addMessage({ role: "assistant", text: Core.errorLine(kind, lang())[0], local: true, notice: true, action: "addKey", reason: kind });
      }
      answerOffline(question, hasImage, hasDocument, kind);
      if (kind === "INVALID_KEY") setLive(false); // a wrong key is worth a look; a missing one isn't
      return;
    }
    answerOffline(question, hasImage, hasDocument, kind);
  }

  // --- Sending ---

  async function send(text) {
    if (state.thinking) return;
    const doc = state.pendingDocument;
    // The document's text goes to the model as context; the bubble shows a chip and the question.
    const docContext = doc ? Core.documentContext(doc.name, doc.text, text, lang(), doc.pages) : null;
    if (docContext) text = docContext.question;
    const image = state.pendingImage;
    // A picture always goes to the model; with no text the question is "What's in this picture?".
    const trimmed = image ? Core.imagePrompt(text, lang()) : text.trim();
    if (!trimmed) return;
    Voice.stopSpeaking(); // a new message interrupts Toby
    dictation.cancel(); // and late dictation results must not refill the cleared field
    if (image || doc) clearAttachment();
    const routed = Core.route(trimmed, state.settings);
    const seriousChange = routed.seriousChange;
    const route = image || doc ? { kind: "model", model: Core.MODELS.DEFAULT, webSearch: false } : routed.route;

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

    const sent = { role: "user", text: trimmed };
    if (image) sent.image = image.thumb;
    if (doc) {
      sent.document = { name: doc.name, pages: doc.pages, kind: doc.kind, chars: docContext.chars, truncated: docContext.truncated };
      sent.context = docContext.prompt;
    }
    addMessage(sent);
    if (!state.apiKey) {
      handleFailure("MISSING_KEY", trimmed, Boolean(image), Boolean(doc));
      return;
    }

    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    // A document's text rides with its message (and with follow-ups while it's among the newest ones).
    const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.context || m.text }));
    try {
      // The shared notes come from the local copy, so a GitHub outage never delays or breaks a reply.
      const reply = await Core.complete(state.apiKey, state.settings, history, route, Memory.notes(),
        image ? { mime: image.mime, data: image.data } : null);
      setThinking(false);
      addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget });
      setEmotion(reply.emotion);
      say(reply.text);
      updateMemory();
    } catch (e) {
      setThinking(false);
      if (!(e instanceof Core.AiError)) console.error(e); // a bug: still answered kindly below
      handleFailure(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE", trimmed, Boolean(image), Boolean(doc));
    }
  }

  /**
   * Local mode: no model answered (offline, timeouts, servers down, quota, no key), so the assistant
   * answers from this browser: the time, the date, its notes, or an earlier answer to the same question.
   * [reason]: the failure, shown only as the "local mode" tag's tooltip.
   */
  function answerOffline(question, hasImage = false, hasDocument = false, reason = "NETWORK") {
    const earlier = state.messages.filter((m) => !m.notice).slice(0, -1); // without the question just asked
    const answer = Core.offlineAnswer(question, lang(), Core.nowParts(), Memory.notes(), earlier, hasImage, hasDocument);
    addMessage({ role: "assistant", text: answer.text, local: true, offline: true, reason });
    setEmotion(answer.emotion);
    say(answer.text);
  }

  /** Reads a reply aloud: always in a live conversation (then listens again), else per the setting. */
  function say(text) {
    if (live) {
      setVoiceStatus("liveSpeaking", "listening");
      Voice.speak(text, lang(), { ...voiceTuning(), onDone: () => { if (live) listen(); } });
    } else if (state.settings.speakReplies) {
      Voice.speak(text, lang(), voiceTuning());
    }
  }

  // --- Shared memory (background; failures only show in Settings) ---

  /** After a reply: pull what the other devices learned, then fold this chat's older messages into notes. */
  function updateMemory() {
    const id = state.sessionId;
    const messages = state.messages.slice();
    const entry = sessionEntry(id);
    Memory.pull()
      .then(() => Memory.fold(messages, summarizer(), entry ? entry.memoryTs || 0 : 0))
      .then((covered) => {
        const current = sessionEntry(id);
        if (typeof covered === "number" && current) {
          current.memoryTs = Math.max(current.memoryTs || 0, covered);
          saveSessions();
        }
        fillSettings();
      });
  }

  function memoryStatusText() {
    const status = Memory.status();
    if (!status.configured) return t("firebaseOff");
    let text = status.lastError ? t("firebaseError").replace("{error}", status.lastError)
      : status.lastSync ? t("firebaseSynced").replace("{time}", new Date(status.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
        : t("firebaseWaiting");
    if (status.pending) text += t("firebasePending").replace("{count}", status.pending);
    return text;
  }

  // --- Settings drawer ---

  /** Floma is the assistant by default; Toby, the jester, is an add-on switched on here. */
  function fillPersonas() {
    const on = persona() === "toby";
    $("setToby").checked = on;
    const profile = Core.profile(on ? "toby" : "floma");
    $("tobyAddonDesc").textContent = profile.description[lang()] || profile.description.HEBREW;
    $("tobyAddonArt").src = `${AVATAR_DIR}${Core.avatarImage("HAPPY", "toby")}`;
  }

  function switchPersona(id) {
    if (id === persona() || state.thinking) return;
    const leavingChat = state.sessionId;
    Voice.stopSpeaking();
    setLive(false);
    clearAttachment();
    state.settings.assistantName = Core.nameAfterSwitch(state.settings.assistantName, persona(), id);
    state.settings.persona = id;
    save(STORE.settings, state.settings);
    showPersonaChats(); // Floma's and Toby's chats are separate lists
    fillSettings();
    renderChat();
    renderSessions();
    setEmotion(Core.avatarFor("greeting"));
    retireSession(leavingChat); // the other assistant's chat ended for now: memorize it
  }

  function fillThemes() {
    const picker = $("themePicker");
    picker.replaceChildren();
    const themes = window.FLOMA_PLATFORM.themes;
    const current = themes[state.settings.theme] ? state.settings.theme : window.FLOMA_PLATFORM.default_theme;
    for (const [id, theme] of Object.entries(themes)) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = `swatch${id === current ? " selected" : ""}`;
      swatch.setAttribute("role", "radio");
      swatch.setAttribute("aria-checked", String(id === current));
      swatch.style.setProperty("--swatch-bg", theme.background);
      swatch.style.setProperty("--swatch-accent", theme.primary);
      const dot = document.createElement("span");
      dot.className = "swatch-dot";
      const name = document.createElement("small");
      name.textContent = Core.label(theme, lang());
      swatch.append(dot, name);
      swatch.addEventListener("click", () => {
        state.settings.theme = id;
        save(STORE.settings, state.settings);
        applyTheme();
        fillThemes();
      });
      picker.append(swatch);
    }
  }

  function fillModels() {
    const select = $("setModel");
    const choices = window.FLOMA_PLATFORM.models.choices;
    if (select.options.length !== choices.length || select.dataset.lang !== lang()) {
      select.replaceChildren(...choices.map((c) => new Option(Core.label(c, lang()), c.key)));
      select.dataset.lang = lang();
    }
    const current = choices.find((c) => c.key === state.settings.modelChoice) || choices[0];
    select.value = current.key;
    $("modelHint").textContent = current.hint[lang()] || current.hint.HEBREW;
  }

  function fillSettings() {
    const s = state.settings;
    $("assistantName").textContent = assistant();
    document.title = assistant() === "Floma" ? "Floma" : `Floma - ${assistant()}`;
    $("input").placeholder = t("placeholder").replace("{name}", assistant());
    $("setName").value = s.assistantName;
    const hasCharacter = Core.animated(persona());
    $("personaNote").hidden = hasCharacter;
    $("setPersonality").disabled = $("setHumor").disabled = !hasCharacter;
    fillPersonas();
    fillThemes();
    fillModels();
    document.querySelectorAll('[data-i18n="liveHint"]').forEach((el) => {
      el.textContent = t("liveHint").replace("{name}", assistant());
    });
    $("setPersonality").value = s.personality;
    $("setHumor").value = s.humorLevel;
    $("setLanguage").value = s.language;
    $("setSerious").checked = s.seriousMode;
    $("setInstructions").value = s.customInstructions;
    $("setWebSearch").checked = s.webSearch;
    $("keyStatus").textContent = t(state.apiKey ? "keySaved" : "keyMissing");
    $("removeKey").disabled = !state.apiKey;
    $("changeKey").textContent = t(state.apiKey ? "changeKey" : "addKey");
    $("firebaseStatus").textContent = memoryStatusText();
    $("firebaseSecret").placeholder = Memory.hasSecret() ? t("firebaseSecretSaved") : "";
    if (document.activeElement !== $("firebaseUrl")) $("firebaseUrl").value = s.firebaseUrl || "";
    $("firebaseRemove").disabled = !Memory.hasSecret() && !s.firebaseUrl;
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

  function openKeyDialog(message = "") {
    $("keyInput").value = "";
    $("keyError").textContent = typeof message === "string" ? message : ""; // (also bound as a click handler)
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
    status.textContent = key ? t(key).replace("{name}", assistant()) : "";
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

  let live = false;
  let heardInLive = "";
  let quietRounds = 0;

  const dictation = Voice.createDictation({
    onText(text, final) {
      $("input").value = [textBeforeDictation.trim(), text].filter(Boolean).join(" ");
      autoGrow();
      if (live && final) heardInLive = text;
    },
    onState(listening) {
      if (live && !listening) {
        // Live conversation: what was heard goes out right away; two silent rounds end it.
        const heard = heardInLive.trim();
        heardInLive = "";
        if (heard) {
          quietRounds = 0;
          $("input").value = "";
          autoGrow();
          send(heard);
        } else if (++quietRounds >= 2) {
          setLive(false);
        } else {
          listen();
        }
      }
      const mic = $("mic");
      mic.classList.toggle("listening", listening);
      mic.setAttribute("aria-pressed", String(listening));
      mic.setAttribute("aria-label", t(listening ? "micStop" : "micStart"));
      mic.title = t(listening ? "micStop" : "micStart");
      if (listening) setVoiceStatus("listening", "listening");
      else if ($("voiceStatus").dataset.kind === "listening") setVoiceStatus(null);
      if (!listening) $("input").focus();
    },
    onError(key) {
      setLive(false); // a blocked mic or no speech service ends the live loop
      setVoiceStatus(key, "error");
    },
  });

  function listen() {
    if (!live || dictation.listening || state.thinking) return;
    Voice.stopSpeaking();
    textBeforeDictation = "";
    if (dictation.start(lang())) setVoiceStatus("liveListening", "listening");
  }

  /** Live conversation on/off: the mic opens again each time the assistant has finished speaking. */
  function setLive(on) {
    if (live === on) return;
    live = on;
    quietRounds = 0;
    heardInLive = "";
    const button = $("live");
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", t(on ? "liveStop" : "liveStart"));
    button.title = t(on ? "liveStop" : "liveStart");
    if (on) {
      listen();
    } else {
      dictation.cancel();
      Voice.stopSpeaking();
      setVoiceStatus(null);
    }
  }

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
    $("live").hidden = !(Voice.dictationSupported && Voice.speechSupported); // live needs both
    $("setRate").value = state.settings.voiceRate || 1;
    $("setPitch").value = state.settings.voicePitch || 1;
    $("rateValue").textContent = `${Number($("setRate").value).toFixed(1)}×`;
    $("pitchValue").textContent = `${Number($("setPitch").value).toFixed(1)}×`;
    $("setRate").disabled = $("setPitch").disabled = $("testVoice").disabled = !Voice.speechSupported;
    $("setSpeak").checked = Boolean(state.settings.speakReplies);
    $("elevenKey").placeholder = state.elevenKey ? t("elevenKeySaved") : "";
    if (document.activeElement !== $("elevenVoice")) $("elevenVoice").value = state.settings.elevenVoiceId || "";
    $("elevenRemove").disabled = !state.elevenKey && !state.settings.elevenVoiceId;
    $("elevenStatus").textContent = !state.elevenKey ? t("elevenOff")
      : state.cloudVoiceError ? t(`elevenErr${state.cloudVoiceError}`) : t("elevenOn");
    $("elevenStatus").classList.toggle("error", Boolean(state.elevenKey && state.cloudVoiceError));
    $("setSpeak").disabled = !Voice.speechSupported;
    $("speakHint").textContent = !Voice.speechSupported ? t("speakUnsupported")
      : state.settings.speakReplies && !Voice.hasVoiceFor(state.settings.language) ? t("speakNoVoice")
        : t("speakHint");
  }

  // --- Pictures: the native picker (camera on phones), paste, a removable preview ---

  /**
   * Shrinks a picture to the platform's limit and re-encodes it as JPEG in this browser (which also
   * drops EXIF/GPS data). Resolves to { mime, data (base64), thumb (data URL) }.
   */
  async function prepareImage(file) {
    const limits = window.FLOMA_PLATFORM.vision;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const draw = (side, quality) => {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };
    const full = draw(limits.max_side, limits.jpeg_quality / 100);
    const data = full.slice(full.indexOf(",") + 1);
    if (data.length * 0.75 > limits.max_bytes) throw new Error("image too large");
    const thumb = draw(limits.thumb_side, 0.8);
    bitmap.close();
    return { mime: "image/jpeg", data, thumb };
  }

  async function attachFile(file) {
    if (!file) return;
    if (Docs.isDocument(file)) {
      attachDocument(file);
      return;
    }
    if (!file.type.startsWith("image/")) return;
    state.pendingDocument = null;
    try {
      state.pendingImage = await prepareImage(file);
      showAttachment();
      $("input").focus();
    } catch (e) {
      console.warn("Picture not usable", e);
      addMessage({ role: "assistant", text: window.FLOMA_PLATFORM.vision.unreadable[lang()] || window.FLOMA_PLATFORM.vision.unreadable.HEBREW,
        local: true, error: true });
    }
  }

  async function attachDocument(file) {
    state.pendingImage = null;
    state.pendingDocument = null;
    setVoiceStatus("reading", "listening");
    try {
      state.pendingDocument = await Docs.readDocument(file);
      setVoiceStatus(null);
      showAttachment();
      $("input").focus();
    } catch (e) {
      setVoiceStatus(null);
      if (!(e instanceof Docs.DocumentError)) console.warn("Document not usable", e);
      const kind = e instanceof Docs.DocumentError ? e.kind : "unreadable";
      addMessage({ role: "assistant", text: Core.documentLine(kind, lang()), local: true, error: true });
      clearAttachment();
    }
  }

  /** 📄 name, pages and size: the attached document (before sending, and in the sent bubble). */
  function documentChip(doc) {
    const chip = document.createElement("div");
    chip.className = "doc-chip";
    const icon = document.createElement("span");
    icon.className = "doc-icon";
    icon.textContent = doc.kind === "pdf" ? "PDF" : "TXT";
    const texts = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = doc.name;
    name.dir = "auto";
    const meta = document.createElement("small");
    const chars = Number(doc.chars).toLocaleString();
    meta.textContent = (doc.pages === 1 ? t("docPage") : doc.pages ? t("docPages").replace("{pages}", doc.pages) : t("docChars")).replace("{chars}", chars)
      + (doc.truncated ? t("docCut") : "");
    texts.append(name, meta);
    chip.append(icon, texts);
    return chip;
  }

  function showAttachment() {
    const image = state.pendingImage;
    const doc = state.pendingDocument;
    $("attachment").hidden = !image && !doc;
    $("attachmentImage").hidden = !image;
    if (image) $("attachmentImage").src = image.thumb;
    $("attachmentImage").alt = t("picture");
    const slot = $("attachmentDoc");
    slot.hidden = !doc;
    slot.replaceChildren();
    if (doc) {
      const preview = Core.documentContext(doc.name, doc.text, "", lang(), doc.pages);
      slot.append(...documentChip({ ...doc, chars: preview.chars, truncated: preview.truncated }).childNodes);
    }
    $("attachment").classList.toggle("has-doc", Boolean(doc));
  }

  function clearAttachment() {
    state.pendingImage = null;
    state.pendingDocument = null;
    $("imageInput").value = "";
    showAttachment();
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
    loadSessions();
    setupPwa();
    applyTheme();
    applyLanguage();
    fillSettings();
    renderChat();
    renderSessions();
    const lastToby = [...state.messages].reverse().find((m) => m.role === "assistant" && !m.error && !m.notice);
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
    $("scrim").addEventListener("click", () => {
      if (!$("settings").hidden) setDrawer(false);
      else setSessions(false);
    });
    $("openSessions").addEventListener("click", () => setSessions(true));
    $("closeSessions").addEventListener("click", () => setSessions(false));
    $("newChat").addEventListener("click", () => openSession(null));
    $("sessionsNewChat").addEventListener("click", () => openSession(null));
    DOCKED.addEventListener("change", () => setSessions(false)); // widening docks the list: no drawer, no scrim
    $("setToby").addEventListener("change", () => switchPersona($("setToby").checked ? "toby" : "floma"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("settings").hidden) setDrawer(false);
      else if (event.key === "Escape" && !$("sessions").hidden && !DOCKED.matches) setSessions(false);
      else if (event.key === "Escape") {
        setLive(false);
        Voice.stopSpeaking();
        markSpeaking(null);
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
    bindSetting("setModel", "modelChoice", (el) => el.value);
    bindSetting("setRate", "voiceRate", (el) => Number(el.value));
    bindSetting("setPitch", "voicePitch", (el) => Number(el.value));
    $("setRate").addEventListener("input", () => { $("rateValue").textContent = `${Number($("setRate").value).toFixed(1)}×`; });
    $("setPitch").addEventListener("input", () => { $("pitchValue").textContent = `${Number($("setPitch").value).toFixed(1)}×`; });
    $("testVoice").addEventListener("click", () => Voice.speak(t("testPhrase"), lang(), {
      rate: Number($("setRate").value), pitch: Number($("setPitch").value),
    }));
    $("live").addEventListener("click", () => setLive(!live));
    $("attach").addEventListener("click", () => $("imageInput").click());
    $("imageInput").addEventListener("change", () => attachFile($("imageInput").files[0]));
    $("removeImage").addEventListener("click", () => { clearAttachment(); $("input").focus(); });
    $("input").addEventListener("paste", (event) => {
      const item = [...(event.clipboardData ? event.clipboardData.items : [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        event.preventDefault();
        attachFile(item.getAsFile());
      }
    });
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
      Voice.stopSpeaking();
      for (const entry of state.sessions) save(STORE.chat(entry.id), null); // both assistants' chats
      save(STORE.chat(state.sessionId), null);
      state.sessions = [];
      saveSessions();
      openChats = {};
      showPersonaChats();
      state.messages = [];
      Memory.forgetLocal(); // like Android: the local notes go too (what's in Firebase stays)
      renderChat();
      renderSessions();
      setEmotion(Core.avatarFor("default"));
    });

    $("firebaseSave").addEventListener("click", () => {
      const url = Memory.normalizeDbUrl($("firebaseUrl").value);
      if (!url) {
        $("firebaseProblem").textContent = t("firebaseBadUrl");
        return;
      }
      $("firebaseProblem").textContent = "";
      const secretValue = $("firebaseSecret").value.trim();
      if (secretValue) Memory.setSecret(secretValue);
      $("firebaseSecret").value = "";
      state.settings.firebaseUrl = url;
      save(STORE.settings, state.settings);
      fillSettings();
      Memory.syncNow().then(fillSettings); // the first sync also uploads what this browser knows
    });
    $("firebaseRemove").addEventListener("click", () => {
      Memory.setSecret(null);
      delete state.settings.firebaseUrl;
      save(STORE.settings, state.settings);
      $("firebaseProblem").textContent = "";
      fillSettings();
    });

    // ElevenLabs reads replies when a key is saved; re-run after saving to retry right away.
    const setupCloudVoice = () => Voice.configureCloud({
      key: () => state.elevenKey,
      voiceId: () => state.settings.elevenVoiceId || "",
      onResult: (error) => {
        if (state.cloudVoiceError === error) return;
        state.cloudVoiceError = error;
        fillVoiceSettings();
      },
    });
    setupCloudVoice();
    $("elevenSave").addEventListener("click", () => {
      const key = $("elevenKey").value.trim();
      const voice = $("elevenVoice").value.trim();
      if (voice && !Core.validVoiceId(voice)) {
        $("elevenProblem").textContent = t("elevenBadVoice");
        return;
      }
      if (!key && !state.elevenKey) {
        $("elevenProblem").textContent = t("elevenNoKey");
        return;
      }
      $("elevenProblem").textContent = "";
      if (key) {
        state.elevenKey = key;
        save(STORE.elevenKey, key);
      }
      $("elevenKey").value = "";
      state.settings.elevenVoiceId = voice;
      save(STORE.settings, state.settings);
      state.cloudVoiceError = null;
      setupCloudVoice();
      fillSettings();
    });
    $("elevenRemove").addEventListener("click", () => {
      state.elevenKey = null;
      save(STORE.elevenKey, null);
      delete state.settings.elevenVoiceId;
      save(STORE.settings, state.settings);
      state.cloudVoiceError = null;
      $("elevenProblem").textContent = "";
      Voice.stopSpeaking();
      fillSettings();
    });

    $("keyForm").addEventListener("submit", submitKey);
    $("keyLater").addEventListener("click", () => $("keyDialog").close());

    // Notes the phone or the PC added since last time (throttled; harmless offline).
    Memory.setDatabaseUrl(() => state.settings.firebaseUrl);
    Memory.pull().then(fillSettings).then(sweepSessions); // chats left last time are memorized

    // No key prompt: Gemini is optional (Settings → Model). Without it the chat answers in local mode.
    $("input").focus();
  }

  init();
})();
