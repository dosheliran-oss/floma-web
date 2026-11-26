/*
 * Floma web app - service worker. Makes the chat installable and lets it open offline.
 *
 * Strategy: network first for the app's own files (so an update shows up on the next load),
 * falling back to the cached copy when offline. Requests to other origins (Gemini, Firebase, ElevenLabs, Google
 * Search widgets) are never intercepted or cached: the API key and chat traffic stay out of the
 * cache, and offline Toby answers with his own NETWORK line instead.
 *
 * The persona files are imported so the list of avatar pictures comes from the same profiles as the page.
 */
"use strict";

self.window = self; // the persona files assign window.FLOMA_PLATFORM / FLOMA_PERSONAS
importScripts("../persona/floma_platform.js", "../persona/personas.js");

const CACHE = "floma-web-v11";
const AVATAR_DIR = "../app/src/main/res/drawable-nodpi/";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "core.js",
  "memory.js",
  "sites.js",
  "catalog.js",
  "launcher.js",
  "agent.js",
  "quota.js",
  "../persona/sites_catalog.js",
  "../persona/skills_registry.js",
  "../persona/knowledge_vault.js",
  "../persona/code_vault.js",
  "calc_academic.js",
  "skills.js",
  "voice.js",
  "documents.js",
  "update.js",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "../persona/floma_platform.js",
  "../persona/personas.js",
  "../persona/system_guide.js",
  // Every persona's art: Toby's picture per emotion, the neutral assistant's logo.
  ...[...new Set(Object.values(self.FLOMA_PERSONAS).flatMap((p) => [...Object.values(p.images || {}), p.logo]).filter(Boolean))]
    .map((image) => AVATAR_DIR + image),
];

self.addEventListener("install", (event) => {
  // One by one: a single missing file must not stop the whole offline copy (and the worker) from installing.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => Promise.all(SHELL.map((file) => cache.add(file).catch(() => console.warn("Not cached:", file)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("floma-web-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return; // APIs go straight to the network
  // Step 59: the page itself and version.json are revalidated with the server, never taken from the HTTP cache;
  // every other file of the published site has ?v=<its hash> in its address, so any cached copy is the right one.
  const fresh = request.mode === "navigate" || url.pathname.endsWith("/version.json")
    ? new Request(request, { cache: "no-cache" }) : request;
  event.respondWith(
    fetch(fresh)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((cached) => cached || (request.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
