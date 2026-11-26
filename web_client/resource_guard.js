/*
 * Floma web client - the system load meter and its fail-safe (Step 73).
 *
 * The same rules as pc_companion/resource_guard.py and Android's ResourceGuard.kt (persona/floma_platform.js
 * "resource_guard"; persona-tests/check_web.js checks this file against the shared cases):
 *   - every poll_ms (5 s): one load from CPU and memory use, round(cpu * cpu_weight + memory * memory_weight),
 *     or the one that is known; green below warn (70), orange to high - 1, red from high (85);
 *   - 85%+ for sustain_ms (10 s) trips the fail-safe ("tripped"): the voice goes quiet first, then background
 *     work (automatic chat summaries) pauses; below recover (65) it lets go ("recovered"); reset() by hand.
 *
 * A browser can't see the whole machine, so the sampler measures this page: "CPU" is how busy the page's main
 * thread was (long tasks, where the browser reports them), "memory" is the JS heap against its limit (Chromium's
 * performance.memory). Where neither is available the meter shows "—" and never trips.
 */
(function () {
  "use strict";

  const TRIPPED = "tripped";
  const RECOVERED = "recovered";
  const RESET = "reset";

  const config = () => window.FLOMA_PLATFORM.resource_guard;

  function percent(value) {
    if (value === null || value === undefined || typeof value === "boolean") return null;
    const number = Number(value);
    if (Number.isNaN(number)) return null;
    return Math.max(0, Math.min(100, number));
  }

  /** One load (0-100), weighted; the known one alone; null when neither is known. */
  function combine(cpu, memory, cfg = config()) {
    const c = percent(cpu);
    const m = percent(memory);
    if (c === null && m === null) return null;
    const value = c === null ? m : m === null ? c : c * cfg.weights.cpu + m * cfg.weights.memory;
    return Math.min(100, Math.max(0, Math.floor(value + 0.5))); // round half up, like Python / Kotlin
  }

  /** "ok" (green), "warn" (orange), "high" (red), or "unknown". */
  function level(load, cfg = config()) {
    if (load === null || load === undefined) return "unknown";
    if (load >= cfg.high) return "high";
    if (load >= cfg.warn) return "warn";
    return "ok";
  }

  function text(key, language, values = {}) {
    const texts = config().texts;
    const line = (texts[language] || texts.HEBREW)[key] || texts.HEBREW[key];
    return line.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all));
  }

  /** The fail-safe's state: update(load, nowMs) → "tripped" | "recovered" | null. */
  function createGuard(cfg = config()) {
    const guard = {
      active: false,
      highSince: null,
      load: null,
      get voiceAllowed() { return !guard.active; },
      get backgroundAllowed() { return !guard.active; },
      update(load, nowMs) {
        guard.load = load;
        if (!guard.active) {
          if (load !== null && load !== undefined && load >= cfg.high) {
            if (guard.highSince === null) guard.highSince = nowMs;
            if (nowMs - guard.highSince >= cfg.sustain_ms) {
              guard.active = true;
              return TRIPPED;
            }
          } else {
            guard.highSince = null;
          }
          return null;
        }
        if (load !== null && load !== undefined && load < cfg.recover) {
          guard.active = false;
          guard.highSince = null;
          return RECOVERED;
        }
        return null;
      },
      /** Back to normal now (it trips again only after another sustain_ms); true when it was active. */
      reset() {
        const was = guard.active;
        guard.active = false;
        guard.highSince = null;
        return was;
      },
    };
    return guard;
  }

  /** This page's readings: { cpu, memory, appMb, source } (null where the browser doesn't tell). */
  function createSampler(win = window) {
    let busy = 0;
    let since = (win.performance && win.performance.now()) || Date.now();
    let longTasks = false;
    try {
      if (win.PerformanceObserver && (win.PerformanceObserver.supportedEntryTypes || []).includes("longtask")) {
        new win.PerformanceObserver((list) => {
          for (const entry of list.getEntries()) busy += entry.duration;
        }).observe({ type: "longtask", buffered: false });
        longTasks = true;
      }
    } catch (e) { longTasks = false; }
    return {
      sample() {
        try {
          const now = (win.performance && win.performance.now()) || Date.now();
          const span = Math.max(1, now - since);
          const cpu = longTasks ? Math.min(100, (busy / span) * 100) : null;
          busy = 0;
          since = now;
          const heap = win.performance && win.performance.memory;
          const memory = heap && heap.jsHeapSizeLimit ? (heap.usedJSHeapSize / heap.jsHeapSizeLimit) * 100 : null;
          const appMb = heap && heap.usedJSHeapSize ? heap.usedJSHeapSize / (1024 * 1024) : null;
          return { cpu, memory, appMb, source: cpu === null && memory === null ? "none" : "browser" };
        } catch (e) {
          return { cpu: null, memory: null, appMb: null, source: "none" };
        }
      },
    };
  }

  /** Polls every poll_ms and calls onSnapshot({load, level, active, sample, event}). */
  function createMonitor({ onSnapshot = () => {}, sampler = null, now = () => Date.now(), cfg = config() } = {}) {
    const guard = createGuard(cfg);
    let timer = null;
    const monitor = {
      guard,
      last: null,
      onSnapshot,
      sampler: sampler || createSampler(), // (replaceable: web_client/check_web_load.js feeds its own readings)
      now,
      get active() { return guard.active; },
      emit(snap) {
        monitor.last = snap;
        try { monitor.onSnapshot(snap); } catch (e) { console.warn("Load meter callback failed", e); }
        return snap;
      },
      poll() {
        const sample = monitor.sampler.sample();
        const load = combine(sample.cpu, sample.memory, cfg);
        const event = guard.update(load, monitor.now());
        return monitor.emit({ load, level: level(load, cfg), active: guard.active, sample, event });
      },
      reset() {
        const was = guard.reset();
        const last = monitor.last || { load: null, level: "unknown", sample: { cpu: null, memory: null, appMb: null } };
        return monitor.emit({ ...last, active: false, event: was ? RESET : null });
      },
      start() {
        if (timer === null) timer = setInterval(monitor.poll, cfg.poll_ms);
        return monitor;
      },
      stop() {
        if (timer !== null) clearInterval(timer);
        timer = null;
      },
    };
    return monitor;
  }

  window.FlomaResourceGuard = { TRIPPED, RECOVERED, RESET, combine, level, text, createGuard, createSampler, createMonitor };
})();
