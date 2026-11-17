/*
 * Floma web app - voice: dictation (Web Speech API SpeechRecognition) and Toby reading his replies
 * aloud (speechSynthesis). The web counterpart of Android's SpeechInput.kt and TobySpeaker.kt.
 *
 * Dictation fills the text field and is never sent automatically, so it can be corrected first
 * (like Android). In Chrome the audio is recognized by Google's speech service; nothing is stored.
 * No UI code here: app.js owns the buttons and texts.
 */
(function () {
  "use strict";

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const synth = window.speechSynthesis || null;

  /** BCP-47 tag for the chat language ("HEBREW" | "ENGLISH"). */
  function languageTag(language) {
    return language === "ENGLISH" ? "en-US" : "he-IL";
  }

  /** Recognition error code -> the app's message key (null = nothing to show, e.g. user cancelled). */
  function dictationError(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed": return "voicePermission";
      case "no-speech":
      case "no-match": return "voiceNoMatch";
      case "network": return "voiceNetwork";
      case "audio-capture": return "voiceNoMic";
      case "language-not-supported": return "voiceUnavailable";
      case "aborted": return null;
      default: return "voiceGeneric";
    }
  }

  /**
   * One dictation session at a time.
   * onText(transcript, isFinal) gets the words heard so far; onState(listening); onError(messageKey).
   */
  function createDictation({ onText, onState, onError }) {
    let recognition = null;

    function start(language) {
      if (!Recognition || recognition) return false;
      recognition = new Recognition();
      recognition.lang = languageTag(language);
      recognition.interimResults = true;
      recognition.continuous = false; // stops after a pause, like Android's recognizer
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        let text = "";
        let final = true;
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
          if (!event.results[i].isFinal) final = false;
        }
        onText(text.trim(), final);
      };
      recognition.onerror = (event) => {
        const key = dictationError(event.error);
        if (key) onError(key);
      };
      recognition.onend = () => {
        recognition = null;
        onState(false);
      };
      try {
        recognition.start();
      } catch (e) {
        recognition = null;
        onError("voiceGeneric");
        return false;
      }
      onState(true);
      return true;
    }

    /** Stop listening and keep what was heard. */
    function stop() { if (recognition) recognition.stop(); }

    /** Stop and drop late results (used when the message is sent mid-dictation). */
    function cancel() {
      if (!recognition) return;
      recognition.onresult = null;
      recognition.abort();
    }

    return { start, stop, cancel, get listening() { return recognition !== null; } };
  }

  // --- Toby's voice ---

  /** Splits text into sentence-sized pieces: Chrome cuts off utterances longer than ~15 seconds. */
  function chunks(text, max = 180) {
    const sentences = text.replace(/https?:\/\/\S+/g, "").match(/[^.!?…\n]+[.!?…]*\s*/g) || [];
    const out = [];
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;
      const last = out[out.length - 1];
      if (last && last.length + s.length + 1 <= max) out[out.length - 1] = `${last} ${s}`;
      else if (s.length <= max) out.push(s);
      else for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
    }
    return out;
  }

  function pickVoice(tag) {
    if (!synth) return null;
    const lang = tag.slice(0, 2);
    const voices = synth.getVoices().filter((v) => {
      const l = v.lang.toLowerCase();
      return l.startsWith(lang) || (lang === "he" && l.startsWith("iw"));
    });
    return voices.find((v) => v.lang.replace("_", "-") === tag && v.localService)
      || voices.find((v) => v.lang.replace("_", "-") === tag) || voices[0] || null;
  }

  // Voices load asynchronously in Chrome; asking once early makes the first reply use the right one.
  if (synth) {
    synth.getVoices();
    if ("onvoiceschanged" in synth) synth.onvoiceschanged = () => synth.getVoices();
  }

  /**
   * Reads [text] aloud in the chat language; anything Toby was still saying is cut off first.
   * Never throws: a speech problem must never turn a good reply into an error.
   */
  // Each speak() gets a number; stopping or a newer speak() makes older callbacks stale, so an
  // interrupted reply never triggers its onDone (live conversation must not reopen the mic then).
  let speechToken = 0;
  let speakingText = "";

  function speak(text, language, { rate = 1, pitch = 1, onDone = null } = {}) {
    if (!synth || !text) return false;
    try {
      stopSpeaking();
      const token = ++speechToken;
      speakingText = text;
      const tag = languageTag(language);
      const voice = pickVoice(tag);
      const pieces = chunks(text);
      pieces.forEach((piece, i) => {
        const utterance = new SpeechSynthesisUtterance(piece);
        utterance.lang = tag;
        try {
          if (voice) utterance.voice = voice;
        } catch (e) { /* the browser's default voice for the language */ }
        utterance.rate = rate;
        utterance.pitch = pitch;
        if (i === pieces.length - 1) {
          utterance.onend = () => {
            if (token !== speechToken) return;
            speakingText = "";
            if (onDone) onDone();
          };
        }
        synth.speak(utterance);
      });
      if (!pieces.length && onDone) onDone();
      return true;
    } catch (e) {
      console.warn("Read-aloud failed", e);
      return false;
    }
  }

  function stopSpeaking() {
    speechToken++;
    speakingText = "";
    try {
      if (synth && (synth.speaking || synth.pending)) synth.cancel();
    } catch (e) { /* nothing to stop */ }
  }

  window.FlomaVoice = {
    dictationSupported: Boolean(Recognition),
    speechSupported: Boolean(synth),
    hasVoiceFor: (language) => Boolean(pickVoice(languageTag(language))),
    languageTag, dictationError, createDictation, chunks, speak, stopSpeaking,
    get speaking() { return Boolean(synth && (synth.speaking || synth.pending)); },
    /** The text being read aloud right now ("" when silent): the speaker button toggles it. */
    get speakingText() { return speakingText; },
  };
})();
