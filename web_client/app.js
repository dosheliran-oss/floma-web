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
 * Only each assistant's KEEP_SESSIONS (10) newest unpinned chats are kept in this browser; an older chat is
 * deleted once its facts are in the notes; one whose facts aren't extracted yet moves to the extraction queue (Step 74).
 *
 * Pinned chats (Step 70, 📌, at most MAX_PINNED = 5 per assistant: entry.pinnedAt) never count toward those
 * limits and are never deleted automatically. Each is stored whole in the user's Firebase
 * (chat_sessions.pinned_root/<persona>/<id>, memory.js putPinned): entry.pinDirty = changed since the last
 * upload, entry.pinSynced = Firebase has it; "floma.unpinned" lists the ones unpinned or deleted here that
 * Firebase still has. Every start pulls the pinned chats, so the same credentials bring them to any device.
 */
(function () {
  "use strict";

  const Core = window.FlomaCore;
  const Memory = window.FlomaMemory;
  const Sites = window.FlomaSites;
  const Catalog = window.FlomaCatalog;
  const Launcher = window.FlomaLauncher;
  const Quota = window.FlomaQuota;
  const Voice = window.FlomaVoice;
  const Docs = window.FlomaDocuments;
  const Skills = window.FlomaSkills;
  // Step 75: each account keeps its own keys, settings and chats (the browser's first account keeps the old ones).
  const Account = window.FlomaAccount;
  const U = `floma.${Account.storagePrefix()}`;
  const STORE = {
    key: `${U}apiKey`, elevenKey: `${U}elevenLabsKey`, settings: `${U}settings`, sessions: `${U}sessions`, active: `${U}activeSession`,
    chat: (id) => `${U}chat.${id}`,
    legacyHistory: `${U}history`, // the single infinite chat before sessions (migrated once)
    seenBuild: "floma.seenBuild", reloadedFor: "floma.reloadedFor", // the published build this browser ran last (Step 59)
    unpinned: `${U}unpinned`, // Step 70: pinned chats unpinned / deleted here that Firebase still has
    queue: `${U}extractionQueue`, // Step 74: chats waiting for their facts to be extracted
  };
  const MAX_STORED = 200; // messages per chat
  const SESSIONS = window.FLOMA_PLATFORM.chat_sessions; // the same limits on every platform
  const KEEP_SESSIONS = SESSIONS.keep; // unpinned chats kept per assistant once older ones are memorized (10)
  const MAX_PINNED = SESSIONS.max_pinned; // pinned chats per assistant (5)
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
      sectionAgent: "רשת מבודדת וזהות סוכן (Isolated Agent Network & Identity)",
      agentHint: "חיפושי הסוכן ברשת עוברים קודם בממסר Cloudflare החינמי שלך (relay/cloudflare_worker.js), ואם הוא לא זמין - בבקשה ישירה זמנית בלי עוגיות. אתרים מוגבלים לא נגישים בשום שכבה. פרוקסי, Tor, זהות הסוכן והתחזוקה הלילית - באפליקציית המחשב.",
      relayUrl: "כתובת הממסר (Relay URL)", relayKey: "מפתח הממסר (X-Floma-Relay-Key)", relaySave: "שמירה", relayTest: "בדיקת חיבור",
      relayRemove: "הסרה", relayHttps: "כתובת הממסר חייבת להתחיל ב-https://", relaySaved: "הממסר נשמר בדפדפן הזה",
      agentOff: "שכבה 1 לא מוגדרת: בקשות ישירות זמניות (שכבה 3).", agentOn: "שכבה 1 - ממסר: {host}", agentChecking: "בודק את הממסר…",
      agentUp: "הממסר פעיל ✓ ({host})", agentDown: "הממסר לא עונה - הבקשות יעברו ישירות (שכבה 3).", agentLast: " · בקשה אחרונה: {tier}",
      sectionModel: "מודל (Gemini)", keySaved: "מפתח שמור בדפדפן הזה.", keyMissing: "אין מפתח: עונה במצב מקומי. המפתח אופציונלי.",
      changeKey: "החלפת מפתח", removeKey: "מחיקת מפתח", addKey: "הוספת מפתח",
      sectionMemory: "זיכרון", memoryHint: "השיחות נשמרות בדפדפן הזה בלבד. מחיקת שיחות לא מוחקת את מה שלמדתי עליך.", clearChat: "מחיקת כל השיחות",
      confirmClear: "למחוק את כל השיחות מהדפדפן הזה? מה שלמדתי עליך נשאר בזיכרון.",
      memBadgeOn: "☁ זיכרון ענן מחובר · {topics} נושאים · {facts} עובדות", memBadgeOff: "☁ זיכרון ענן לא מחובר · {facts} עובדות בדפדפן",
      memBadgeError: "☁ שגיאת סנכרון ({error}) · {facts} עובדות בדפדפן", memBadgeTime: " · סונכרן {time}",
      memSyncNow: "סנכרן וחלץ עכשיו", memSyncing: "מסנכרן ומחלץ עובדות…", memView: "סיכום זיכרון",
      memViewTitle: "מה אני זוכר עליך", memViewEmpty: "עוד אין עובדות שמורות.", memNotSavedYet: "לא נשמר עדיין לענן",
      guide: "📖 מדריך מערכת ויכולות", help: "מדריך מערכת ויכולות",
      guideMissing: "המדריך לא נטען כרגע (אולי אין חיבור, או שהאתר מתעדכן).", guideRetry: "נסה שוב",
      guideLoading: "טוען את המדריך…", sectionSites: "אתרים לשאילתות", sitesHint: "כששואלים על אחד האתרים האלה, אפליקציית המחשב שולפת את המידע מהאתר ועונה במודל המקומי - בלי טוקנים בענן. אפשר לשים {q} בכתובת במקום מילות החיפוש.",
      sitesNeedsDesktop: "בדפדפן אי אפשר לקרוא אתרים אחרים ישירות: התכונה פועלת באפליקציית המחשב (ובאנדרואיד דרכה).",
      sitesAdd: "הוסף", sitesUrl: "כתובת אתר", sitesName: "שם (לא חובה)", sitesBad: "זו לא כתובת אתר תקינה.", sitesNone: "עוד לא נוספו אתרים.", sitesRemove: "הסרה", confirmRemoveKey: "למחוק את המפתח מהדפדפן הזה?",
      chats: "שיחות", newChat: "שיחה חדשה", untitled: "שיחה חדשה", deleteChat: "מחיקת השיחה",
      confirmDeleteChat: "למחוק את השיחה הזו?", noChats: "עוד אין שיחות קודמות.",
      notSaved: "ממתינה לשמירה בזיכרון",
      tobyAddon: "טובי (תוסף ליצן)",
      personaSwitch: "החלפת עוזר: פלומה או טובי",
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
      versionLine: "Floma Web {app} · מנוע {engine}", versionDev: "Floma Web (עותק מקומי, לא מהאתר המפורסם)",
      checkUpdates: "בדוק עדכונים עכשיו", upToDate: "הכול מעודכן.", updatedTo: "Floma עודכנה לגרסה {version} ✨",
      updateOffline: "לא ניתן לבדוק עדכונים כרגע (אין חיבור?).",
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
      sectionAgent: "Isolated Agent Network & Identity",
      agentHint: "The agent's web lookups go through your free Cloudflare relay first (relay/cloudflare_worker.js), and when it's down through a one-off direct request with no cookies. Restricted sites are reached on no tier. The proxy, Tor, the agent identity and the nightly maintenance are in the desktop app.",
      relayUrl: "Relay URL", relayKey: "Relay key (X-Floma-Relay-Key)", relaySave: "Save", relayTest: "Test connection",
      relayRemove: "Remove", relayHttps: "The relay URL must start with https://", relaySaved: "The relay is saved in this browser",
      agentOff: "Tier 1 isn't set: one-off direct requests (Tier 3).", agentOn: "Tier 1 - relay: {host}", agentChecking: "Checking the relay…",
      agentUp: "The relay is up ✓ ({host})", agentDown: "The relay isn't answering - requests go direct (Tier 3).", agentLast: " · last request: {tier}",
      sectionModel: "Model (Gemini)", keySaved: "A key is saved in this browser.", keyMissing: "No key: answering in local mode. The key is optional.",
      changeKey: "Change key", removeKey: "Remove key", addKey: "Add key",
      sectionMemory: "Memory", memoryHint: "Chats are kept in this browser only. Deleting chats never deletes what I learned about you.", clearChat: "Delete all chats",
      confirmClear: "Delete all chats from this browser? What I learned about you stays in memory.",
      memBadgeOn: "☁ Cloud memory connected · {topics} topics · {facts} facts", memBadgeOff: "☁ Cloud memory not connected · {facts} facts in this browser",
      memBadgeError: "☁ Sync error ({error}) · {facts} facts in this browser", memBadgeTime: " · synced {time}",
      memSyncNow: "Sync & extract now", memSyncing: "Syncing and extracting facts…", memView: "Memory Summary",
      memViewTitle: "What I remember about you", memViewEmpty: "No saved facts yet.", memNotSavedYet: "not in the cloud yet",
      guide: "📖 System guide & capabilities", help: "System guide & capabilities",
      guideMissing: "The guide didn't load right now (maybe offline, or the site is updating).", guideRetry: "Try again",
      guideLoading: "Loading the guide…", sectionSites: "Custom query sites", sitesHint: "When you ask about one of these sites, the desktop app reads it and the local model answers - 0 cloud tokens. Put {q} in an address for the search words.",
      sitesNeedsDesktop: "A browser can't read other sites directly: this works in the desktop app (and on Android through it).",
      sitesAdd: "Add", sitesUrl: "Site address", sitesName: "Name (optional)", sitesBad: "That isn't a valid site address.", sitesNone: "No sites added yet.", sitesRemove: "Remove", confirmRemoveKey: "Remove the key from this browser?",
      chats: "Chats", newChat: "New chat", untitled: "New chat", deleteChat: "Delete chat",
      confirmDeleteChat: "Delete this chat?", noChats: "No earlier chats yet.",
      notSaved: "Waiting to be saved to memory",
      tobyAddon: "Toby (jester add-on)",
      personaSwitch: "Switch assistant: Floma or Toby",
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
      versionLine: "Floma Web {app} · engine {engine}", versionDev: "Floma Web (a local copy, not the published site)",
      checkUpdates: "Check for updates now", upToDate: "Everything is up to date.", updatedTo: "Floma was updated to {version} ✨",
      updateOffline: "Can't check for updates right now (offline?).",
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
    activeSkill: null, // the open chat's skill (the pill above the message box), Step 60
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
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); }); // tooltips
    // Step 70: the shared texts (persona/floma_platform.js → chat_sessions.texts).
    $("summarizeLabel").textContent = ct("summarize");
    $("lessonChip").setAttribute("aria-label", Skills.lessonChip(lang())); // Step 79: "📚 סיכום שיעור אקדמי"
    $("lessonChip").title = Skills.lessonChip(lang());
    $("summarizeChat").title = ct("summarize_hint");
    $("summarizeChat").setAttribute("aria-label", ct("summarize"));
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
      if (failSafe()) { showToast(guardText("tripped")); return; } // Step 73: the voice is off under high load
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

  /** The user's speed and pitch; Step 73: the Vax style (Toby only) multiplies them (calmer, lower). */
  const voiceTuning = () => {
    const preset = Core.activeVoicePreset(state.settings.voicePreset, Core.personaId(persona()));
    const tts = (preset && preset.tts) || {};
    const clamp = (v) => Math.min(2, Math.max(0.5, v));
    return {
      rate: clamp((Number(state.settings.voiceRate) || 1) * (tts.rate || 1)),
      pitch: clamp((Number(state.settings.voicePitch) || 1) * (tts.pitch || 1)),
    };
  };

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
      if (message.facts || message.launcher) {
        const tag = document.createElement("span");
        tag.className = "tag sites";
        tag.textContent = window.FLOMA_PLATFORM.site_query[message.facts ? "facts_badge" : "launcher_badge"][lang()];
        footer.append(tag);
      } else if (message.siteQuery) {
        const tag = document.createElement("span");
        tag.className = "tag sites";
        tag.textContent = window.FLOMA_PLATFORM.site_query.badge[lang()];
        footer.append(tag);
      } else if (message.offline) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = `⚡ ${t("localMode")}`;
        if (message.reason) tag.title = Core.errorLine(message.reason, lang())[0]; // why, without a red bubble
        footer.append(tag);
      }
      footer.append(speakButton(message.text));
      bubble.append(footer);
    }
    if (message.copy) {  // @translate (Step 63): one tap copies the translation
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-details copy-translation";
      copy.textContent = Skills.translateText("copy", lang());
      copy.addEventListener("click", async () => {
        await copyText(message.text);
        showToast(Skills.translateText("copied", lang()));
      });
      bubble.append(copy);
    }
    if (message.tutor) {  // Step 78: the math tutor's explanation, copied as it is (its notation pastes cleanly)
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-details copy-tutor";
      copy.textContent = Skills.tutorText("copy", lang());
      copy.addEventListener("click", async () => {
        await copyText(message.text);
        showToast(Skills.tutorText("copied", lang()));
      });
      bubble.append(copy);
    }
    if (message.copyValue) {  // @calc (Step 64) / @code (Step 72): one tap copies the result or the code
      const code = message.skill === "code_vault";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-details copy-result";
      copy.textContent = code ? Skills.codeText("copy", lang()) : Skills.calcText("copy", lang());
      copy.addEventListener("click", async () => {
        await copyText(message.copyValue);
        showToast(code ? Skills.codeText("copied", lang()) : Skills.calcText("copied", lang()));
      });
      bubble.append(copy);
    }
    if (message.chips) {  // Step 72: quick replies - a tap sends the chip's text as the next message
      const row = document.createElement("div");
      row.className = "chips";
      for (const chip of message.chips) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.dir = "auto";
        button.textContent = chip.label; // never innerHTML: titles come from the vault file
        button.addEventListener("click", () => sendChip(chip.send, message.skill));
        row.append(button);
      }
      bubble.append(row);
    }
    if (message.caption) {
      const caption = document.createElement("small");
      caption.className = "bubble-caption";
      caption.textContent = message.caption;
      bubble.append(caption);
    }
    if (message.launcher) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-details";
      copy.textContent = window.FLOMA_PLATFORM.site_query.copy_details[lang()];
      copy.addEventListener("click", () => copyDetails(message.text));
      bubble.append(copy);
      // Step 77: the phone lookup's official links open on the PC, in the bot's isolated browser - never here.
      if (message.skill === "phone" && Account.userId()) {
        const openBot = document.createElement("button");
        openBot.type = "button";
        openBot.className = "copy-details open-bot";
        openBot.textContent = `🕶 ${bt("open_bot")}`;
        openBot.addEventListener("click", () => openInBotBrowser(message, openBot));
        bubble.append(openBot);
      }
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
    fillPersonaToggle(); // no switching mid-reply: the other assistant waits until the answer is in
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
    entry.extracted = "pending"; // Step 74: ⏳ in the chats list until its facts are in the memory
    if (entry.pinnedAt) {
      entry.pinDirty = true; // the copy in Firebase is behind now
      schedulePinnedUpload();
    }
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
    setActiveSkill(null); // a skill belongs to the chat it was turned on in
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
    const gone = sessionEntry(id);
    if (gone && gone.pinSynced) forgetRemotePin(gone); // the user deleted a pinned chat: Firebase forgets it too
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
   * Retention for one assistant: its KEEP_SESSIONS newest unpinned chats stay; an older one is deleted once
   * its facts are in the notes ("memorized"); otherwise it waits in the extraction queue. Pinned chats and open chats
   * are never deleted.
   */
  function pruneSessions(who) {
    // Step 74: no hard cap that throws facts away - an older chat not extracted yet moves to the extraction queue.
    let queued = 0;
    state.sessions.filter((x) => x.persona === who && !x.pinnedAt).forEach((entry, position) => {
      if (position < KEEP_SESSIONS || isOpenSomewhere(entry.id) || distilling.has(entry.id)) return;
      if (Core.extractionStatus(entry) !== "extracted") {
        enqueueChat(entry);
        queued += 1;
      }
      deleteSession(entry.id);
    });
    if (queued) processQueue();
  }

  // --- Step 74: the extraction queue (chats waiting for their facts; synced at memory_ledger.pending_root) ---

  const LEDGER = window.FLOMA_PLATFORM.memory_ledger;
  const lt = (key, values) => Core.ledgerText(key, lang(), values);
  let extractionQueue = (load(STORE.queue, []) || []).filter((x) => x && x.id && x.persona && Array.isArray(x.messages));
  const saveQueue = () => save(STORE.queue, extractionQueue);
  let queueBusy = false;

  const queueNode = (item) => ({ id: item.id, persona: item.persona, title: item.title, created: item.created,
    queued_at: item.queued_at, device: item.device, messages: item.messages });

  function enqueueChat(entry) {
    const messages = load(STORE.chat(entry.id), []).filter((m) => !m.local && m.ts && m.text)
      .slice(-LEDGER.max_queue_messages).map((m) => ({ role: m.role, text: m.text, ts: Math.trunc(m.ts) }));
    const item = { id: entry.id, persona: entry.persona, title: entry.title || "", created: Math.trunc(entry.created || Date.now()),
      queued_at: Date.now(), device: "web", messages, synced: false };
    extractionQueue = [...extractionQueue.filter((x) => !(x.id === item.id && x.persona === item.persona)), item];
    saveQueue();
  }

  /** Ours go up to Firebase; each queued chat (ours, or the phone's / the PC's) is summarized, then removed everywhere. */
  async function processQueue() {
    if (queueBusy) return;
    if (failSafe()) { deferredBackground = true; return; }
    queueBusy = true;
    try {
      const remote = Memory.configured() ? await Memory.fetchQueue() : null;
      if (Memory.configured()) {
        for (const item of extractionQueue) if (!item.synced && await Memory.putQueue(item.persona, item.id, queueNode(item))) item.synced = true;
      }
      const known = new Set(extractionQueue.map((x) => `${x.persona}/${x.id}`));
      for (const [who, chats] of Object.entries(remote || {})) {
        for (const [id, node] of Object.entries(chats || {})) {
          if (known.has(`${who}/${id}`) || !node || !Array.isArray(node.messages)) continue;
          const messages = node.messages.filter((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "assistant")
            && typeof m.ts === "number");
          extractionQueue.push({ id, persona: who, title: String(node.title || ""), created: node.created || 0,
            queued_at: node.queued_at || 0, device: String(node.device || ""), messages, synced: true });
        }
      }
      saveQueue();
      let done = 0;
      for (const item of extractionQueue.slice()) {
        if (!(await Memory.distill(item.messages, summarizer(), 0))) continue; // no model now (or it failed): it waits
        if (Memory.configured()) await Memory.putQueue(item.persona, item.id, null);
        extractionQueue = extractionQueue.filter((x) => x !== item);
        saveQueue();
        done += 1;
      }
      if (done) showToast(lt("queue_done", { count: done }));
    } finally {
      queueBusy = false;
      renderMemoryBadges();
      if ($("memoryDialog").open) renderMemoryFacts();
    }
  }

  // --- Step 74: back in front (focus / visible) - pull and push the memory, work on the queue (throttled) ---

  let lastFocusSync = Date.now();
  function syncOnFocus() {
    if (Date.now() - lastFocusSync < LEDGER.focus_sync_seconds * 1000 || !Memory.configured() || failSafe()) return;
    lastFocusSync = Date.now();
    Memory.pull(true).then(() => Memory.push()).then(() => { fillSettings(); processQueue(); });
  }

  // --- Step 74: "ריכוז מידע" backups ---

  function exportMemoryBackup() {
    const doc = Memory.exportBackup();
    const count = Object.values(doc.topics).reduce((n, items) => n + Object.values(items).filter((r) => !r.deleted).length, 0);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }));
    link.download = `floma-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(lt("exported", { count }));
    return doc;
  }

  async function importMemoryBackup(file) {
    let doc = null;
    try { doc = JSON.parse(await file.text()); } catch (e) { doc = null; }
    const result = doc ? await Memory.importBackup(doc) : null;
    if (!result) {
      showToast(lt("import_bad"));
      return null;
    }
    showToast(lt("imported", { added: result.added, updated: result.updated }));
    renderMemoryFacts();
    renderMemoryBadges();
    return result;
  }

  // --- Pinned chats (Step 70) ---

  const ct = (key) => (SESSIONS.texts[lang()] || SESSIONS.texts.HEBREW)[key];
  let unpinned = (load(STORE.unpinned, []) || []).filter((x) => x && x.id && x.persona);
  const saveUnpinned = () => save(STORE.unpinned, unpinned);
  const pinnedOf = (who) => state.sessions.filter((x) => x.persona === who && x.pinnedAt);

  function forgetRemotePin(entry) {
    if (!unpinned.some((x) => x.id === entry.id)) unpinned.push({ persona: entry.persona, id: entry.id });
    saveUnpinned();
  }

  /** 📌: "pinned" | "unpinned" | "limit" (already MAX_PINNED) | "missing" (an empty chat isn't listed yet). */
  function togglePin(id) {
    const entry = sessionEntry(id);
    if (!entry) return "missing";
    let result;
    if (entry.pinnedAt) {
      if (entry.pinSynced) forgetRemotePin(entry);
      delete entry.pinnedAt;
      delete entry.pinDirty;
      delete entry.pinSynced;
      result = "unpinned";
    } else if (pinnedOf(entry.persona).length >= MAX_PINNED) {
      showToast(ct("pin_limit"));
      return "limit";
    } else {
      entry.pinnedAt = Date.now();
      entry.pinDirty = true;
      unpinned = unpinned.filter((x) => x.id !== id);
      saveUnpinned();
      result = "pinned";
    }
    saveSessions(); // (unpinned, it's an ordinary chat again: the 10-chat rule applies from the next sweep)
    renderSessions();
    syncPinned(false);
    return result;
  }

  /** A pinned chat as stored in Firebase: its index fields and its messages (text only, times in ms). */
  function pinnedNode(entry) {
    const messages = (entry.id === state.sessionId ? state.messages : load(STORE.chat(entry.id), []))
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.local && m.text && m.text.trim())
      .map((m) => ({ role: m.role, text: m.text, ts: m.ts || 0 }));
    return { id: entry.id, persona: entry.persona, title: entry.title || "", created: entry.created || 0,
      updated: entry.updated || 0, pinned_at: entry.pinnedAt, device: "web",
      messages: messages.slice(-SESSIONS.max_pinned_messages) };
  }

  /** A pinned chat from Firebase in this browser's form, or null if it isn't one (Firebase may turn arrays into objects). */
  function parsePinnedNode(node, id) {
    if (!node || typeof node !== "object" || !/^[A-Za-z0-9]+$/.test(id)) return null;
    let raw = node.messages;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      raw = Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map((k) => raw[k]);
    }
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
    const messages = (Array.isArray(raw) ? raw : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ role: m.role, text: m.text, ts: num(m.ts) }));
    if (!messages.length) return null;
    return { title: typeof node.title === "string" ? node.title.slice(0, 80) : "", messages,
      created: num(node.created) || messages[0].ts, updated: num(node.updated) || messages[messages.length - 1].ts,
      pinnedAt: num(node.pinned_at) };
  }

  /**
   * Firebase's pinned chats merged into this browser: a chat that isn't here is added (pinned; its facts count as
   * already in the memory - the device that wrote it extracted them); a newer copy replaces the messages unless
   * this browser has unsent changes; a chat this browser uploaded that Firebase no longer has was unpinned on
   * another device, so it's unpinned here too (the chat stays). True if anything changed.
   */
  function mergePinned(remote) {
    const forgotten = new Set(unpinned.map((x) => x.id));
    const seen = new Set();
    let changed = false;
    for (const [who, chats] of Object.entries(remote || {})) {
      if (!["floma", "toby"].includes(who) || !chats || typeof chats !== "object") continue;
      for (const [id, node] of Object.entries(chats)) {
        const parsed = parsePinnedNode(node, id);
        if (!parsed || forgotten.has(id)) continue;
        seen.add(id);
        const newest = Math.max(0, ...parsed.messages.map((m) => m.ts));
        const entry = sessionEntry(id);
        if (!entry) {
          save(STORE.chat(id), parsed.messages);
          state.sessions.push({ id, persona: who, title: parsed.title || sessionTitle(parsed.messages), created: parsed.created,
            updated: parsed.updated, memoryTs: newest, memorized: true, pinnedAt: parsed.pinnedAt || Date.now(), pinSynced: true });
          changed = true;
          continue;
        }
        if (!entry.pinnedAt) { entry.pinnedAt = parsed.pinnedAt || Date.now(); changed = true; }
        if (!entry.pinSynced) { entry.pinSynced = true; changed = true; }
        if (parsed.updated > (entry.updated || 0) && !entry.pinDirty) {
          save(STORE.chat(id), parsed.messages);
          entry.title = parsed.title || entry.title;
          entry.updated = parsed.updated;
          entry.memoryTs = Math.max(entry.memoryTs || 0, newest);
          if (id === state.sessionId && !state.thinking) {
            state.messages = parsed.messages;
            renderChat();
          }
          changed = true;
        }
      }
    }
    for (const entry of state.sessions) {
      if (entry.pinnedAt && entry.pinSynced && !entry.pinDirty && !seen.has(entry.id)) {
        delete entry.pinnedAt;
        delete entry.pinSynced;
        changed = true;
      }
    }
    if (changed) {
      state.sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      saveSessions();
    }
    return changed;
  }

  let pinnedBusy = null;

  /**
   * Pinned chats ↔ Firebase: removals and changed chats are uploaded, and (with pull) the other devices' pinned
   * chats come in. Nothing happens before Firebase is set up. Resolves when done.
   */
  function syncPinned(pull = true) {
    if (!Memory.configured()) return Promise.resolve(false);
    if (pinnedBusy) return pinnedBusy.then(() => syncPinned(pull));
    pinnedBusy = (async () => {
      const remote = pull ? await Memory.fetchPinned() : null;
      // Merged first: what's still unsent here is protected by its dirty / unsynced state.
      const changed = remote ? mergePinned(remote) : false;
      for (const item of unpinned.slice()) {
        if (await Memory.putPinned(item.persona, item.id, null)) {
          unpinned = unpinned.filter((x) => x.id !== item.id);
          saveUnpinned();
        }
      }
      for (const entry of state.sessions.filter((x) => x.pinnedAt && (x.pinDirty || !x.pinSynced))) {
        const sentAt = entry.updated;
        if (await Memory.putPinned(entry.persona, entry.id, pinnedNode(entry))) {
          const now = sessionEntry(entry.id);
          if (now && now.pinnedAt) {
            now.pinSynced = true;
            if (now.updated === sentAt) delete now.pinDirty;
          }
        }
      }
      saveSessions();
      if (changed) renderSessions();
      return changed;
    })().finally(() => { pinnedBusy = null; });
    return pinnedBusy;
  }

  let pinnedTimer = null;

  /** After a message in a pinned chat: one upload a few seconds later (not one per message). */
  function schedulePinnedUpload() {
    if (pinnedTimer) return;
    pinnedTimer = setTimeout(() => { pinnedTimer = null; syncPinned(false); }, 4000);
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
      now.extracted = "extracted";
      now.extractedAt = Date.now();
      delete now.unsaved;
    } else if (saved !== true) {
      now.unsaved = true;
      now.extracted = "failed";
    }
    saveSessions();
    pruneSessions(now.persona);
    renderSessions();
    fillSettings();
  }

  /** At startup: every chat that isn't open (either assistant's) is memorized, then each list is trimmed. */
  async function sweepSessions() {
    if (failSafe()) { deferredBackground = true; sweepWaiting = true; return; } // Step 73: nothing pruned unmemorized
    sweepWaiting = false;
    for (const entry of state.sessions.slice().reverse()) {
      if (entry.id !== state.sessionId) await retireSession(entry.id);
    }
    for (const who of new Set(state.sessions.map((x) => x.persona))) pruneSessions(who);
    renderSessions();
  }

  function renderSessions() {
    const list = $("sessionList");
    list.replaceChildren();
    renderMemoryBadges();
    const hint = $("ephemeralHint");
    hint.hidden = false;
    hint.textContent = ct("chats_kept").replace("{name}", assistant());
    if (!mySessions().length) {
      const none = document.createElement("li");
      none.className = "hint";
      none.textContent = t("noChats");
      list.append(none);
    }
    const locale = lang() === "ENGLISH" ? "en" : "he";
    const today = new Date().toDateString();
    // Pinned chats first (newest first among them), then the rest, newest first.
    const ordered = [...mySessions().filter((x) => x.pinnedAt), ...mySessions().filter((x) => !x.pinnedAt)];
    for (const entry of ordered) {
      const item = document.createElement("li");
      item.className = `session${entry.id === state.sessionId ? " active" : ""}${entry.pinnedAt ? " pinned" : ""}`;
      item.dataset.id = entry.id;
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
      // Step 74: whether its facts are in the memory yet (✓ בזיכרון / ⏳ ממתין לסיכום / ⚠ ...).
      const status = Core.extractionStatus(entry);
      const badge = document.createElement("span");
      badge.className = `extract-badge ${status}`;
      badge.textContent = lt(`badge_${status}`);
      when.append(" · ", badge);
      open.append(title, when);
      open.addEventListener("click", () => openSession(entry.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "session-delete";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", t("deleteChat"));
      remove.title = t("deleteChat");
      remove.addEventListener("click", () => {
        if (!confirm(t("confirmDeleteChat"))) return;
        extractBeforeDelete([entry.id]); // from a copy: the facts it taught stay
        deleteSession(entry.id);
      });
      // Step 70: 📌 pins the chat (kept for good, synced to Firebase) or unpins it.
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "session-pin";
      pin.textContent = "📌";
      pin.setAttribute("aria-pressed", String(Boolean(entry.pinnedAt)));
      pin.setAttribute("aria-label", entry.pinnedAt ? ct("unpin") : ct("pin"));
      pin.title = entry.pinnedAt ? ct("unpin") : ct("pin");
      pin.addEventListener("click", () => togglePin(entry.id));
      item.append(open, pin, remove);
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

  // --- Skills (Step 60): the @ list, the skill pill, the Skills panel. Skill bubbles are local: 0 tokens. ---

  function skillText(key) {
    return Skills.text(key, lang());
  }

  function setActiveSkill(id) {
    state.activeSkill = id && Skills.byId(id) ? id : null;
    renderSkillPill();
    if ($("skillsDialog").open) fillSkillsPanel();
  }

  function renderSkillPill() {
    const skill = state.activeSkill ? Skills.byId(state.activeSkill) : null;
    $("skillRow").hidden = !skill;
    if (!skill) return;
    $("skillPillName").textContent = `${skill.icon} ${Skills.name(skill, lang())}`;
    $("skillPillClose").setAttribute("aria-label", skillText("dismiss"));
    $("skillPillClose").title = skillText("dismiss");
  }

  /** A quick-reply chip (Step 72): its text goes out as the next message, to the skill that offered it. */
  function sendChip(text, skill) {
    if (state.thinking || !text) return;
    if (skill && state.activeSkill !== skill && Skills.byId(skill)) setActiveSkill(skill);
    send(text);
  }

  function sendSkill(text, decision) {
    hideMentions();
    addMessage({ role: "user", text, local: true });
    if (decision.deactivate) {
      const line = skillText(state.activeSkill ? "deactivated" : "none_active");
      setActiveSkill(null);
      addMessage({ role: "assistant", text: line, local: true });
      return;
    }
    if (decision.activate) setActiveSkill(decision.skill);
    if (decision.activate && !decision.query && !Skills.answersOnActivate(decision.skill)) {
      addMessage({ role: "assistant", text: Skills.activatedText(decision.skill, lang()), local: true, skill: decision.skill });
    } else if (decision.skill === "translate") {
      sendTranslate(decision.query);
      return;
    } else if (decision.skill === "calc" && Skills.tutorWanted(decision.query)) {
      sendTutor(decision.query); // Step 78: beyond the local solver - the math tutor
      return;
    } else {
      const answer = Skills.answer(decision.skill, decision.query, lang());
      // @phone's links get the launcher's badge and "copy the details" button (Step 61).
      addMessage({ role: "assistant", text: answer.text, sources: answer.sources, local: true, skill: decision.skill,
        launcher: decision.skill === "phone" && answer.sources.length > 0, copyValue: answer.copy || null,
        lookupQuery: decision.skill === "phone" ? decision.query : undefined, // Step 77: for "open in the bot's browser"
        chips: answer.chips && answer.chips.length ? answer.chips : undefined }); // Step 72: @code's quick replies
      if (decision.skill === "phone" && answer.sources.length > 0) phoneViaPc(decision.query); // Step 76
    }
    setEmotion(Core.avatarFor("action_done"));
  }

  /**
   * @translate on the web (Step 63): Gemini translates with the registry's translator instruction. The bubble is the
   * translation alone, with a copy button and a small "עברית → אנגלית" line; both bubbles stay local (not in the chat's
   * history).
   */
  async function sendTranslate(query) {
    const request = Skills.translateRequest(query);
    if (!request.text) {
      addMessage({ role: "assistant", text: Skills.translateText("no_text", lang()), local: true, skill: "translate" });
      return;
    }
    if (!state.apiKey) {
      addMessage({ role: "assistant", text: Skills.translateText("no_model", lang()), local: true, skill: "translate" });
      return;
    }
    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    try {
      const text = await Core.translate(state.apiKey, request.system, request.text);
      setThinking(false);
      addMessage({ role: "assistant", text, local: true, skill: "translate", copy: true,
        caption: Skills.translateCaption(request, lang()) });
      setEmotion(Core.avatarFor("action_done"));
    } catch (e) {
      setThinking(false);
      const reason = e instanceof Core.AiError ? e.kind : "BAD_RESPONSE";
      addMessage({ role: "assistant", text: Skills.translateText("failed", lang(), undefined, { reason }), local: true, skill: "translate" });
    }
  }

  /** @calc's math tutor (Step 78): Gemini with the tutor's instruction (verification first, the matched syllabus
   * modules, the notation asked for) and this chat's last tutor exchanges. Without a key: the local solver's answer and
   * how to turn the tutor on. */
  let tutorHistory = { chat: null, turns: [] };
  async function sendTutor(query) {
    const chat = state.sessionId || null;
    if (tutorHistory.chat !== chat) tutorHistory = { chat, turns: [] }; // the tutor's context belongs to its chat
    if (!state.apiKey) {
      const local = Skills.calcAnswer(query, lang());
      addMessage({ role: "assistant", text: `${local.text}\n\n${Skills.tutorText("no_model", lang())}`, local: true, skill: "calc" });
      return;
    }
    const request = Skills.tutorRequest(query, lang(), undefined, tutorHistory.turns, assistant());
    const reasoning = Skills.reasoningConfig();
    const thinking = reasoning.thinking[(currentLoad() || 0) >= reasoning.fast_load ? "fast" : "deep"]; // Step 79
    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    try {
      const text = await Core.tutor(state.apiKey, request.system, request.text, thinking);
      setThinking(false);
      tutorHistory.turns = tutorHistory.turns.concat([{ q: query, a: text }]).slice(-Skills.tutorConfig().history_turns);
      addMessage({ role: "assistant", text, local: true, skill: "calc", tutor: true, caption: Skills.tutorCaption(request, lang()) });
      setEmotion(Core.avatarFor("action_done"));
    } catch (e) {
      setThinking(false);
      const reason = e instanceof Core.AiError ? e.kind : "BAD_RESPONSE";
      addMessage({ role: "assistant", text: Skills.tutorText("failed", lang(), undefined, { reason }), local: true, skill: "calc" });
    }
  }

  /** Step 79: the resource guard's last load (%), null before the first sample. */
  function currentLoad() {
    const last = guardMonitor && guardMonitor.last;
    return last && typeof last.load === "number" ? last.load : null;
  }

  /** Step 79: the titles of the latest other chats (newest first), for the deep tier's cross-reference. */
  function recentTopics() {
    return state.sessions.filter((s) => s.id !== state.sessionId && (!s.persona || s.persona === persona()))
      .map((s) => s.title || "").slice(0, 5);
  }

  /** Step 79: the chat bar's "📚 סיכום שיעור אקדמי": what's typed (or attached) goes out as a lesson summary now;
   * otherwise the skill turns on for this chat and says what to paste or attach. */
  function lessonChip() {
    if (state.thinking) return;
    setActiveSkill("lesson_summarizer");
    const input = $("input");
    if (input.value.trim() || state.pendingImage || state.pendingDocument) {
      const text = input.value;
      input.value = "";
      send(text);
      return;
    }
    addMessage({ role: "assistant", text: Skills.activatedText("lesson_summarizer", lang()), local: true, skill: "lesson_summarizer" });
    input.focus();
  }

  /** The "@" list: built only while the word at the caret starts with "@"; emptied and hidden otherwise. */
  function renderMentions() {
    const input = $("input");
    const token = Skills.mentionToken(input.value, input.selectionStart);
    const matches = token ? Skills.mentionMatches(token) : [];
    const pop = $("mentionPop");
    if (!matches.length) {
      hideMentions();
      return;
    }
    pop.replaceChildren();
    matches.forEach((skill, i) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "mention-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(i === 0));
      option.dataset.handle = skill.handle;
      const handle = document.createElement("strong");
      handle.textContent = skill.handle;
      option.append(`${skill.icon} `, handle, ` · ${Skills.name(skill, lang())}`);
      option.addEventListener("mousedown", (event) => event.preventDefault()); // keep the caret in the box
      option.addEventListener("click", () => completeMention(skill.handle));
      pop.append(option);
    });
    pop.hidden = false;
  }

  function hideMentions() {
    const pop = $("mentionPop");
    if (pop.hidden) return;
    pop.hidden = true;
    pop.replaceChildren();
  }

  /** Puts [handle] (or the first match) in place of the "@word" being typed; false if there's nothing to do. */
  function completeMention(handle) {
    const input = $("input");
    const caret = input.selectionStart;
    const token = Skills.mentionToken(input.value, caret);
    const matches = token ? Skills.mentionMatches(token) : [];
    if (!token || (!handle && (!matches.length || token.toLowerCase() === matches[0].handle.toLowerCase()))) {
      hideMentions();
      return false;
    }
    const chosen = handle || matches[0].handle;
    const start = caret - token.length;
    input.value = `${input.value.slice(0, start)}${chosen} ${input.value.slice(caret).replace(/^\s+/, "")}`;
    const at = start + chosen.length + 1;
    input.setSelectionRange(at, at);
    hideMentions();
    input.focus();
    autoGrow();
    return true;
  }

  function fillSkillsPanel() {
    $("skillsTitle").textContent = `🧩 ${skillText("panel_title")}`;
    $("skillsHint").textContent = skillText("panel_hint");
    const list = $("skillsList");
    list.replaceChildren();
    for (const skill of Skills.skills()) {
      const card = document.createElement("article");
      card.className = "skill-card";
      card.dataset.skill = skill.id;
      const title = document.createElement("h3");
      title.textContent = `${skill.icon} ${Skills.name(skill, lang())} `;
      const handle = document.createElement("code");
      handle.textContent = skill.handle;
      title.append(handle);
      const about = document.createElement("p");
      about.textContent = Skills.description(skill, lang());
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      if (state.activeSkill === skill.id) {
        const on = document.createElement("span");
        on.className = "skill-on";
        on.textContent = `✓ ${skillText("active")}`;
        buttons.append(on);
      } else {
        const use = document.createElement("button");
        use.type = "button";
        use.className = "skill-use";
        use.textContent = skillText("activate");
        use.addEventListener("click", () => useSkill(skill.id));
        buttons.append(use);
      }
      const fresh = document.createElement("button");
      fresh.type = "button";
      fresh.className = "skill-new";
      fresh.textContent = skillText("new_chat");
      fresh.addEventListener("click", () => {
        openSession(null);
        useSkill(skill.id);
      });
      buttons.append(fresh);
      card.append(title, about, buttons);
      list.append(card);
    }
  }

  function openSkills() {
    fillSkillsPanel();
    if (!$("skillsDialog").open) $("skillsDialog").showModal();
  }

  /** "Use in this chat": the pill comes on and the skill says what it does (a local bubble). */
  function useSkill(id) {
    if (state.thinking) return;
    setActiveSkill(id);
    if (Skills.answersOnActivate(id)) { // Step 72: @code opens with its language menu (chips)
      const menu = Skills.answer(id, "", lang());
      addMessage({ role: "assistant", text: menu.text, sources: [], local: true, skill: id, copyValue: menu.copy || null,
        chips: menu.chips && menu.chips.length ? menu.chips : undefined });
    } else {
      addMessage({ role: "assistant", text: Skills.activatedText(id, lang()), local: true, skill: id });
    }
    if ($("skillsDialog").open) $("skillsDialog").close();
    $("input").focus();
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
    let trimmed = image ? Core.imagePrompt(text, lang()) : text.trim();
    if (!trimmed) return;
    Voice.stopSpeaking(); // a new message interrupts Toby
    dictation.cancel(); // and late dictation results must not refill the cleared field
    if (image || doc) clearAttachment();
    let lessonTurn = false; // Step 79: a lesson summary goes straight to the chat model, like a picture
    if (!image && !doc) {
      // Skills (Step 60): an @ mention, a "switch to skill" phrase, the open chat's skill, or a question whose
      // triggers fit a skill that finds something (when automatic switching is on) - answered here, 0 tokens.
      const decision = Skills.resolve(trimmed, state.activeSkill, state.settings.autoSwitchSkills !== false);
      if (decision.skill === "lesson_summarizer" && decision.query) {
        if (decision.activate) setActiveSkill("lesson_summarizer");
        trimmed = decision.query;
        lessonTurn = true;
      } else if (decision.skill || decision.deactivate) {
        sendSkill(trimmed, decision);
        return;
      }
    }
    const direct = Boolean(image || doc || lessonTurn);
    const routed = Core.route(trimmed, state.settings);
    const seriousChange = routed.seriousChange;
    const route = direct ? { kind: "model", model: Core.MODELS.DEFAULT, webSearch: false } : routed.route;

    if (seriousChange) {
      state.settings.seriousMode = seriousChange === "ENTER";
      save(STORE.settings, state.settings);
      fillSettings();
    }

    // The legal Smart Query Launcher (launcher.js): a lookup on a restricted site gets official links, never a
    // fetch. A restricted site named outright goes first; a phone lookup goes here rather than to "only on Android".
    const lookupRoute = !direct && (route.kind === "model" || route.extension === "contacts");
    // "Can you check phone numbers?": what the app really does, answered right here (Step 58).
    const capability = lookupRoute ? Launcher.capabilityReply(trimmed, lang()) : null;
    if (capability) {
      addMessage({ role: "user", text: trimmed, local: true });
      addMessage({ role: "assistant", text: capability, local: true });
      setEmotion(Core.avatarFor("action_done"));
      return;
    }
    const launch = lookupRoute ? Launcher.plan(trimmed) : null;
    const buying = Boolean(launch && Launcher.buyKind(launch.kind));
    // With a Gemini key, an email address and a flight question are answered by Google Search first (Step 59).
    const search = launch && state.apiKey ? Launcher.searchPrompt(trimmed, launch, lang()) : null;
    if (launch && (route.kind !== "model" || Launcher.firstKind(launch.kind) || (Catalog.restrictedNamed(trimmed).length && !buying)
        || (search && Launcher.searchKind(launch.kind)))) {
      if (search) await sendSearchFirst(trimmed, launch, search);
      else sendLaunch(trimmed, launch);
      return;
    }
    // The built-in catalog (catalog.js): weather, books, anime... read straight from their open APIs (0 tokens).
    // (The user's own sites come first, as on the desktop: a browser can't read them, so that path below says so.)
    const ownSites = Sites.plan(trimmed, state.settings.querySites, Boolean(state.apiKey));
    let sources = !direct && route.kind === "model" && !ownSites.length
      ? Catalog.route(trimmed, Sites.wantsLookup(trimmed), Boolean(state.apiKey)) : [];
    if (buying && !ownSites.length) {
      // Buying a book or a product (Step 58): the real answer first, the store links after it. A book is always
      // looked up in Open Library; with a Gemini key, Google Search answers the question itself.
      if (launch.kind === "books" && !sources.some((s) => s.id === "openlibrary")) {
        sources = [Catalog.byId("openlibrary"), ...sources].slice(0, window.FLOMA_SITES.rules.max_routed);
      }
      if (state.apiKey) {
        await sendBuying(trimmed, sources, launch);
        return;
      }
    }
    if (sources.length) {
      await sendFacts(trimmed, sources, launch);
      return;
    }
    if (launch) {
      sendLaunch(trimmed, launch);
      return;
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
    if (!direct && Sites.plan(trimmed, state.settings.querySites, Boolean(state.apiKey)).length
        && !state.messages.some((m) => m.reason === "SITES_NEED_DESKTOP")) {
      // Reading the user's sites needs the desktop engine (a browser can't fetch other sites): say so once.
      addMessage({ role: "assistant", text: window.FLOMA_PLATFORM.site_query.needs_desktop[lang()], local: true,
        notice: true, reason: "SITES_NEED_DESKTOP" });
    }
    if (!state.apiKey) {
      handleFailure("MISSING_KEY", trimmed, Boolean(image), Boolean(doc));
      return;
    }

    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    // A document's text rides with its message (and with follow-ups while it's among the newest ones).
    const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.context || m.text }));
    try {
      // Step 79: the fast reflex or the deep synthesis & self-check tier (load, attachment, the chat's skill).
      const plan = Skills.reasoningPlan(trimmed, currentLoad(), Boolean(image || doc), state.activeSkill, recentTopics());
      // The shared notes come from the local copy, so a GitHub outage never delays or breaks a reply.
      const reply = await Core.complete(state.apiKey, state.settings, history, route, Memory.notes(),
        image ? { mime: image.mime, data: image.data } : null, plan);
      setThinking(false);
      const caption = Skills.reasoningCaption(plan, lang());
      addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget,
        ...(caption ? { caption } : {}) });
      setEmotion(reply.emotion);
      say(reply.text);
      updateMemory();
    } catch (e) {
      setThinking(false);
      if (!(e instanceof Core.AiError)) console.error(e); // a bug: still answered kindly below
      handleFailure(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE", trimmed, Boolean(image), Boolean(doc));
    }
  }

  /** The launcher's details (names, phone formats, search tiers) to the clipboard. */
  async function copyDetails(text) {
    await copyText(text);
    showToast(window.FLOMA_PLATFORM.site_query.copied[lang()]);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const area = document.createElement("textarea"); // older browsers / no clipboard permission
      area.value = text;
      document.body.append(area);
      area.select();
      try { document.execCommand("copy"); } catch (e2) { /* nothing more to try */ }
      area.remove();
    }
  }

  /** Official query links for a restricted site and the details to copy; both bubbles stay local (no model). */
  function sendLaunch(text, launch) {
    addMessage({ role: "user", text, local: true });
    addLaunch(launch);
  }

  function addLaunch(launch) {
    addMessage({ role: "assistant", text: launch.text(lang()), sources: launch.sources(lang()), local: true, launcher: true });
    setEmotion(Core.avatarFor("action_done"));
  }

  /**
   * A lookup Google Search answers first, with a Gemini key: an email address (its public / business mentions; then
   * Have I Been Pwned, Hunter.io, Gravatar) or a flight question (tonight's direct flights, airlines; then Google
   * Flights, Skyscanner, Kayak, the airports authority, El Al). The links follow the answer (or the error). No
   * restricted site is contacted: the links only open in the user's browser.
   */
  async function sendSearchFirst(text, launch, prompt) {
    addMessage({ role: "user", text, context: prompt });
    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    try {
      const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.context || m.text }));
      const reply = await Core.complete(state.apiKey, state.settings, history,
        { kind: "model", model: Core.MODELS.RESEARCH, webSearch: true }, Memory.notes(), null);
      addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget });
      setEmotion(reply.emotion);
      say(reply.text);
    } catch (e) {
      if (!(e instanceof Core.AiError)) console.error(e);
      handleFailure(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE", text, false, false);
    } finally {
      setThinking(false);
    }
    addLaunch(launch);
    updateMemory();
  }

  /**
   * A book or product with buying intent, with a Gemini key (Step 58): Open Library's facts (for a book) and
   * Gemini's grounded Google Search answer the question itself (does it exist, can it be bought in Israel);
   * the official store links follow the answer (or the error). Stores are never contacted.
   */
  async function sendBuying(text, sources, launch) {
    addMessage({ role: "user", text });
    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    try {
      const readable = sources.filter((s) => Catalog.deviceReadable(s));
      const results = readable.length ? await Catalog.fetchFacts(text, readable, fetchText) : [];
      const facts = results.flatMap((r) => r.lines.map((l) => `[${r.site.name}] ${l}`));
      const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.context || m.text }));
      history[history.length - 1] = { role: "user", text: Launcher.buySearchPrompt(text, launch, facts, lang()) };
      const reply = await Core.complete(state.apiKey, state.settings, history,
        { kind: "model", model: Core.MODELS.RESEARCH, webSearch: true }, Memory.notes(), null);
      addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget });
      setEmotion(reply.emotion);
      say(reply.text);
    } catch (e) {
      if (!(e instanceof Core.AiError)) console.error(e);
      handleFailure(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE", text, false, false);
    } finally {
      setThinking(false);
    }
    addLaunch(launch);
    updateMemory();
  }

  /**
   * GET [url] as text, unless it's a restricted domain (never contacted); 15 s a tier. Step 66: through the agent's
   * isolated network - the user's relay first when set, then a one-off direct request (agent.js).
   */
  async function fetchText(url) {
    const text = await window.FlomaAgent.fetchText(url);
    renderAgentStatus();
    return text;
  }

  // --- Isolated agent network (Step 66): the relay URL, its key and a status dot. ---

  function renderAgentStatus(probe) {
    const relay = window.FlomaAgent.relays()[0];
    const host = relay ? new URL(relay.url).hostname : "";
    const last = window.FlomaAgent.lastTier();
    let text = relay ? t("agentOn").replace("{host}", host) : t("agentOff");
    let dot = relay ? "set" : "off";
    if (probe === "checking") [text, dot] = [t("agentChecking"), "set"];
    else if (probe === true) [text, dot] = [t("agentUp").replace("{host}", host), "up"];
    else if (probe === false) [text, dot] = [t("agentDown"), "down"];
    if (last && probe === undefined) text += t("agentLast").replace("{tier}", last);
    $("agentStatusText").textContent = text;
    $("agentDot").dataset.state = dot;
  }

  async function testRelay() {
    const relay = window.FlomaAgent.relays()[0];
    if (!relay) return renderAgentStatus();
    renderAgentStatus("checking");
    renderAgentStatus(await window.FlomaAgent.health(relay));
  }

  /**
   * A catalog question: the open APIs are read right here (0 tokens) and their facts shown as they are.
   * News and web pages can't be read from a browser: with a Gemini key it gets the facts plus Google Search
   * (so it never says it can't check live data); without one the reply says what's needed.
   */
  async function sendFacts(text, sources, launch) {
    addMessage({ role: "user", text });
    setThinking(true);
    setEmotion(Core.avatarFor("thinking"));
    const pending = sources.filter((s) => !Catalog.deviceReadable(s));
    try {
      const results = await Catalog.fetchFacts(text, sources, fetchText);
      if (pending.length && state.apiKey) {
        const facts = results.flatMap((r) => r.lines.map((l) => `[${r.site.name}] ${l}`)).join("\n") || "(none)";
        const turn = window.FLOMA_PLATFORM.site_query.facts_template.replace("{facts}", facts).replace("{question}", text);
        const history = state.messages.filter((m) => !m.local).map((m) => ({ role: m.role, text: m.context || m.text }));
        history[history.length - 1] = { role: "user", text: turn };
        const reply = await Core.complete(state.apiKey, state.settings, history,
          { kind: "model", model: Core.MODELS.RESEARCH, webSearch: true }, Memory.notes(), null);
        addMessage({ role: "assistant", text: reply.text, sources: reply.sources, searchWidget: reply.searchWidget });
        setEmotion(reply.emotion);
        say(reply.text);
      } else {
        const reply = Catalog.localReply(results, lang(), pending);
        const links = results.filter((r) => r.lines.length).map((r) => ({ title: r.site.name, uri: r.site.url }));
        addMessage({ role: "assistant", text: reply, sources: links, facts: true });
        setEmotion(Core.avatarFor("action_done"));
        say(reply);
      }
    } catch (e) {
      if (!(e instanceof Core.AiError)) console.error(e);
      handleFailure(e instanceof Core.AiError ? e.kind : "BAD_RESPONSE", text, false, false);
    } finally {
      setThinking(false);
    }
    if (launch) addLaunch(launch);
    updateMemory();
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
    if (failSafe()) { // Step 73: silent text replies under high load (a live conversation just listens again)
      if (live) listen();
      return;
    }
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
    if (failSafe()) { deferredBackground = true; return; } // Step 73: paused under high load
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

  // --- Memory lifecycle: checkpoints, extraction before deleting, badges, toast, viewer ---

  const distilling = new Set(); // chats whose facts are being extracted right now

  /** A stored chat's messages and how many aren't in the memory yet. */
  function freshOf(id) {
    const entry = sessionEntry(id);
    const messages = id === state.sessionId ? state.messages.slice() : load(STORE.chat(id), []);
    const since = (entry && entry.memoryTs) || 0;
    const fresh = messages.filter((m) => !m.local && m.ts && m.ts > since);
    return { messages, since, fresh, newest: Math.max(since, ...fresh.map((m) => m.ts)) };
  }

  /**
   * The open chat's new facts go into the memory (and Firebase) without closing it: at start (the chat
   * left open last time), when the page is hidden, and from "Sync & extract now". Without this, a short
   * chat that was never switched away from would never reach the memory.
   */
  async function checkpoint(id = state.sessionId) {
    if (failSafe()) { deferredBackground = true; return false; } // Step 73: paused under high load
    const { messages, since, fresh, newest } = freshOf(id);
    if (fresh.length < 2 || distilling.has(id)) return false;
    distilling.add(id);
    try {
      const saved = await Memory.distill(messages, summarizer(), since);
      const entry = sessionEntry(id);
      if (saved === true && entry) {
        entry.memoryTs = Math.max(entry.memoryTs || 0, newest);
        if (newest >= Math.max(0, ...messages.filter((m) => !m.local).map((m) => m.ts || 0))) {
          entry.extracted = "extracted"; // everything in it is in the memory (✓)
          entry.extractedAt = Date.now();
        }
        saveSessions();
        renderSessions();
      }
      return saved === true;
    } finally {
      distilling.delete(id);
      renderMemoryBadges();
    }
  }

  /** Deleting chats never loses what they taught: their messages not in the memory yet are summarized first. */
  function extractBeforeDelete(ids) {
    const batch = [];
    for (const id of ids) {
      const entry = sessionEntry(id);
      if ((!entry && id !== state.sessionId) || (entry && entry.memorized) || distilling.has(id)) continue;
      batch.push(...freshOf(id).fresh);
    }
    if (batch.length < 2) return Promise.resolve(false);
    batch.sort((a, b) => a.ts - b.ts);
    return Memory.distill(batch, summarizer(), 0).then(() => renderMemoryBadges());
  }

  let memoryBusy = false;

  async function syncAndExtract() {
    if (memoryBusy) return;
    memoryBusy = true;
    renderMemoryBadges();
    try {
      await checkpoint();
      await Memory.syncNow();
      await syncPinned(); // Step 70: and the pinned chats
    } finally {
      memoryBusy = false;
      fillSettings();
    }
  }

  function memoryBadgeText() {
    if (memoryBusy) return t("memSyncing");
    const status = Memory.status();
    const fill = (text) => text.replace("{topics}", status.topics).replace("{facts}", status.facts)
      .replace("{error}", status.lastError);
    if (!status.configured) return fill(t("memBadgeOff"));
    if (status.lastError) return fill(t("memBadgeError"));
    let text = fill(t("memBadgeOn"));
    if (status.lastSync) {
      const when = new Date(status.lastSync);
      const sameDay = when.toDateString() === new Date().toDateString();
      const time = when.toLocaleString([], sameDay ? { hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      text += t("memBadgeTime").replace("{time}", time);
    }
    return text;
  }

  function renderMemoryBadges() {
    const status = Memory.status();
    for (const id of ["memBadge", "memBadgeSessions"]) {
      const badge = $(id);
      if (!badge) continue;
      badge.textContent = memoryBadgeText();
      badge.classList.toggle("on", status.configured && !status.lastError);
    }
  }

  // --- Step 73: Toby's voice & personality style (synced), and the system load meter with its fail-safe ---

  const Guard = window.FlomaResourceGuard;
  const guardMonitor = Guard.createMonitor();
  window.FlomaLoadMonitor = guardMonitor; // (read by web_client/check_web_load.js)
  let deferredBackground = false; // background work skipped by the fail-safe, run when it lets go
  const RESUME_DELAY_MS = 3500;
  let sweepWaiting = false;
  const failSafe = () => guardMonitor.active;
  const guardText = (key, values) => Guard.text(key, lang(), values);
  const presetConfig = () => window.FLOMA_PLATFORM.voice_presets;
  const presetText = (key) => (presetConfig().texts[lang()] || presetConfig().texts.HEBREW)[key];

  function fillVoicePreset() {
    const select = $("setVoicePreset");
    const chosen = Core.voicePresetOption(state.settings.voicePreset);
    select.replaceChildren(...presetConfig().options.map((o) => {
      const option = document.createElement("option");
      option.value = o.id;
      option.textContent = Core.label(o, lang());
      return option;
    }));
    select.value = chosen.id;
    $("voicePresetTitle").textContent = presetText("title");
    $("voicePresetDesc").textContent = chosen.description[lang()] || chosen.description.HEBREW;
    $("voicePresetHint").textContent = presetText("hint");
  }

  /** Chooses Toby's style: saved here at once (the next reply's prompt and voice use it), and with push, to Firebase. */
  function setVoicePreset(id, updatedAt = null, push = true) {
    const chosen = Core.voicePresetOption(id).id;
    const changed = chosen !== Core.voicePresetOption(state.settings.voicePreset).id;
    state.settings.voicePreset = chosen;
    state.settings.voicePresetTs = updatedAt === null ? Date.now() : updatedAt;
    save(STORE.settings, state.settings);
    if (changed) {
      Voice.stopSpeaking();
      markSpeaking(null);
      showToast(presetText("changed"));
    }
    if (push) {
      Memory.putNode(Core.userPath(Account.userId(), "settings", "voice_preset"),
        { value: chosen, updated_at: state.settings.voicePresetTs, device: "web" });
    }
    fillVoicePreset();
    return changed;
  }

  /** The style saved in Firebase: newer than ours wins; ours, when newer (or Firebase has none), is uploaded. */
  function adoptRemoteVoicePreset(node) {
    const local = Number(state.settings.voicePresetTs) || 0;
    const ids = presetConfig().options.map((o) => o.id);
    if (node && ids.includes(node.value)) {
      const remote = typeof node.updated_at === "number" ? node.updated_at : 0;
      if (remote > local) return setVoicePreset(node.value, remote, false);
      if (remote === local) return false;
    }
    if (local) setVoicePreset(state.settings.voicePreset, local, true);
    return false;
  }

  async function pullVoicePreset() {
    adoptRemoteVoicePreset(await Memory.fetchNode(Core.userPath(Account.userId(), "settings", "voice_preset")));
    // Step 75: the account's theme too (newer than ours wins).
    const theme = await Memory.fetchNode(Core.userPath(Account.userId(), "settings", "theme"));
    if (theme && window.FLOMA_PLATFORM.themes[theme.value] && typeof theme.updated_at === "number"
      && theme.updated_at > (Number(state.settings.themeTs) || 0) && theme.value !== state.settings.theme) {
      state.settings.theme = theme.value;
      state.settings.themeTs = theme.updated_at;
      save(STORE.settings, state.settings);
      applyTheme();
      fillThemes();
    }
  }

  // --- Step 76: the bot's site connections (kept on the PC) and lookups the PC runs for this browser ---

  const BOT = window.FLOMA_PLATFORM.bot_sessions;
  const bt = (key, values) => {
    const texts = BOT.texts[lang()] || BOT.texts.HEBREW;
    return (texts[key] || BOT.texts.HEBREW[key]).replace(/\{(\w+)\}/g, (all, k) => (values && k in values ? String(values[k]) : all));
  };
  let botSites = null; // the PC's published connections ({site_id: {label, domain, status, last_authenticated_at, searchable}})

  /** A request the PC answers (live_lookup_requests): the answered node, or null when it didn't answer in time. */
  async function askPc(kind, query, urls) {
    const uid = Account.userId();
    if (!uid || !Memory.configured()) return null;
    const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const path = Core.userPath(uid, "lookups", id);
    const request = { kind, query, status: "pending", created_at: Date.now(), device: "web" };
    if (urls) request.urls = urls;
    if (!(await Memory.putNode(path, request))) return null;
    const deadline = Date.now() + BOT.wait_ms;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, BOT.poll_ms / 2));
      const node = await Memory.fetchNode(path);
      if (node && node.status && node.status !== "pending") return node;
    }
    return null;
  }

  /** Step 77: "פתח בדפדפן המבודד של הבוט (ללא עקבות)": the official links go to the PC as open_in_bot_browser and
   * open there in a private window of the bot's profile. This browser never opens them. */
  async function openInBotBrowser(message, button) {
    const urls = (message.sources || []).map((s) => s && s.uri).filter((u) => typeof u === "string" && u.startsWith("https://"));
    if (!urls.length) return;
    if (button) button.disabled = true;
    showToast(bt("open_bot_sending"));
    const node = await askPc("open_in_bot_browser", message.lookupQuery || "", urls);
    if (button) button.disabled = false;
    showToast((node && node.result && node.result.text) || bt("pc_offline"), 5000);
  }

  async function loadBotSites() {
    const uid = Account.userId();
    botSites = uid ? (await Memory.fetchNode(Core.userPath(uid, "bot_sites"))) || {} : {};
    renderBotSites();
    return botSites;
  }

  /** After @phone's local answer: when the PC has an active connected site with a search URL, it looks the number up
   * with the bot's session and the result comes back here. */
  async function phoneViaPc(query) {
    const sites = botSites || (await loadBotSites());
    if (!Object.values(sites || {}).some((s) => s && s.status === "active" && s.searchable)) return;
    const node = await askPc("phone", query);
    const textOut = node && node.result && node.result.text;
    addMessage({ role: "assistant", text: textOut || bt("pc_offline"), local: true, skill: "phone" });
  }

  function renderBotSites() {
    const list = $("botSites");
    if (!list) return;
    $("botTitle").textContent = bt("pc_title");
    $("botHint").textContent = bt("pc_hint");
    $("botTarget").placeholder = bt("placeholder");
    $("botOpen").textContent = bt("open");
    list.replaceChildren();
    const entries = Object.entries(botSites || {});
    if (!entries.length) {
      const none = document.createElement("li");
      none.className = "hint";
      none.textContent = bt("none");
      list.append(none);
    }
    for (const [id, site] of entries) {
      const item = document.createElement("li");
      item.className = `bot-site ${site.status === "active" ? "active" : "expired"}`;
      item.dataset.id = id;
      const label = document.createElement("span");
      const when = site.last_authenticated_at ? new Date(site.last_authenticated_at).toLocaleString(lang() === "ENGLISH" ? "en" : "he") : "—";
      label.textContent = `${site.status === "active" ? "🔐" : "⚠"} ${site.label} · ${bt(site.status === "active" ? "active" : "expired")} · ${bt("last", { time: when })}`;
      const test = document.createElement("button");
      test.type = "button";
      test.textContent = bt("test");
      test.addEventListener("click", async () => {
        $("botStatus").textContent = bt("pc_waiting");
        const node = await askPc("test_site", id);
        $("botStatus").textContent = (node && node.result && node.result.text) || bt("pc_offline");
        loadBotSites();
      });
      item.append(label, test);
      list.append(item);
    }
  }

  async function openBotLogin() {
    const target = $("botTarget").value.trim();
    if (!target) return;
    $("botStatus").textContent = bt("pc_waiting");
    const node = await askPc("open_login", target);
    $("botStatus").textContent = (node && node.result && node.result.text) || bt("pc_offline");
    if (node && node.status === "done") $("botTarget").value = "";
  }

  // --- Step 75: the account in Settings ---

  function fillAccount() {
    const s = Account.session() || {};
    const at = (key, values) => Core.accountText(key, lang(), values);
    $("accountTitle").textContent = at("title");
    $("accountWho").textContent = s.user_id ? at("signed_in_as", { name: s.display_name || s.user_id }) : at("local_mode");
    $("logout").textContent = at("logout");
  }

  function logout() {
    if (!confirm(Core.accountText("logout_confirm", lang()))) return false;
    checkpoint();
    Account.signOut();
    location.reload();
    return true;
  }

  function renderLoad() {
    const snap = guardMonitor.last;
    const levelName = snap ? snap.level : "unknown";
    const badge = !snap || snap.load === null ? guardText("badge_unknown") : guardText("badge", { load: snap.load });
    for (const id of ["loadBadge", "loadBadgeSettings"]) {
      const el = $(id);
      el.textContent = `${failSafe() ? "⚠" : "⚡"} ${badge}`;
      el.dataset.level = levelName;
    }
    $("loadBadge").title = guardText("title");
    $("loadTitle").textContent = guardText("title");
    $("loadBar").value = snap && snap.load !== null ? snap.load : 0;
    $("loadBar").dataset.level = levelName;
    const sample = (snap && snap.sample) || {};
    const pct = (v) => (v === null || v === undefined ? guardText("unknown") : `${Math.round(v)}%`);
    const app = sample.appMb ? `${Math.round(sample.appMb)}MB` : guardText("unknown");
    $("loadDetail").textContent = `${guardText("cpu")}: ${pct(sample.cpu)}   ${guardText("memory")}: ${pct(sample.memory)}   ${guardText("app")}: ${app}`;
    $("loadState").textContent = failSafe() ? guardText("active") : guardText("ok");
    $("loadState").classList.toggle("error", failSafe());
    $("loadReset").textContent = guardText("reset");
    $("loadReset").disabled = !failSafe();
    $("loadHint").textContent = guardText("hint");
  }

  /** Every sample. Tripped: the voice stops first, then background work pauses. Recovered/reset: it all comes back. */
  function onLoad(snap) {
    if (snap.event === Guard.TRIPPED) {
      setLive(false);
      Voice.stopSpeaking();
      markSpeaking(null);
      showToast(guardText("tripped"), 7000);
    } else if (snap.event === Guard.RECOVERED || snap.event === Guard.RESET) {
      showToast(guardText(snap.event === Guard.RECOVERED ? "recovered" : "reset_done"));
      resumeBackground();
    }
    renderLoad();
  }

  function resetFailSafe() {
    if (!failSafe()) return false;
    guardMonitor.reset();
    return true;
  }

  /** The paused work runs a moment after the notice (so its own "saved" toast doesn't hide it). */
  function resumeBackground() {
    if (!deferredBackground) return;
    deferredBackground = false;
    setTimeout(() => {
      if (sweepWaiting) sweepSessions().then(() => checkpoint()).then(() => processQueue());
      else checkpoint().then(() => processQueue());
    }, RESUME_DELAY_MS);
  }

  let toastTimer = null;

  /** A small, quiet note above the input that goes away by itself. */
  function showToast(text, ms = 3200) {
    const toast = $("toast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  /**
   * Settings → "סיכום זיכרון" (Step 70): every fact by topic, each with ✎ edit and 🗑 delete, and a row to add a
   * personal note. Every change is saved locally at once and pushed to Firebase (Memory.setFacts).
   */
  function showSavedMemory() {
    $("memoryDialogTitle").textContent = `${lt("dashboard")} · ${ct("memory_title")}`;
    $("memoryDialogHint").textContent = ct("memory_hint");
    $("memorySearch").placeholder = lt("search");
    $("memoryExport").textContent = `⬇ ${lt("export")}`;
    $("memoryImport").textContent = `⬆ ${lt("import")}`;
    $("memoryAddText").placeholder = ct("add_placeholder");
    $("memoryAddTopic").setAttribute("aria-label", ct("add_topic"));
    $("memoryAdd").textContent = ct("add");
    const topics = $("memoryAddTopic");
    topics.replaceChildren();
    for (const category of window.FLOMA_PLATFORM.memory_categories) {
      const option = document.createElement("option");
      option.value = category.key;
      option.textContent = category.title;
      topics.append(option);
    }
    topics.value = window.FLOMA_PLATFORM.memory_sync.summary_category || "notes";
    memoryEditing = null;
    renderMemoryFacts();
    const dialog = $("memoryDialog");
    if (typeof dialog.showModal === "function") { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute("open", "");
  }

  let memoryEditing = null; // [topic, index] of the fact being edited

  function renderMemoryFacts() {
    const facts = Memory.facts();
    const pending = new Set(Memory.pendingKeys());
    const box = $("memoryFacts");
    box.replaceChildren();
    $("memoryDialogStatus").textContent = memoryBadgeText();
    // Step 74: "ריכוז מידע" - the facts count, the last Firebase sync, the queue, and the search.
    const status = Memory.status();
    const last = status.lastSync ? new Date(status.lastSync) : null;
    const two = (n) => String(n).padStart(2, "0");
    let summary = `${lt("facts_count", { count: status.facts, topics: status.topics })} · ${last
      ? lt("last_sync", { time: `${two(last.getDate())}/${two(last.getMonth() + 1)} ${two(last.getHours())}:${two(last.getMinutes())}` })
      : lt("never_synced")}`;
    if (extractionQueue.length) summary += `\n${lt("queued", { count: extractionQueue.length })}`;
    $("memoryDashboard").textContent = summary;
    const query = $("memorySearch").value.trim().toLowerCase();
    const iconButton = (text, label, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", onClick);
      return button;
    };
    for (const category of window.FLOMA_PLATFORM.memory_categories) {
      const items = facts[category.key];
      if (!items) continue;
      const matches = (fact) => !query || fact.toLowerCase().includes(query) || category.title.toLowerCase().includes(query);
      if (!items.some(matches)) continue;
      const title = document.createElement("h3");
      title.textContent = category.title + (pending.has(category.key) ? ` (${t("memNotSavedYet")})` : "");
      const list = document.createElement("ul");
      list.className = "editable";
      items.forEach((fact, index) => {
        if (!matches(fact)) return;
        const item = document.createElement("li");
        item.className = "fact";
        item.dataset.topic = category.key;
        item.dataset.index = String(index);
        if (memoryEditing && memoryEditing[0] === category.key && memoryEditing[1] === index) {
          const field = document.createElement("input");
          field.type = "text";
          field.dir = "auto";
          field.value = fact;
          const commit = () => { memoryEditing = null; editMemoryFact(category.key, index, field.value); };
          field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); memoryEditing = null; renderMemoryFacts(); }
          });
          item.append(field, iconButton("✓", ct("save"), commit),
            iconButton("✕", ct("cancel"), () => { memoryEditing = null; renderMemoryFacts(); }));
          list.append(item);
          setTimeout(() => field.focus(), 0);
          return;
        }
        const text = document.createElement("span");
        text.className = "fact-text";
        text.dir = "auto";
        text.textContent = fact; // facts are text, never HTML
        item.append(text, iconButton("✎", ct("edit"), () => { memoryEditing = [category.key, index]; renderMemoryFacts(); }),
          iconButton("🗑", ct("delete"), () => deleteMemoryFact(category.key, index)));
        list.append(item);
      });
      box.append(title, list);
    }
    if (!box.children.length) {
      const none = document.createElement("p");
      none.className = "hint";
      none.textContent = query && Object.keys(facts).length ? lt("no_results") : ct("memory_empty");
      box.append(none);
    }
  }

  async function memoryEdited(promise) {
    const ok = await promise;
    if (ok) showToast(ct("memory_saved"));
    renderMemoryFacts();
    renderMemoryBadges();
    return ok;
  }

  const editMemoryFact = (key, index, text) => memoryEdited(Memory.editFact(key, index, text));
  const deleteMemoryFact = (key, index) => memoryEdited(Memory.deleteFact(key, index));
  const addMemoryFact = (text, key) => memoryEdited(Memory.addFact(text, key));

  let summarizing = false;

  /**
   * The "סיכום שיחה" button (Step 70): the whole open chat goes through a thorough fact-extraction pass (Gemini),
   * merged into the memory and pushed to Firebase, then "✓ סיכום השיחה עודכן בזיכרון". Automatic extraction on
   * switching chats or closing the page goes on as before.
   */
  async function summarizeChat() {
    const id = state.sessionId;
    if (summarizing || state.thinking || distilling.has(id)) return null;
    const messages = state.messages.slice();
    if (messages.filter((m) => !m.local && m.ts && m.text && m.text.trim()).length < 2) {
      showToast(ct("summarize_empty"));
      return "empty";
    }
    summarizing = true;
    distilling.add(id);
    $("summarizeChat").disabled = true;
    showToast(ct("summarize_busy"));
    let result = "failed";
    try {
      result = await Memory.summarizeChat(messages, summarizer());
      const entry = sessionEntry(id);
      if (result === "done" && entry) {
        entry.memoryTs = Math.max(entry.memoryTs || 0, ...messages.map((m) => m.ts || 0));
        saveSessions();
      }
    } finally {
      summarizing = false;
      distilling.delete(id);
      $("summarizeChat").disabled = false;
      showToast(ct(result === "done" ? "summarize_done" : result === "empty" ? "summarize_empty" : "summarize_failed"));
      renderMemoryBadges();
      if ($("memoryDialog").open) renderMemoryFacts();
    }
    return result;
  }

  function renderSites() {
    const list = $("siteList");
    list.replaceChildren();
    const sites = Sites.clean(state.settings.querySites);
    if (!sites.length) {
      const none = document.createElement("li");
      none.className = "hint";
      none.textContent = t("sitesNone");
      list.append(none);
    }
    for (const site of sites) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.dir = "auto";
      label.textContent = site.name || Sites.host(site.url);
      label.title = site.url;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", t("sitesRemove"));
      remove.addEventListener("click", () => {
        state.settings.querySites = Sites.clean(state.settings.querySites).filter((x) => x.url !== site.url);
        save(STORE.settings, state.settings);
        renderSites();
      });
      item.append(label, remove);
      list.append(item);
    }
  }

  // --- The system guide (persona/system_guide.js, generated from the sites catalog) ---

  /** Inline Markdown (links, **bold**, `code`) as safe DOM nodes: text only, links only to http(s). */
  function inline(parent, text) {
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[1]) {
        const a = document.createElement("a");
        a.href = m[2];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = m[1];
        parent.append(a);
      } else if (m[3]) {
        const b = document.createElement("strong");
        b.textContent = m[3];
        parent.append(b);
      } else {
        const c = document.createElement("code");
        c.textContent = m[4];
        parent.append(c);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  /** The guide's Markdown (headings, lists, numbered steps, paragraphs) rendered into [box]. */
  function renderGuide(box, markdown) {
    box.replaceChildren();
    let list = null;
    for (const raw of markdown.split("\n")) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      const heading = line.match(/^(#{1,3}) (.*)$/);
      const bullet = line.match(/^- (.*)$/);
      const step = line.match(/^\d+\. (.*)$/);
      if (heading) {
        list = null;
        if (heading[1].length === 1) continue; // the guide's own title: the dialog shows its title already
        const h = document.createElement(`h${heading[1].length + 1}`); // under the dialog's h2 title
        inline(h, heading[2]);
        box.append(h);
      } else if (bullet || step) {
        const tag = bullet ? "UL" : "OL";
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag.toLowerCase());
          box.append(list);
        }
        const item = document.createElement("li");
        inline(item, (bullet || step)[1]);
        list.append(item);
      } else {
        list = null;
        const p = document.createElement("p");
        inline(p, line);
        box.append(p);
      }
    }
  }

  const guideText = () => (window.FLOMA_GUIDE && typeof window.FLOMA_GUIDE.markdown === "string"
    ? window.FLOMA_GUIDE.markdown.trim() : "");

  /** Loads ../persona/system_guide.js again, bypassing every cache (?t=...). Resolves when it ran or failed. */
  function reloadGuideScript() {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `../persona/system_guide.js?t=${Date.now()}`;
      script.onload = script.onerror = () => { script.remove(); resolve(); };
      document.head.append(script);
    });
  }

  /** The guide's text, or - never an empty box - a short message with a "try again" button. */
  function fillGuide() {
    const box = $("guideBody");
    box.dir = lang() === "ENGLISH" ? "auto" : "rtl";
    const text = guideText();
    if (text) {
      renderGuide(box, text);
      return true;
    }
    box.replaceChildren();
    const note = document.createElement("p");
    note.className = "guide-missing";
    note.textContent = t("guideMissing");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = t("guideRetry");
    retry.addEventListener("click", () => {
      note.textContent = t("guideLoading");
      reloadGuideScript().then(fillGuide);
    });
    box.append(note, retry);
    return false;
  }

  function showGuide() {
    if (!fillGuide()) reloadGuideScript().then(fillGuide); // a stale or failed load: one fresh try
    const dialog = $("guideDialog");
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    $("guideBody").scrollTop = 0;
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

  // --- Settings: the key & quota cards (Step 56) ---

  let elevenQuota = null; // {at, subscription, error, loading}
  let quotaTimer = null;

  // Step 57: each card shows its title and bar; the detailed lines open on a tap (Settings stays light).
  const quotaOpen = new Set(); // the cards the user opened (kept across the 30 s refresh)

  function drawCard(box, card) {
    box.hidden = !card;
    if (!card) return;
    box.replaceChildren();
    const open = quotaOpen.has(box.id);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "quota-head";
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", `${box.id}Lines`);
    const title = document.createElement("h4");
    title.textContent = card.title;
    const chevron = document.createElement("span");
    chevron.className = "quota-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    head.append(title, chevron);
    const lines = document.createElement("div");
    lines.className = "quota-lines";
    lines.id = `${box.id}Lines`;
    lines.hidden = !open;
    for (const line of card.lines) {
      const p = document.createElement("p");
      p.textContent = line;
      lines.append(p);
    }
    head.addEventListener("click", () => {
      const nowOpen = lines.hidden;
      lines.hidden = !nowOpen;
      head.setAttribute("aria-expanded", String(nowOpen));
      if (nowOpen) quotaOpen.add(box.id);
      else quotaOpen.delete(box.id);
    });
    box.append(head, lines);
    if (card.left !== null) {
      const bar = document.createElement("div");
      bar.className = "quota-bar";
      bar.setAttribute("role", "meter");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(card.left * 100)));
      const fill = document.createElement("span");
      fill.style.width = `${Math.round(card.left * 100)}%`;
      bar.append(fill);
      box.append(bar);
    }
  }

  function memoryFacts() {
    try {
      return Memory.facts ? Memory.facts() : {};
    } catch (e) {
      return {};
    }
  }

  function renderQuota() {
    const now = Date.now();
    drawCard($("geminiQuota"), state.apiKey ? Quota.geminiCard(Quota.keyAdded("gemini"), Quota.requestsUsed(now), now, lang()) : null);
    if (state.elevenKey) {
      if (!$("settings").hidden) refreshElevenQuota(); // read from ElevenLabs only when Settings is open
      const q = elevenQuota || {};
      drawCard($("elevenQuota"), Quota.elevenCard(Quota.keyAdded("elevenlabs"), q.subscription || null, now, lang(), q.error || null));
    } else {
      drawCard($("elevenQuota"), null);
    }
    const status = Memory.status();
    if (status.configured) {
      const facts = memoryFacts();
      const last = status.lastSync ? Quota.nowIso(status.lastSync) : null;
      drawCard($("firebaseQuota"), Quota.firebaseCard(Quota.keyAdded("firebase"), status.topics || 0, status.facts || 0,
        Quota.kb(facts), last, lang()));
    } else {
      drawCard($("firebaseQuota"), null);
    }
    // The countdowns tick while Settings is open.
    clearTimeout(quotaTimer);
    if (!$("settings").hidden) quotaTimer = setTimeout(renderQuota, 30000);
  }

  /** Reads the ElevenLabs subscription with the user's key (at most once a minute). */
  function refreshElevenQuota() {
    const now = Date.now();
    if (elevenQuota && (elevenQuota.loading || now - elevenQuota.at < 60000)) return;
    const key = state.elevenKey;
    elevenQuota = { at: now, loading: true, subscription: elevenQuota ? elevenQuota.subscription : null };
    Quota.fetchSubscription(key).then(
      (subscription) => { elevenQuota = { at: Date.now(), subscription, error: null }; },
      (e) => { elevenQuota = { at: Date.now(), subscription: null, error: String(e && e.message || e) }; },
    ).then(() => { if (state.elevenKey === key) renderQuota(); });
  }

  // --- Settings drawer ---

  /** Floma is the assistant by default; Toby, the jester, is an add-on switched on here. */
  function fillPersonas() {
    const on = persona() === "toby";
    $("setToby").checked = on;
    const profile = Core.profile(on ? "toby" : "floma");
    $("tobyAddonDesc").textContent = profile.description[lang()] || profile.description.HEBREW;
    $("tobyAddonArt").src = `${AVATAR_DIR}${Core.avatarImage("HAPPY", "toby")}`;
    fillPersonaToggle();
  }

  /** The top bar's quick "פלומה | טובי" switch (Floma first; the Settings switch does the same). */
  function fillPersonaToggle() {
    const toggle = $("personaToggle");
    const profiles = window.FLOMA_PERSONAS;
    const ids = ["floma", ...Object.keys(profiles).filter((id) => id !== "floma")];
    toggle.replaceChildren(...ids.map((id) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.persona = id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(id === persona()));
      button.textContent = profiles[id].switch_label[lang()] || profiles[id].switch_label.HEBREW;
      button.disabled = state.thinking && id !== persona();
      button.addEventListener("click", () => switchPersona(id));
      return button;
    }));
  }

  /** Both switches (Settings and the top bar) come here: the same chats, memory, name and art switch. */
  function switchPersona(id) {
    if (id === persona() || state.thinking) {
      fillPersonas(); // a refused switch: both switches show the assistant that stayed
      return;
    }
    const leavingChat = state.sessionId;
    Voice.stopSpeaking();
    setLive(false);
    clearAttachment();
    state.settings.assistantName = Core.nameAfterSwitch(state.settings.assistantName, persona(), id);
    state.settings.persona = id;
    save(STORE.settings, state.settings);
    showPersonaChats(); // Floma's and Toby's chats are separate lists
    setActiveSkill(null);
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
        state.settings.themeTs = Date.now();
        save(STORE.settings, state.settings);
        applyTheme();
        fillThemes();
        // Step 75: the theme follows the account to its other devices.
        Memory.putNode(Core.userPath(Account.userId(), "settings", "theme"), { value: id, updated_at: state.settings.themeTs, device: "web" });
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
    fillVoicePreset();
    fillAccount();
    renderBotSites();
    renderLoad();
    $("setWebSearch").checked = s.webSearch;
    $("setAutoSkills").checked = s.autoSwitchSkills !== false;
    const relay = window.FlomaAgent.relays()[0];
    $("relayUrl").value = relay ? relay.url : "";
    $("relayKey").placeholder = relay && relay.key ? "••••••" : "";
    renderAgentStatus();
    $("autoSkillsLabel").textContent = skillText("auto_switch");
    $("autoSkillsHint").textContent = skillText("auto_switch_hint");
    $("openSkills").setAttribute("aria-label", skillText("button"));
    $("openSkills").title = skillText("panel_title");
    $("sessionsSkills").textContent = `🧩 ${skillText("panel_title")}`;
    renderSkillPill();
    $("keyStatus").textContent = t(state.apiKey ? "keySaved" : "keyMissing");
    $("removeKey").disabled = !state.apiKey;
    $("changeKey").textContent = t(state.apiKey ? "changeKey" : "addKey");
    $("firebaseStatus").textContent = memoryStatusText();
    renderMemoryBadges();
    renderQuota();
    renderSites();
    $("firebaseSecret").placeholder = Memory.hasSecret() ? t("firebaseSecretSaved") : "";
    if (document.activeElement !== $("firebaseUrl")) $("firebaseUrl").value = s.firebaseUrl || "";
    $("firebaseRemove").disabled = !Memory.hasSecret() && !s.firebaseUrl;
    if ($("installStatus")) fillInstall();
    fillVersion();
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
    if (open) renderQuota();
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
    Quota.stamp("gemini");
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

  // --- Updates (Step 59): fresh files after a deploy, and a note when a new version was just loaded ---

  const Update = window.FlomaUpdate;
  let siteVersion = null; // persona/version.json as last read (null offline / not read yet)

  function session(name, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(name);
      sessionStorage.setItem(name, value);
    } catch (e) { /* blocked: no reload guard, decide() still never loops within one load */ }
    return null;
  }

  /** Reads version.json (never from a cache). [manual]: the Settings button, which always says what it found. */
  async function checkForUpdate(manual = false) {
    if (location.protocol === "file:") return fillVersion();
    let remote = null;
    try {
      const response = await fetch(`../persona/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (response.ok) remote = await response.json();
    } catch (e) { /* offline: the page keeps working as it is */ }
    if (remote) siteVersion = remote;
    const loaded = Update.pageBuild();
    const action = Update.decide({ loaded, remote: remote && remote.web_build, seen: load(STORE.seenBuild, null),
      reloadedFor: session(STORE.reloadedFor) });
    if (action === "reload") {
      session(STORE.reloadedFor, remote.web_build);
      location.reload();
      return;
    }
    if (loaded !== "dev") save(STORE.seenBuild, loaded);
    if (action === "toast") showToast(t("updatedTo").replace("{version}", (remote && remote.app_version) || Update.parts(loaded).app));
    else if (manual) showToast(remote ? t("upToDate") : t("updateOffline"));
    fillVersion();
  }

  function fillVersion() {
    if (!$("versionInfo")) return;
    const own = Update.parts(Update.pageBuild());
    const app = own.app || (siteVersion && siteVersion.app_version);
    const engine = own.engine || (siteVersion && siteVersion.engine_version);
    $("versionInfo").textContent = own.app || siteVersion
      ? t("versionLine").replace("{app}", app || "-").replace("{engine}", engine || "-") : t("versionDev");
  }

  // --- Wiring ---

  function init() {
    // Step 75: "כניסה / פתיחת משתמש חדש" whenever no session is active; the page starts again signed in.
    if (!Account.session()) {
      Account.showLogin(load("floma.settings", {}).language === "ENGLISH" ? "ENGLISH" : "HEBREW").then(() => location.reload());
      return;
    }
    if (Account.userId() && !state.settings.firebaseUrl && Account.deviceFirebaseUrl()) {
      state.settings.firebaseUrl = Account.deviceFirebaseUrl(); // every account in this browser uses it
      save(STORE.settings, state.settings);
    }
    Memory.setUserId(() => Account.userId());
    loadSessions();
    setupPwa();
    $("checkUpdates").addEventListener("click", () => checkForUpdate(true));
    checkForUpdate();
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
      if (!$("mentionPop").hidden && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.isComposing
          && completeMention()) {
        event.preventDefault(); // Enter / Tab while the "@" list is open picks its first skill
        return;
      }
      if (event.key === "Escape" && !$("mentionPop").hidden) {
        event.stopPropagation();
        hideMentions();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $("composer").requestSubmit();
      }
    });
    $("input").addEventListener("input", (event) => {
      if (event.inputType && !dictation.listening) Voice.stopSpeaking(); // typing interrupts Toby
      autoGrow();
      renderMentions();
    });
    $("input").addEventListener("blur", () => setTimeout(hideMentions, 150));
    $("openSkills").addEventListener("click", openSkills);
    $("sessionsSkills").addEventListener("click", () => {
      if (!DOCKED.matches) setSessions(false);
      openSkills();
    });
    $("skillPillClose").addEventListener("click", () => {
      setActiveSkill(null);
      $("input").focus();
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
    $("setVoicePreset").addEventListener("change", () => setVoicePreset($("setVoicePreset").value));
    // Step 74: the dashboard's search and backups; syncing when the page comes back to the front.
    $("memorySearch").addEventListener("input", () => renderMemoryFacts());
    $("memoryExport").addEventListener("click", exportMemoryBackup);
    $("memoryImport").addEventListener("click", () => $("memoryImportFile").click());
    $("memoryImportFile").addEventListener("change", async () => {
      const file = $("memoryImportFile").files[0];
      $("memoryImportFile").value = "";
      if (file) await importMemoryBackup(file);
    });
    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncOnFocus(); });
    $("loadReset").addEventListener("click", resetFailSafe);
    $("logout").addEventListener("click", logout);
    $("botOpen").addEventListener("click", openBotLogin);
    $("loadBadge").addEventListener("click", () => setDrawer(true));
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
    bindSetting("setAutoSkills", "autoSwitchSkills", (el) => el.checked);
    $("relaySave").addEventListener("click", () => {
      $("relayProblem").textContent = "";
      try {
        const current = window.FlomaAgent.relays()[0];
        const key = $("relayKey").value || (current ? current.key : "");
        window.FlomaAgent.setRelay($("relayUrl").value, key);
        $("relayKey").value = "";
        showToast(t("relaySaved"));
        testRelay();
      } catch (e) {
        $("relayProblem").textContent = t("relayHttps");
      }
    });
    $("relayTest").addEventListener("click", testRelay);
    $("relayRemove").addEventListener("click", () => {
      window.FlomaAgent.clearRelay();
      $("relayUrl").value = $("relayKey").value = "";
      renderAgentStatus();
    });
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
      Quota.forget("gemini");
      fillSettings();
    });
    $("clearChat").addEventListener("click", () => {
      if (!confirm(t("confirmClear"))) return;
      Voice.stopSpeaking();
      extractBeforeDelete([...state.sessions.map((x) => x.id), state.sessionId]); // the facts stay
      for (const entry of state.sessions) save(STORE.chat(entry.id), null); // both assistants' chats
      save(STORE.chat(state.sessionId), null);
      for (const entry of state.sessions) if (entry.pinSynced) forgetRemotePin(entry); // deleted pinned chats leave Firebase too
      state.sessions = [];
      saveSessions();
      openChats = {};
      showPersonaChats();
      state.messages = [];
      Memory.forgetLocal(); // the chats go; the facts stay (here and in Firebase)
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
      if (secretValue || url !== state.settings.firebaseUrl) Quota.stamp("firebase");
      if (secretValue) Memory.setSecret(secretValue);
      $("firebaseSecret").value = "";
      state.settings.firebaseUrl = url;
      save(STORE.settings, state.settings);
      fillSettings();
      Memory.syncNow().then(fillSettings).then(() => syncPinned()); // the first sync also uploads what this browser knows
    });
    $("firebaseRemove").addEventListener("click", () => {
      Memory.setSecret(null);
      delete state.settings.firebaseUrl;
      Quota.forget("firebase");
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
        Quota.stamp("elevenlabs");
        elevenQuota = null; // a new key: read its subscription again
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
      Quota.forget("elevenlabs");
      elevenQuota = null;
      delete state.settings.elevenVoiceId;
      save(STORE.settings, state.settings);
      state.cloudVoiceError = null;
      $("elevenProblem").textContent = "";
      Voice.stopSpeaking();
      fillSettings();
    });

    $("settingsHelp").addEventListener("click", showGuide); // the "?" in the Settings header
    $("sessionsGuide").addEventListener("click", showGuide);
    $("memSync").addEventListener("click", syncAndExtract);
    $("memView").addEventListener("click", showSavedMemory);
    // Step 70: "סיכום שיחה" on the top bar, and adding a note in "סיכום זיכרון".
    $("summarizeChat").addEventListener("click", summarizeChat);
    $("lessonChip").addEventListener("click", lessonChip);
    const addNote = () => {
      const text = $("memoryAddText").value;
      addMemoryFact(text, $("memoryAddTopic").value).then((ok) => { if (ok) $("memoryAddText").value = ""; });
    };
    $("memoryAdd").addEventListener("click", addNote);
    $("memoryAddText").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addNote(); } // (not the dialog's submit, which closes it)
    });
    $("siteAdd").addEventListener("click", () => {
      const url = Sites.normalize($("siteUrl").value);
      if (!url) {
        $("siteProblem").textContent = t("sitesBad");
        return;
      }
      $("siteProblem").textContent = "";
      const others = Sites.clean(state.settings.querySites).filter((x) => x.url !== url);
      state.settings.querySites = Sites.clean([...others, { url, name: $("siteName").value }]);
      save(STORE.settings, state.settings);
      $("siteUrl").value = $("siteName").value = "";
      renderSites();
    });
    Memory.onSaved(() => {
      showToast(window.FLOMA_PLATFORM.memory_sync.saved_toast[lang()]);
      renderMemoryBadges();
    });
    // The user switched away or is closing the tab: save what this chat taught so far (best effort).
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") checkpoint(); });

    $("keyForm").addEventListener("submit", submitKey);
    $("keyLater").addEventListener("click", () => $("keyDialog").close());

    // Every start loads the shared facts first (no pull interval, no old backoff), so a new chat's
    // prompt already has what the phone and the PC learned. Then the chats left last time are memorized,
    // and the chat left open is checkpointed (its facts saved without closing it).
    Memory.setDatabaseUrl(() => (Account.isLocal() ? null : state.settings.firebaseUrl)); // no account: no sync
    const imported = Account.takeImported();
    if (imported) setTimeout(() => showToast(Core.accountText("imported", lang(), imported), 6000), 1500);
    // Step 70: then the pinned chats come in from Firebase (and this browser's unsent ones go up).
    Memory.refreshOnStart().then(fillSettings).then(() => syncPinned()).then(pullVoicePreset).then(loadBotSites).then(sweepSessions).then(() => checkpoint())
      .then(() => processQueue()); // Step 74: chats queued here or on another device
    // Step 73: the load meter (every 5 s) and its fail-safe.
    guardMonitor.onSnapshot = onLoad;
    guardMonitor.start();
    renderLoad();

    // No key prompt: Gemini is optional (Settings → Model). Without it the chat answers in local mode.
    $("input").focus();
  }

  init();
})();
