/*
 * Floma web app - service worker. Makes the chat installable and lets it open offline.
 *
 * Strategy: network first for the app's own files (so an update shows up on the next load),
 * falling back to the cached copy when offline. Requests to other origins (Gemini, GitHub, Google
 * Search widgets) are never intercepted or cached: the API key and chat traffic stay out of the
 * cache, and offline Toby answers with his own NETWORK line instead.
 *
 * The persona files are imported so the list of avatar pictures comes from the same profiles as the page.
 */
"use strict";

self.window = self; // the persona files assign window.FLOMA_PLATFORM / FLOMA_PERSONAS
importScripts("../persona/floma_platform.js", "../persona/personas.js");

const CACHE = "floma-web-v3";
const AVATAR_DIR = "../app/src/main/res/drawable-nodpi/";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "core.js",
  "memory.js",
  "voice.js",
  "documents.js",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "../persona/floma_platform.js",
  "../persona/personas.js",
  // Every persona's art: Toby's picture per emotion, the neutral assistant's logo.
  ...[...new Set(Object.values(self.FLOMA_PERSONAS).flatMap((p) => [...Object.values(p.images || {}), p.logo]).filter(Boolean))]
    .map((image) => AVATAR_DIR + image),
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  event.respondWith(
    fetch(request)
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
