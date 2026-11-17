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
  connection is back. Gemini and GitHub requests are never cached.
- **Updates:** the app always fetches fresh files when online, so a new version shows up on the
  next start.

## Quick start without installing

Double-click `index.html` (or drag it into Chrome). Everything works except installing and the
offline copy, because Chrome doesn't run service workers on `file://` pages.

On the first launch it asks for your own Gemini API key from
[Google AI Studio](https://aistudio.google.com/app/apikey).

## What works here

| | Web client | Android app |
|---|---|---|
| Chat with Toby (persona, humor dial, serious mode, Hebrew/English) | ✅ | ✅ |
| Web search (Google Search grounding, sources) | ✅ | ✅ |
| PC companion, phone actions, contacts | ❌ Toby says he's in the browser and which Floma app can do it | ✅ |
| Long-term memory shared through GitHub (Settings → Shared memory) | ✅ | ✅ |
| SambaNova backup | ❌ | ✅ |
| Dictation and Toby's voice | ✅ (Web Speech API) | ✅ |
| Floating avatar over other apps | ❌ | ✅ |

## Voice

- **Dictation:** the 🎤 button next to the text field uses the browser's speech recognition (Web Speech
  API) in the chat language. The words appear in the field and are never sent automatically, so you
  can fix them first, like on Android. While it listens, the button turns red and pulses. If the
  microphone is blocked or nothing was heard, a short line says so. In Chrome, speech is recognized
  by Google's speech service. Browsers without speech recognition (such as Firefox) don't show the
  button.
- **Toby's voice:** **⚙ Settings → Toby reads his replies aloud** (off by default on the web) reads
  each reply with the browser's or the system's voice in the chat language. Links are skipped, and
  long replies are split so Chrome doesn't cut them off. He stops at once when you type, press the
  mic, send a message, press Esc or turn the setting off. If the system has no voice for the
  language, the setting says so.

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
after 60 s. A failed request is explained by Toby in his own words, with a matching expression.
For example, he says when today's quota is used up, which is different from "slow down for a minute".
With the system's *reduce motion* setting on, nothing animates. On phones the layout keeps clear of
the notch and the home bar, and the settings panel takes the full width.

## The API key

- It is stored only in this browser's `localStorage`. It is never written into `index.html`
  or any file in the repository, and it is sent only to Google, in the `x-goog-api-key` header.
- `localStorage` is not encrypted. On a shared computer, use **Settings → Remove key** when you're done.
- The key is checked with Google before it is saved (listing one model, no tokens used).

## Keeping it in sync with Android

Toby's persona is not copied: the page loads the shared [`persona/toby_persona.js`](../persona/toby_persona.js),
and `node persona-tests/check_web.js` proves the prompt is identical to Android's and the desktop's
(see [persona-tests/](../persona-tests/README.md)). `memory.js` syncs the same GitHub memory
repository as the other apps; its GitHub token stays in this browser's `localStorage`.

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
2. It assembles only `web_client/` (without `serve.py` and the tests), `persona/toby_persona.js` and
   Toby's pictures, and refuses to publish if anything looks like a key.
3. It pushes them to the public repository
   [dosheliran-oss/floma-web](https://github.com/dosheliran-oss/floma-web), which GitHub Pages serves.

Vidget_Bot itself stays private, since the free plan doesn't serve Pages from a private repository.
The workflow writes with a deploy key that can only write to `floma-web` (secret
`FLOMA_WEB_DEPLOY_KEY`). The pages hold no keys: each user enters their own Gemini key, and it stays
in their browser.

## Checks

```powershell
node web_client\check_pwa.js                         # manifest, icons, service worker, page wiring
node web_client\check_voice.js                       # dictation, read-aloud, interruptions (fake speech APIs)
python -m unittest web_client\test_serve.py          # serve.py only serves the web app's folders
```

Both also run as part of the desktop app's Python tests.
