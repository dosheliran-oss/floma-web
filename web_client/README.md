# Floma web app

Toby's chat in the browser: a full Floma app you can install from Chrome on a computer or a phone.
It opens in its own window and still opens without internet. It's the same Toby as on the phone
and the PC, with the same persona, look and shared memory.

## Open or install it

**https://dosheliran-oss.github.io/floma-web/** opens the published app on any device. To install it,
use **⚙ Settings → App → Install Floma**, or Chrome's install icon (on a phone: menu → *Add to home
screen* / *Install app*). It's published automatically on every push to `main` (see *Publishing*
below).

### Locally, without the published site

Chrome only installs pages served over http(s), so start the small local server:

```powershell
python web_client\serve.py          # opens http://localhost:8765/web_client/
```

Then **⚙ Settings → App → Install Floma** (or the install icon in Chrome's address bar). Floma gets
its own window, a Start-menu/desktop icon and Toby's icon. Later you can open it from that icon while
`serve.py` runs. Without the server, the installed app still opens from its offline copy, but Toby
needs the internet to answer.

- `serve.py` listens on this computer only (127.0.0.1). It serves only `web_client/`, `persona/` and
  Toby's pictures. Everything else in the repository (for example `local.properties`) answers 404.
- **On a phone**, Chrome installs only from an https address: use the published site above.
  `localhost` works only on the same computer.
- **Offline:** the service worker (`sw.js`) keeps a copy of the page, the persona and Toby's
  pictures. When offline, the chat and its history open and a notice says Toby will answer once the
  connection is back. Gemini and Firebase requests are never cached.
- **Updates:** the app always fetches fresh files when online, so a new version shows up on the
  next start.

## Quick start without installing

Double-click `index.html` (or drag it into Chrome). Everything works except installing and the
offline copy, because Chrome doesn't run service workers on `file://` pages.

No key is asked for at startup. Your own Gemini API key from
[Google AI Studio](https://aistudio.google.com/app/apikey) is optional (⚙ Settings → Model → Add key);
without it the assistant answers in local mode.

## What works here

| | Web client | Android app |
|---|---|---|
| Chat with Toby (persona, humor dial, serious mode, Hebrew/English) | ✅ | ✅ |
| Web search (Google Search grounding, sources) | ✅ | ✅ |
| PC companion, phone actions, contacts | ❌ Toby says he's in the browser and which Floma app can do it | ✅ |
| Long-term memory shared through Firebase (Settings → Shared memory) | ✅ | ✅ |
| SambaNova backup | ❌ | ✅ |
| Dictation and Toby's voice | ✅ (Web Speech API) | ✅ |
| Floating avatar over other apps | ❌ | ✅ |

## Floma and its assistants

The app opens as **Floma**, a calm, neutral assistant with a still logo. **Toby**, the jester with
animated art, is an add-on: switch him on in **⚙ Settings → Assistant → Toby (jester add-on)**. A
default name follows the switch, a name you chose stays. **Appearance** has five color themes
(Midnight, Ocean, Sunset, Forest, Jester), the same as on Android and the desktop. **Model** chooses
which Gemini model answers first: Automatic, Flash or Flash-Lite.

## Chats

Each conversation is its own chat. **✎ New chat** (top bar) starts a fresh one, and the **Chats**
list holds the earlier ones, newest first, named after their first message. On a wide screen the list
is a column beside the chat; on a phone or a narrow window it's a drawer behind the ☰ button. ✕ deletes
a chat. The page fills the whole window on a desktop monitor; long replies keep a readable line
length.

- Every chat belongs to one assistant: **Floma's and Toby's chats are separate lists**, each with its
  own open chat, and switching the assistant switches the list. When a chat ends (New chat, another
  chat or assistant, the next start), Gemini summarizes it into facts. They go into the device's notes and, when
  Firebase is connected, to the shared memory. Only each assistant's **10 most recent unpinned chats** stay on
  the device: an older chat is deleted once its facts are in the notes. If they couldn't be extracted
  yet (no key, offline), it waits, and beyond 20 chats the oldest go anyway. Up to **5 pinned
  chats** (📌) per assistant never count toward that, are never deleted automatically, and are
  stored whole in Firebase (`floma/pinned_chats/<persona>/<id>`), so every device restores them
  (Step 70). "סיכום שיחה" extracts the open chat's facts on demand, and Settings → "סיכום זיכרון"
  lets the user edit, delete or add facts (saved at once, pushed to Firebase).
- A chat whose facts couldn't be extracted yet is marked "waiting to be saved".
- Chats saved by an older version (one long chat) are moved into the list as one chat.

**When Gemini is slow or down:** if the first model times out (30 s), fails, can't be reached or is
out of quota, Floma quietly asks the other model. If no model answers (offline, Google's servers
down, the day's quota used up, a garbled or refused reply), the assistant answers in **local mode**
from this browser: the time, the date, what it remembers about you, or its earlier answer to the very
same question. Such answers are marked "⚡ Local mode"; hovering the tag shows why. No red error
bubbles. Without a key (or with one Google rejected), one calm note per chat with an **Add key**
button appears and the question is answered in local mode. No dialog pops up; the key is optional.

## Pictures

**📎** next to the text field opens the device's own picker (on a phone it also offers the camera);
you can also paste a picture into the text field. The picture shows above the text field with a ✕
to remove it before sending. Sent, it appears in your bubble right above your words (a picture alone
asks "What's in this picture?"). The browser shrinks it to 1600 px and re-encodes it as JPEG, which also
drops EXIF/GPS data, and only that copy goes to Gemini, next to your text. A small thumbnail stays in
this browser's history for the newest 30 messages. Offline, the assistant says that pictures need an
internet connection instead of guessing.

## Documents

The same **📎** also takes PDF and text files (TXT, Markdown, CSV, JSON, logs). The text is read in
this browser: text files with the browser's own `File.text()` (UTF-8, with a Windows-Hebrew fallback);
PDFs with Mozilla's **pdf.js**, since browsers don't let a page read a PDF's text. pdf.js is loaded
only the first time a PDF is attached, pinned to version 3.11.174, checked with Subresource Integrity,
and run with eval turned off (the fix for CVE-2024-4367 in that version). The file never leaves the
browser.

A chip above the text field shows the file's name, pages and length, with a ✕ to remove it. Sent,
the chip appears above your question (a document alone asks for a short summary). The model gets the
text wrapped in `<document>` tags, marked as material to read rather than instructions, followed by
your question. A long document is cut to 60,000 characters, keeping its first 48,000 and last 12,000
with a note where the middle was left out, so it never exceeds the budget or slows the chat.
Follow-up questions keep the document as context for the newest three documents. Offline, the
assistant says it needs the internet to answer about the file.

## Voice

- **Dictation:** the 🎤 button next to the text field uses the browser's speech recognition (Web Speech
  API) in the chat language. The words appear in the field and are never sent automatically, so you
  can fix them first, like on Android. While it listens, the button turns red and pulses. If the
  microphone is blocked or nothing was heard, a short line says so. In Chrome, speech is recognized
  by Google's speech service. Browsers without speech recognition (such as Firefox) don't show the
  button.
- **🔊 on every reply** reads that message aloud on demand (press again to stop).
- **Live conversation** (the waveform button next to the mic): you talk, the message goes out by
  itself, the assistant answers out loud and listens again right away. Two silent rounds, an error or
  the button/Esc end it. It needs both speech recognition and a voice (Chrome, Edge).
- **Voice settings:** speaking speed and pitch, with a test button.
- **Toby's voice:** **⚙ Settings → Toby reads his replies aloud** (off by default on the web) reads
  each reply with the browser's or the system's voice in the chat language. Links are skipped, and
  long replies are split so Chrome doesn't cut them off. He stops at once when you type, press the
  mic, send a message, press Esc or turn the setting off. If the system has no voice for the
  language, the setting says so.
- **ElevenLabs voice (optional):** ⚙ Settings → Voice → ElevenLabs API key and Voice ID. Replies (the
  🔊 button, live conversation, automatic reading) are then fetched from ElevenLabs as MP3 and played;
  if that fails (offline, quota, rejected key, autoplay blocked) the browser's voice reads the reply
  instead, and Settings shows why. The key is stored only in this browser's `localStorage`,
  unencrypted, and sent only to `api.elevenlabs.io`.

## When the browser can't do it

The browser keeps web pages in a sandbox, so Toby can't split the screen, open folders, turn on the
flashlight, set alarms or read contacts from here. Requests like these never reach Gemini. Toby
answers right away with a friendly line from the persona file (`platforms.web.unavailable`). He says
he's running in the browser and names the Floma app that can do it, and his face shows the
"unavailable" pose. The prompt also tells Gemini he's in a browser sandbox, so for anything else of
that kind he says which app can do it and helps in conversation instead (plans it, drafts it,
remembers it).

## Look and feel

The palette, Toby's emotions (art and motion), the waiting lines and the error lines all come from the
shared persona file, so the page matches the Android and desktop apps. New messages rise and fade in,
the chat scrolls smoothly, and while Gemini works a "Toby is typing" bubble shows three bouncing dots.
After 2.5 s a quiet line says he's still thinking, and after 12 s that Gemini is slow. Requests stop
after 60 s. A failed request never shows a raw or red error: the assistant answers in local mode
(see above). With the system's *reduce motion* setting on, nothing animates. On phones the layout keeps clear of
the notch and the home bar, and the settings panel takes the full width.

## The API key

- It is stored only in this browser's `localStorage`. It is never written into `index.html`
  or any file in the repository, and it is sent only to Google, in the `x-goog-api-key` header.
- `localStorage` is not encrypted. On a shared computer, use **Settings → Remove key** when you're done.
- The key is checked with Google before it is saved (listing one model, no tokens used).

## Keeping it in sync with Android

Nothing is copied: the page loads the shared [`persona/floma_platform.js`](../persona/floma_platform.js) and
[`persona/personas.js`](../persona/personas.js),
and `node persona-tests/check_web.js` proves the prompt is identical to Android's and the desktop's
(see [persona-tests/](../persona-tests/README.md)). `memory.js` syncs the same Firebase memory as
the other apps (Settings → Shared memory, next to the Gemini key). The database secret stays in this
browser's `localStorage`, unencrypted (so on a shared computer, disconnect it when you're done), and
is sent only to a `…firebaseio.com` / `…firebasedatabase.app` URL.

The rest of `core.js` is a port of the Android chat core:

| Android | Web |
|---|---|
| `routing/MessageRouter.kt` | `FlomaCore.route`, `modelFor` |
| `data/ai/SeriousModeCommand.kt` | `FlomaCore.detectSeriousMode` |
| `data/ai/GeminiModels.kt` | `FlomaCore.MODELS` |
| `data/ai/AIService.kt` | `FlomaCore.complete`, `summarizeMemory`, `verifyKey` |
| `data/sync/RemoteMemory.kt` | `memory.js` (`FlomaMemory`) |

The scripts are classic `<script>` files, not ES modules, because Chrome blocks modules on
`file://` pages. Toby's pictures are loaded from `app/src/main/res/drawable-nodpi`, so open the
page from inside the repository.

## Publishing

`.github/workflows/web-pages.yml` runs on every push to `main`:
1. It runs the web checks below.
2. It assembles only `web_client/` (without `serve.py` and the tests), the two persona files and
   the assistants' pictures, and refuses to publish if anything looks like a key.
3. It pushes them to the public repository
   [dosheliran-oss/floma-web](https://github.com/dosheliran-oss/floma-web), which GitHub Pages serves.

Vidget_Bot itself stays private, since the free plan doesn't serve Pages from a private repository.
The workflow writes with a deploy key that can only write to `floma-web` (secret
`FLOMA_WEB_DEPLOY_KEY`). The pages hold no keys: each user enters their own Gemini key, and it stays
in their browser.

## Checks

```powershell
node web_client\check_pwa.js                         # manifest, icons, service worker, page wiring
node web_client\check_voice.js                       # dictation, read-aloud, interruptions, ElevenLabs + fallback (fakes)
node web_client\check_web_sessions.js              # Step 70: 10-chat retention, 5 synced pinned chats, Memory Summary edits, chat summarize
node web_client\check_web_code_vault.js            # Step 72: @code - languages → titles → code with copy, chips
node web_client\check_web_bot_sessions.js          # Step 76: the PC's bot connections, open-login / test via the PC, @phone results from the PC
node web_client\check_web_accounts.js              # Step 75: sign-in screen, registration rules, PBKDF2 records, legacy import, isolation, sign-out
node web_client\check_web_memory_hub.js            # Step 74: status badges, lossless queue via Firebase, dashboard, search, backup/restore, focus sync
node web_client\check_web_load.js                  # Step 73: load meter, fail-safe (voice off at 85% for 10 s), Vax voice style + Firebase sync
python -m unittest web_client\test_serve.py          # serve.py only serves the web app's folders
```

Both also run as part of the desktop app's Python tests.
