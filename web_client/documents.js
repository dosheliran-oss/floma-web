/*
 * Floma web app - documents: reads the text of a PDF or a text file in this browser, before anything
 * is sent. The cleaning, cutting and wrapping as context are in core.js (documentContext), the same
 * on every platform.
 *
 * Text files: the browser's own File.text() (UTF-8, with a Windows-Hebrew fallback).
 * PDF: browsers can display PDFs but don't let a page read their text, so Mozilla's pdf.js (the PDF
 * engine inside Firefox) is loaded the first time a PDF is attached:
 *   - pinned to one version and checked with Subresource Integrity: a changed file is refused;
 *   - eval disabled (isEvalSupported: false), the mitigation for CVE-2024-4367 in this version;
 *   - run on the page itself (pdf.js "fake worker"), since a worker can't load cross-origin code.
 * The file never leaves the browser; only the extracted text goes to Gemini with the message.
 */
(function () {
  "use strict";

  const PDFJS = {
    version: "3.11.174",
    lib: {
      url: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
      integrity: "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e",
    },
    worker: {
      url: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
      integrity: "sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2",
    },
  };

  class DocumentError extends Error {
    /** kind: "unreadable" | "no_text" | "too_large" (lines in floma_platform.js "documents"). */
    constructor(kind) {
      super(kind);
      this.kind = kind;
    }
  }

  const limits = () => window.FLOMA_PLATFORM.documents;

  /** True for files this module reads (by extension or type). */
  function isDocument(file) {
    const name = (file.name || "").toLowerCase();
    return limits().extensions.some((ext) => name.endsWith(ext)) || limits().mime_types.includes(file.type);
  }

  function loadScript({ url, integrity }) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.integrity = integrity;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = resolve;
      script.onerror = () => reject(new Error(`could not load ${url}`));
      document.head.append(script);
    });
  }

  let pdfjsReady = null;

  /** pdf.js, loaded once (the worker script first, so pdf.js runs it on the page). */
  function pdfjs() {
    if (!pdfjsReady) {
      pdfjsReady = loadScript(PDFJS.worker)
        .then(() => loadScript(PDFJS.lib))
        .then(() => window.pdfjsLib)
        .catch((e) => {
          pdfjsReady = null; // try again next time (e.g. after coming back online)
          throw e;
        });
    }
    return pdfjsReady;
  }

  async function readPdf(file) {
    let lib;
    try {
      lib = await pdfjs();
    } catch (e) {
      throw new DocumentError("unreadable");
    }
    let pdf;
    try {
      pdf = await lib.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
      }).promise;
    } catch (e) {
      throw new DocumentError("unreadable"); // damaged or password-protected
    }
    const pages = pdf.numPages;
    const texts = [];
    for (let n = 1; n <= Math.min(pages, limits().max_pages); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => (item.str || "") + (item.hasEOL ? "\n" : "")).join(""));
      page.cleanup();
    }
    await pdf.destroy();
    return { text: texts.join("\n\n"), pages, kind: "pdf" };
  }

  async function readText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), pages: 0, kind: "text" };
    } catch (e) {
      return { text: new TextDecoder("windows-1255").decode(bytes), pages: 0, kind: "text" }; // older Hebrew files
    }
  }

  /** Resolves to { name, text, pages, kind, chars }; rejects with a DocumentError. */
  async function readDocument(file) {
    if (file.size > limits().max_file_bytes) throw new DocumentError("too_large");
    const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
    const read = isPdf ? await readPdf(file) : await readText(file);
    const text = window.FlomaCore.cleanDocumentText(read.text);
    if (!text) throw new DocumentError("no_text");
    return { name: file.name || "document", text, pages: read.pages, kind: read.kind, chars: Array.from(text).length };
  }

  window.FlomaDocuments = { isDocument, readDocument, DocumentError, PDFJS };
})();
