/*
 * Floma web client - the key & quota cards in Settings (Step 56): a port of pc_companion/quota.py, pinned by
 * the shared "quota" cases (persona-tests/persona_cases.json).
 *
 *  - Gemini: when the key was added, requests sent today from this browser against the estimated daily limit
 *    (persona/floma_platform.js "quota"), and a countdown to the reset at midnight Pacific time.
 *  - ElevenLabs: the user's own subscription (characters used / limit, reset countdown).
 *  - Firebase: when it was connected, topics, facts, their estimated size, last sync.
 */
(function () {
  "use strict";

  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const Q = () => window.FLOMA_PLATFORM.quota;

  // --- Time: the Pacific day ---

  function nthSundayUtc(year, month, n, hourUtc) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (7 - first.getUTCDay()) % 7; // Sunday = 0
    return Date.UTC(year, month - 1, 1 + offset + 7 * (n - 1), hourUtc);
  }

  function pacificOffsetMs(utcMs) {
    const year = new Date(utcMs).getUTCFullYear();
    const start = nthSundayUtc(year, 3, 2, 10);
    const end = nthSundayUtc(year, 11, 1, 9);
    return start <= utcMs && utcMs < end ? -7 * HOUR_MS : -8 * HOUR_MS;
  }

  function geminiDay(utcMs) {
    return new Date(utcMs + pacificOffsetMs(utcMs)).toISOString().slice(0, 10);
  }

  function nextGeminiReset(utcMs) {
    const local = utcMs + pacificOffsetMs(utcMs);
    const midnight = (Math.floor(local / DAY_MS) + 1) * DAY_MS;
    const reset = midnight - pacificOffsetMs(utcMs);
    return midnight - pacificOffsetMs(reset);
  }

  // --- Text ---

  const texts = (language) => Q().texts[language === "ENGLISH" ? "ENGLISH" : "HEBREW"];

  function unit(t, name, n) {
    const forms = t.units[name];
    return n === 1 ? forms.one : n === 2 ? forms.two : forms.many.replace("{n}", String(n));
  }

  function countdown(seconds, language) {
    const t = texts(language);
    const total = Math.max(0, Math.trunc(seconds));
    if (total < 60) return t.under_minute;
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const parts = [];
    if (days) parts.push(unit(t, "day", days));
    if (days || hours) parts.push(unit(t, "hour", hours));
    parts.push(unit(t, "minute", minutes));
    return parts.join(t.join);
  }

  const pad = (n) => String(n).padStart(2, "0");

  /** An ISO time as the user saw it ("20/11/2026 11:30", in its own UTC offset); "" for none. */
  function stampText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(String(iso || ""));
    if (!m) return "";
    return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  }

  /** Now (or [utcMs]) in this device's time zone: 2026-11-20T11:30:00+02:00. */
  function nowIso(utcMs = Date.now()) {
    const d = new Date(utcMs);
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:` +
      `${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  const grouped = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  function percentLeft(used, limit) {
    if (limit <= 0) return 0;
    return Math.max(0, Math.min(100, Math.floor((100 * (limit - used)) / limit + 0.5)));
  }

  const utf8 = (text) => new TextEncoder().encode(text || "").length;

  /** The memory's estimated size in KB, one decimal (UTF-8 bytes of the topics and their facts). */
  function kb(factsByTopic) {
    let size = 0;
    for (const [topic, facts] of Object.entries(factsByTopic || {})) {
      size += utf8(topic);
      for (const fact of facts || []) size += utf8(fact);
    }
    const tenths = Math.floor((size / 1024) * 10 + 0.5);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }

  // --- The cards ---

  const added = (t, iso) => (stampText(iso) ? t.added.replace("{time}", stampText(iso)) : t.added_unknown);

  function geminiCard(addedIso, used, nowMs, language, limit = null) {
    const t = texts(language);
    const max = limit || Q().gemini_daily_requests;
    const left = percentLeft(used, max);
    return { title: t.gemini_title, left: left / 100, lines: [
      added(t, addedIso),
      t.gemini_used.replace("{used}", grouped(used)).replace("{limit}", grouped(max)),
      t.remaining.replace("{percent}", String(left)),
      t.reset_in.replace("{countdown}", countdown((nextGeminiReset(nowMs) - nowMs) / 1000, language)),
    ] };
  }

  function elevenCard(addedIso, subscription, nowMs, language, error = null) {
    const t = texts(language);
    const lines = [added(t, addedIso)];
    if (!subscription || !Object.keys(subscription).length) {
      lines.push(error ? t.eleven_error.replace("{error}", error) : t.eleven_loading);
      return { title: t.eleven_title, lines, left: null };
    }
    const used = Math.trunc(Number(subscription.character_count) || 0);
    const limit = Math.trunc(Number(subscription.character_limit) || 0);
    const left = percentLeft(used, limit);
    lines.push(t.eleven_used.replace("{used}", grouped(used)).replace("{limit}", grouped(limit)),
      t.remaining.replace("{percent}", String(left)));
    const reset = subscription.next_character_count_reset_unix;
    if (reset) lines.push(t.reset_in.replace("{countdown}", countdown(Math.trunc(reset) - nowMs / 1000, language)));
    return { title: t.eleven_title, lines, left: left / 100 };
  }

  function firebaseCard(addedIso, topics, facts, sizeKb, lastSync, language) {
    const t = texts(language);
    return { title: t.firebase_title, left: null, lines: [
      added(t, addedIso),
      t.firebase_stats.replace("{topics}", String(topics)).replace("{facts}", String(facts)).replace("{kb}", sizeKb),
      stampText(lastSync) ? t.last_sync.replace("{time}", stampText(lastSync)) : t.never_synced,
    ] };
  }

  // --- This browser's stores ---

  const KEY_ADDED = "floma.keyAdded";
  const REQUESTS = "floma.geminiRequests";

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === "object" ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* private window: the card shows "unknown" */ }
  }

  const keyAdded = (service) => read(KEY_ADDED, {})[service] || null;

  function stamp(service, utcMs = Date.now()) {
    write(KEY_ADDED, { ...read(KEY_ADDED, {}), [service]: nowIso(utcMs) });
  }

  function forget(service) {
    const all = read(KEY_ADDED, {});
    delete all[service];
    write(KEY_ADDED, all);
  }

  function requestsUsed(nowMs = Date.now()) {
    const data = read(REQUESTS, {});
    return data.day === geminiDay(nowMs) ? Math.trunc(Number(data.count) || 0) : 0;
  }

  function recordRequest(nowMs = Date.now()) {
    write(REQUESTS, { day: geminiDay(nowMs), count: requestsUsed(nowMs) + 1 });
  }

  /** The user's ElevenLabs subscription, read with their own key. Throws with a short reason. */
  async function fetchSubscription(key) {
    let response;
    try {
      response = await fetch(Q().eleven_subscription_url, { headers: { "xi-api-key": key } });
    } catch (e) {
      throw new Error("network");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") throw new Error("bad answer");
    return data;
  }

  window.FlomaQuota = {
    pacificOffsetMs, geminiDay, nextGeminiReset, countdown, stampText, nowIso, grouped, percentLeft, kb,
    geminiCard, elevenCard, firebaseCard, keyAdded, stamp, forget, requestsUsed, recordRequest, fetchSubscription,
  };
})();
