/*
 * Floma web app - service worker. Makes the chat installable and lets it open offline.
 *
 * Strategy: network first for the app's own files (so an update shows up on the next load),
 * falling back to the cached copy when offline. Requests to other origins (Gemini, GitHub, Google
 * Search widgets) are never intercepted or cached: the API key and chat traffic stay out of the
 * cache, and offline Toby answers with his own NETWORK line instead.
 *
 * Toby's persona file is imported so the avatar list comes from the same "emotions" as the page.
 */
"use strict";

self.window = self; // toby_persona.js assigns window.FLOMA_PERSONA
importScripts("../persona/toby_persona.js");

const CACHE = "floma-web-v1";
const AVATAR_DIR = "../app/src/main/res/drawable-nodpi/";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "core.js",
  "memory.js",
  "voice.js",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "../persona/toby_persona.js",
  ...self.FLOMA_PERSONA.emotions.map((e) => AVATAR_DIR + e.image),
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
