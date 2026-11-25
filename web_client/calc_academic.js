// Floma - @calc's B.Sc. mathematics on the web (Step 67): a line-for-line port of pc_companion/calc_academic.py -
// logic, finite sets, linear algebra, calculus, combinatorics and the Hebrew / English dictation normalizer. Exact
// fractions (BigInt) where the desktop uses Python's Fraction; floats only for elementary-function values. The shared
// "calc_academic" and "calc_normalize" cases in persona_cases.json pin every answer (persona-tests/check_web_skills.js).
// Never eval, never Gemini, no network.
(function () {
  "use strict";

  class CalcError extends Error {
    constructor(key, values = {}) {
      super(key);
      this.key = key;
      this.values = values;
    }
  }

  // Any @calc error (this file's or calc's own in skills.js): they carry a message key.
  const isCalcError = (e) => !!e && typeof e.key === "string";

  // --- Exact fractions (Python's fractions.Fraction) ---------------------------------------------------

  const babs = (x) => (x < 0n ? -x : x);
  function bgcd(a, b) {
    a = babs(a);
    b = babs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function bfloorDiv(a, b) {  // Python's // for BigInt
    const q = a / b;
    return (a % b !== 0n && ((a < 0n) !== (b < 0n))) ? q - 1n : q;
  }

  class Frac {
    constructor(n, d = 1n) {
      if (d === 0n) throw new CalcError("div_zero");
      if (d < 0n) {
        n = -n;
        d = -d;
      }
      const g = bgcd(n, d) || 1n;
      this.n = n / g;
      this.d = d / g;
    }
    static of(x) { return new Frac(BigInt(x)); }
    static parse(text) {
      const dot = text.indexOf(".");
      if (dot < 0) return new Frac(BigInt(text));
      const decimals = text.length - dot - 1;
      return new Frac(BigInt(text.slice(0, dot) + text.slice(dot + 1)), 10n ** BigInt(decimals));
    }
    add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
    div(o) {
      if (o.n === 0n) throw new CalcError("div_zero");
      return new Frac(this.n * o.d, this.d * o.n);
    }
    neg() { return new Frac(-this.n, this.d); }
    abs() { return new Frac(babs(this.n), this.d); }
    cmp(o) {
      const x = this.n * o.d - o.n * this.d;
      return x < 0n ? -1 : x > 0n ? 1 : 0;
    }
    eq(o) { return this.n === o.n && this.d === o.d; }
    isZero() { return this.n === 0n; }
    isInt() { return this.d === 1n; }
    sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
    lt(o) { return this.cmp(o) < 0; }
    pow(k) {
      let out = Frac.of(1);
      const base = k < 0 ? Frac.of(1).div(this) : this;
      for (let i = 0; i < Math.abs(k); i++) out = out.mul(base);
      return out;
    }
    toNumber() { return Number(this.n) / Number(this.d); }
    text() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  }
  const F0 = Frac.of(0);
  const F1 = Frac.of(1);

  const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻" };
  const DIGITS = "0123456789";
  const MAX_DIM = 4;
  const MAX_DEGREE = 30;

  const sup = (n) => [...String(n)].map((c) => SUPERSCRIPT[c]).join("");
  const qtext = (q) => q.text();
  const pq = (q) => (q.isInt() && q.sign() >= 0 ? q.text() : `(${q.text()})`);

  function qdec(q) {
    if (q.isInt()) return String(q.n);
    let d = q.d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    if (d !== 1n) return q.text();
    const k = Math.max(twos, fives);
    const scaled = (babs(q.n) * 10n ** BigInt(k)) / q.d;
    const digits = String(scaled).padStart(k + 1, "0");
    return (q.n < 0n ? "-" : "") + digits.slice(0, digits.length - k) + "." + digits.slice(digits.length - k);
  }

  function isNumber(tok) {
    if (!tok || !DIGITS.includes(tok[0])) return false;
    return [...tok].every((c) => DIGITS.includes(c) || c === ".") && tok.split(".").length - 1 <= 1;
  }
  const isWord = (tok) => !!tok && [...tok].every((c) => c >= "a" && c <= "z");

  function fill(template, values) {
    let out = template;
    for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value));
    return out;
  }

  const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "א" && c <= "ת");
  function replaceWord(text, phrase, by) {
    const out = [];
    const p = phrase.toLowerCase();
    let i = 0;
    for (;;) {
      const j = text.indexOf(p, i);
      if (j < 0) {
        out.push(text.slice(i));
        return out.join("");
      }
      const end = j + p.length;
      if ((j === 0 || !isLetter(text[j - 1])) && (end === text.length || !isLetter(text[end]))) out.push(text.slice(i, j), by);
      else out.push(text.slice(i, end));
      i = end;
    }
  }

  const byLength = (list) => list.slice().sort((a, b) => b.length - a.length);
  const stripChars = (text, chars) => {
    let s = 0;
    let e = text.length;
    while (s < e && chars.includes(text[s])) s++;
    while (e > s && chars.includes(text[e - 1])) e--;
    return text.slice(s, e);
  };

  function texts(cfg, lang) {
    const out = {};
    for (const [k, v] of Object.entries(cfg.academic.text)) out[k] = v && typeof v === "object" && lang in v ? v[lang] : v;
    return out;
  }

  // --- Dictation ---------------------------------------------------------------------------------------

  function tidy(s) {
    s = s.split(/\s+/).filter(Boolean).join(" ");
    for (const [a, b] of [[" )", ")"], [" ]", "]"], [" }", "}"], [" ,", ","], [" !", "!"], [" ^", "^"], ["^ ", "^"],
      ["( ", "("], ["[ ", "["], ["{ ", "{"], ["~ ", "~"]]) {
      while (s.includes(a)) s = s.split(a).join(b);
    }
    return s.trim();
  }

  function symbols(text, d) {
    let s = text.toLowerCase();
    for (const [a, b] of d.symbols) s = s.split(a).join(b);
    for (const c of "\t\r\n ‎‏") s = s.split(c).join(" ");
    return s.split(/\s+/).filter(Boolean).join(" ");
  }

  const basic = (text, cfg) => stripChars(tidy(symbols(text, cfg.academic.dictation)), " :,");

  const IF_THEN = /(?<![א-ת])אם (.+?) אז (.+)/;
  const LIMIT_HE = /גבול (?:של )?(.+?) (?:כש|כאשר) ?-?(\S+) שואף ל-? ?(.+)/;
  const LIMIT_EN = /limit (?:of )?(.+?) as (\S+) (?:->|approaches|tends to|goes to) (.+)/;
  const INTEGRAL_HE = /אינטגרל (?:של )?(.+?) מ-? ?((?:מינוס )?\S+) עד ((?:מינוס )?\S+)/;
  const INTEGRAL_EN = /integral (?:of )?(.+?) from (\S+) to (\S+)/;

  function structures(s, d) {
    for (const phrase of byLength(d.iff)) s = replaceWord(s, phrase, " <-> ");
    let m = IF_THEN.exec(s);
    if (m) s = s.slice(0, m.index) + `( ${m[1]} ) -> ( ${m[2]} )`;
    m = LIMIT_HE.exec(s) || LIMIT_EN.exec(s);
    if (m) s = s.slice(0, m.index) + `limit( ${m[1]} , ${m[2]} , ${m[3]} )`;
    m = INTEGRAL_HE.exec(s) || INTEGRAL_EN.exec(s);
    if (m) s = s.slice(0, m.index) + `integral( ${m[1]} , x , ${m[2]} , ${m[3]} )`;
    return s;
  }

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function numberValue(word, d) {
    for (const w of [word, word.length > 2 && word[0] === "ו" ? word.slice(1) : null]) {
      if (w === null) continue;
      if (has(d.numbers, w)) return ["num", d.numbers[w]];
      if (has(d.multipliers, w)) return ["mult", d.multipliers[w]];
    }
    return null;
  }

  function numbers(tokens, d) {
    const out = [];
    let i = 0;
    const n = tokens.length;
    while (i < n) {
      if (numberValue(tokens[i], d) === null || has(d.multipliers, tokens[i])) {
        out.push(tokens[i]);
        i++;
        continue;
      }
      let total = 0;
      let current = 0;
      while (i < n && numberValue(tokens[i], d) !== null) {
        const [kind, value] = numberValue(tokens[i], d);
        if (kind === "mult") {
          current = (current || 1) * value;
          if (value >= 1000) {
            total += current;
            current = 0;
          }
        } else current += value;
        i++;
      }
      const value = total + current;
      if (i + 1 < n && d.point.includes(tokens[i]) && numberValue(tokens[i + 1], d) !== null) {
        i++;
        let frac = 0;
        while (i < n && numberValue(tokens[i], d) !== null && numberValue(tokens[i], d)[0] === "num") {
          frac += numberValue(tokens[i], d)[1];
          i++;
        }
        out.push(`${value}.${frac}`);
      } else out.push(String(value));
    }
    return out;
  }

  function markers(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.startsWith("@rest:") || tok.startsWith("@next:")) {
        const name = tok.slice(6);
        const following = i + 1 < tokens.length ? tokens[i + 1] : "";
        if (tok.startsWith("@next:") && following.startsWith("(")) {
          out.push(name);
          i++;
          continue;
        }
        if (tok.startsWith("@next:")) {
          if (following) {
            out.push(`${name}( ${following} )`);
            i += 2;
          } else {
            out.push(name);
            i++;
          }
          continue;
        }
        let rest = markers(tokens.slice(i + 1));
        let by = null;
        if (rest.includes("@by")) {
          const at = rest.indexOf("@by");
          by = at + 1 < rest.length ? rest[at + 1] : null;
          rest = rest.slice(0, at);
        }
        out.push(`${name}( ${rest.join(" ")}` + (by ? ` , ${by} )` : " )"));
        return out;
      }
      out.push(tok);
      i++;
    }
    return out;
  }

  const plainNumber = (tok) => isNumber(tok.startsWith("-") ? tok.slice(1) : tok);

  function implicit(tokens, d) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const after = i + 2 < tokens.length ? tokens[i + 2] : "";
      if (i + 1 < tokens.length && plainNumber(tokens[i]) && d.variables.includes(tokens[i + 1])
        && !(DIGITS.includes(after.slice(0, 1)) && after !== "") && !after.startsWith("(")) {
        out.push(`${tokens[i]}*${tokens[i + 1]}`);
        i += 2;
        continue;
      }
      out.push(tokens[i]);
      i++;
    }
    return out;
  }

  function normalize(text, cfg) {
    const d = cfg.academic.dictation;
    let s = structures(symbols(text, d), d);
    for (const phrase of byLength(Object.keys(d.phrases))) s = replaceWord(s, phrase, ` ${d.phrases[phrase]} `);
    let tokens = s.split(/\s+/).filter(Boolean);
    tokens = numbers(tokens, d);
    tokens = markers(tokens);
    tokens = tokens.filter((t) => t !== "@by");
    tokens = implicit(tokens, d);
    return stripChars(tidy(tokens.join(" ")), " :,");
  }

  // --- Tokens --------------------------------------------------------------------------------------------

  const MULTI = ["<->", "<=>", "->", "=>", "&&", "||"];
  const SINGLE = "()[]{},+-*/^~!&|\\=:";

  function lex(text) {
    const out = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === " ") {
        i++;
        continue;
      }
      const multi = MULTI.find((op) => text.startsWith(op, i));
      if (multi) {
        out.push(multi);
        i += multi.length;
      } else if (DIGITS.includes(c) || (c === "." && i + 1 < n && DIGITS.includes(text[i + 1]))) {
        let j = i;
        while (j < n && DIGITS.includes(text[j])) j++;
        if (j < n && text[j] === "." && j + 1 < n && DIGITS.includes(text[j + 1])) {
          j++;
          while (j < n && DIGITS.includes(text[j])) j++;
        }
        out.push(text[i] !== "." ? text.slice(i, j) : "0" + text.slice(i, j));
        i = j;
      } else if (c >= "a" && c <= "z") {
        let j = i;
        while (j < n && text[j] >= "a" && text[j] <= "z") j++;
        out.push(text.slice(i, j));
        i = j;
      } else if (SINGLE.includes(c)) {
        out.push(c);
        i++;
      } else throw new CalcError("academic_syntax");
    }
    return out;
  }

  class Stream {
    constructor(tokens) {
      this.t = tokens;
      this.i = 0;
    }
    peek(k = 0) { return this.i + k < this.t.length ? this.t[this.i + k] : null; }
    take() {
      if (this.i >= this.t.length) throw new CalcError("academic_syntax");
      return this.t[this.i++];
    }
    expect(tok) { if (this.take() !== tok) throw new CalcError("academic_syntax"); }
    done() { return this.i >= this.t.length; }
  }

  // --- Logic ---------------------------------------------------------------------------------------------

  const LOGIC_CONST = { t: true, true: true, 1: true, f: false, false: false, 0: false };
  const IFF_OPS = ["<->", "<=>"];
  const IMP_OPS = ["->", "=>"];
  const OR_OPS = ["|", "||", "v", "or"];
  const XOR_OPS = ["xor", "+"];
  const AND_OPS = ["&", "&&", "^", "and"];
  const NOT_OPS = ["~", "!", "not"];
  const LOGIC_SYM = { and: "∧", or: "∨", xor: "⊕", imp: "→", iff: "↔" };
  const isConst = (tok) => tok !== null && has(LOGIC_CONST, tok);

  function logicParser(s) {
    function iff() {
      let node = imp();
      while (IFF_OPS.includes(s.peek())) {
        s.take();
        node = ["bin", "iff", node, imp()];
      }
      return node;
    }
    function imp() {
      const left = orr();
      if (IMP_OPS.includes(s.peek())) {
        s.take();
        return ["bin", "imp", left, imp()];
      }
      return left;
    }
    function orr() {
      let node = xor();
      while (OR_OPS.includes(s.peek())) {
        s.take();
        node = ["bin", "or", node, xor()];
      }
      return node;
    }
    function xor() {
      let node = conj();
      while (XOR_OPS.includes(s.peek())) {
        s.take();
        node = ["bin", "xor", node, conj()];
      }
      return node;
    }
    function conj() {
      let node = neg();
      while (AND_OPS.includes(s.peek())) {
        s.take();
        node = ["bin", "and", node, neg()];
      }
      return node;
    }
    function neg() {
      if (NOT_OPS.includes(s.peek())) {
        s.take();
        return ["not", neg()];
      }
      return atom();
    }
    function atom() {
      const tok = s.take();
      if (isConst(tok)) return ["const", LOGIC_CONST[tok]];
      if (tok === "(") {
        const node = iff();
        s.expect(")");
        return node;
      }
      if (tok.length === 1 && tok >= "a" && tok <= "z" && !"vtf".includes(tok)) return ["var", tok];
      throw new CalcError("academic_syntax");
    }
    return { iff };
  }

  function isLogic(tokens) {
    const allowed = new Set([...Object.keys(LOGIC_CONST), ...IFF_OPS, ...IMP_OPS, ...OR_OPS, ...XOR_OPS, ...AND_OPS, ...NOT_OPS, "(", ")"]);
    let letters = false;
    for (const tok of tokens) {
      if (tok.length === 1 && tok >= "a" && tok <= "z" && tok !== "v") {
        letters = true;
        continue;
      }
      if (!allowed.has(tok)) return false;
      if (["t", "f", "true", "false"].includes(tok)) letters = true;
    }
    const strong = tokens.some((tok) => [...IFF_OPS, ...IMP_OPS, "|", "||", "&", "&&", "~", "!", "xor", "not", "and", "or", "v"].includes(tok));
    return strong || (letters && tokens.some((tok) => [...XOR_OPS, ...AND_OPS].includes(tok)));
  }

  function lshow(node) {
    const k = node[0];
    if (k === "const") return node[1] ? "T" : "F";
    if (k === "var") return node[1];
    if (k === "not") {
      const inner = lshow(node[1]);
      return "¬" + (node[1][0] === "bin" ? `(${inner})` : inner);
    }
    let left = lshow(node[2]);
    let right = lshow(node[3]);
    if (node[2][0] === "bin") left = `(${left})`;
    if (node[3][0] === "bin") right = `(${right})`;
    return `${left} ${LOGIC_SYM[node[1]]} ${right}`;
  }

  function lapply(op, a, b) {
    if (op === "and") return a && b;
    if (op === "or") return a || b;
    if (op === "xor") return a !== b;
    if (op === "imp") return !a || b;
    return a === b;
  }

  function leval(node, env) {
    const k = node[0];
    if (k === "const") return node[1];
    if (k === "var") return env[node[1]];
    if (k === "not") return !leval(node[1], env);
    return lapply(node[1], leval(node[2], env), leval(node[3], env));
  }

  const tf = (v) => (v ? "T" : "F");

  function lvars(node, out) {
    const k = node[0];
    if (k === "var" && !out.includes(node[1])) out.push(node[1]);
    else if (k === "not") lvars(node[1], out);
    else if (k === "bin") {
      lvars(node[2], out);
      lvars(node[3], out);
    }
    return out;
  }

  function lsteps(node, steps, rules) {
    const k = node[0];
    if (k === "const") return node[1];
    if (k === "not") {
      const v = lsteps(node[1], steps, rules);
      steps.push(`¬${tf(v)} = ${tf(!v)} · ${rules.not}`);
      return !v;
    }
    const a = lsteps(node[2], steps, rules);
    const b = lsteps(node[3], steps, rules);
    const r = lapply(node[1], a, b);
    steps.push(`${tf(a)} ${LOGIC_SYM[node[1]]} ${tf(b)} = ${tf(r)} · ${rules[node[1]]}`);
    return r;
  }

  function columns(node, out, seen) {
    if (node[0] === "not") columns(node[1], out, seen);
    else if (node[0] === "bin") {
      columns(node[2], out, seen);
      columns(node[3], out, seen);
    } else return;
    const key = lshow(node);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(node);
    }
  }

  function solveLogic(tokens, t) {
    const s = new Stream(tokens);
    const tree = logicParser(s).iff();
    if (!s.done()) throw new CalcError("academic_syntax");
    const names = lvars(tree, []).slice().sort();
    const rules = t.logic_rules;
    if (!names.length) {
      const steps = [];
      const value = lsteps(tree, steps, rules);
      return { kind: "logic", result: `${lshow(tree)} = ${tf(value)}`, steps, table: [] };
    }
    if (names.length > 4) throw new CalcError("logic_vars");
    const cols = [];
    columns(tree, cols, new Set());
    const header = names.concat(cols.map(lshow));
    const table = ["| " + header.join(" | ") + " |", "|" + header.map(() => "---").join("|") + "|"];
    const finals = [];
    const rows = 2 ** names.length;
    for (let i = 0; i < rows; i++) {
      const env = {};
      names.forEach((name, j) => { env[name] = ((i >> (names.length - 1 - j)) & 1) === 0; });
      const cells = names.map((n) => tf(env[n])).concat(cols.map((c) => tf(leval(c, env))));
      finals.push(leval(tree, env));
      table.push("| " + cells.join(" | ") + " |");
    }
    const kind = finals.every(Boolean) ? "tautology" : !finals.some(Boolean) ? "contradiction" : "satisfiable";
    const steps = [fill(t.tt_vars, { vars: names.join(", "), n: names.length, rows }), fill(t.tt_columns, { count: cols.length }), t[`${kind}_why`]];
    return { kind: "truth_table", result: t[kind], steps, table };
  }

  // --- Sets ------------------------------------------------------------------------------------------

  const SET_OPS = { union: "union", intersect: "inter", "\\": "diff", diff: "diff", "-": "diff", symdiff: "sym",
    cartesian: "cart", "*": "cart", subset: "sub", psubset: "psub", in: "in" };
  const SET_SYM = { union: "∪", inter: "∩", diff: "\\", sym: "△", cart: "×", sub: "⊆", psub: "⊂", in: "∈" };
  const SET_WORDS = ["union", "intersect", "symdiff", "cartesian", "powerset", "subset", "psubset", "diff"];

  const RANK = { n: 0, s: 1, t: 2, set: 3 };
  function cmpSeq(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = ecmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  function ecmp(a, b) {  // Python's tuple order of ekey()
    if (RANK[a[0]] !== RANK[b[0]]) return RANK[a[0]] - RANK[b[0]];
    if (a[0] === "n") return a[1].cmp(b[1]);
    if (a[0] === "s") return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    if (a[0] === "t") return cmpSeq(a[1], b[1]);
    if (a[1].length !== b[1].length) return a[1].length - b[1].length;
    return cmpSeq(a[1], b[1]);
  }
  const eeq = (a, b) => ecmp(a, b) === 0;

  function mkset(items) {
    const unique = [];
    for (const item of items) if (!unique.some((u) => eeq(u, item))) unique.push(item);
    unique.sort(ecmp);
    return ["set", unique];
  }

  function estr(e) {
    const k = e[0];
    if (k === "n") return qdec(e[1]);
    if (k === "s") return e[1];
    if (k === "t") return "(" + e[1].map(estr).join(", ") + ")";
    return !e[1].length ? "∅" : "{" + e[1].map(estr).join(", ") + "}";
  }

  function setsParser(s) {
    function expr() {
      let node = term();
      while (s.peek() !== null && has(SET_OPS, s.peek())) node = ["op", SET_OPS[s.take()], node, term()];
      return node;
    }
    function term() {
      const tok = s.peek();
      if (tok === "{") return ["lit", literal()];
      if ((tok === "powerset" || tok === "p") && s.peek(1) === "(") {
        s.take();
        s.take();
        const inner = expr();
        s.expect(")");
        return ["pow", inner];
      }
      if (tok === "(") {
        s.take();
        const node = expr();
        s.expect(")");
        return node;
      }
      return ["lit", element()];
    }
    function literal() {
      s.expect("{");
      const items = [];
      if (s.peek() !== "}") {
        items.push(element());
        while (s.peek() === ",") {
          s.take();
          items.push(element());
        }
      }
      s.expect("}");
      return mkset(items);
    }
    function element() {
      let tok = s.peek();
      if (tok === "{") return literal();
      let negative = false;
      if (tok === "-") {
        s.take();
        negative = true;
        tok = s.peek();
      }
      if (isNumber(tok)) {
        s.take();
        let value = Frac.parse(tok);
        if (s.peek() === "/" && isNumber(s.peek(1))) {
          s.take();
          const den = Frac.parse(s.take());
          if (den.isZero()) throw new CalcError("div_zero");
          value = value.div(den);
        }
        return ["n", negative ? value.neg() : value];
      }
      if (isWord(tok) && !negative) {
        s.take();
        return ["s", tok];
      }
      throw new CalcError("academic_syntax");
    }
    return { expr };
  }

  function setEval(node, steps, t) {
    const k = node[0];
    if (k === "lit") return node[1];
    if (k === "pow") {
      const a = setEval(node[1], steps, t);
      if (a[0] !== "set") throw new CalcError("set_type");
      const n = a[1].length;
      if (n > 6) throw new CalcError("set_too_big");
      const subsets = [];
      for (let mask = 0; mask < 2 ** n; mask++) subsets.push(mkset(a[1].filter((_, j) => (mask >> j) & 1)));
      const result = mkset(subsets);
      steps.push(fill(t.set_power, { a: estr(a), n, m: 2 ** n }));
      steps.push(`P(${estr(a)}) = ${estr(result)}`);
      return result;
    }
    const op = node[1];
    const a = setEval(node[2], steps, t);
    const b = setEval(node[3], steps, t);
    if (b[0] !== "set" || (op !== "in" && a[0] !== "set")) throw new CalcError("set_type");
    if (op === "in") {
      const answer = b[1].some((x) => eeq(x, a));
      steps.push(fill(t.set_in, { a: estr(a), b: estr(b), answer: answer ? t.yes : t.no }));
      return ["bool", answer];
    }
    const inB = (x) => b[1].some((y) => eeq(x, y));
    const inA = (x) => a[1].some((y) => eeq(x, y));
    let result;
    if (op === "union") result = mkset(a[1].concat(b[1]));
    else if (op === "inter") result = mkset(a[1].filter(inB));
    else if (op === "diff") result = mkset(a[1].filter((x) => !inB(x)));
    else if (op === "sym") result = mkset(a[1].filter((x) => !inB(x)).concat(b[1].filter((x) => !inA(x))));
    else if (op === "cart") {
      if (a[1].length * b[1].length > 64) throw new CalcError("set_too_big");
      const pairs = [];
      for (const x of a[1]) for (const y of b[1]) pairs.push(["t", [x, y]]);
      result = mkset(pairs);
    } else {
      const answer = a[1].every(inB) && (op === "sub" || a[1].length < b[1].length);
      steps.push(fill(t.set_subset, { a: estr(a), b: estr(b), sym: SET_SYM[op], answer: answer ? t.yes : t.no }));
      return ["bool", answer];
    }
    steps.push(`${estr(a)} ${SET_SYM[op]} ${estr(b)} = ${estr(result)}`);
    return result;
  }

  function solveSets(tokens, t) {
    const s = new Stream(tokens);
    const tree = setsParser(s).expr();
    if (!s.done()) throw new CalcError("academic_syntax");
    const steps = [];
    const value = setEval(tree, steps, t);
    if (value[0] === "bool") return { kind: "sets", result: value[1] ? t.yes : t.no, steps, table: [] };
    if (value[0] === "set") steps.push(fill(t.set_size, { a: estr(value), n: value[1].length }));
    return { kind: "sets", result: estr(value), steps, table: [] };
  }

  // --- Linear algebra ----------------------------------------------------------------------------------

  const LIN_FNS = ["det", "inv", "rref", "ref", "transpose", "norm", "dot", "cross"];

  function mstr(m, split = null) {
    const rows = m.map((row) => {
      const cells = row.map(qtext);
      if (split !== null) return "[" + cells.slice(0, split).join(", ") + " | " + cells.slice(split).join(", ") + "]";
      return "[" + cells.join(", ") + "]";
    });
    return "[" + rows.join(", ") + "]";
  }
  const vstr = (v) => "[" + v.map(qtext).join(", ") + "]";

  function linText(value) {
    if (value[0] === "num") return qtext(value[1]);
    if (value[0] === "vec") return vstr(value[1]);
    if (value[0] === "mat") return mstr(value[1]);
    return value[1];
  }

  function shape(value) {
    if (value[0] === "mat") return `${value[1].length}×${value[1][0].length}`;
    if (value[0] === "vec") return `${value[1].length}`;
    return "1";
  }

  function linParser(s) {
    function expr() {
      let node = term();
      while (s.peek() === "+" || s.peek() === "-") node = ["bin", s.take(), node, term()];
      return node;
    }
    function term() {
      let node = unary();
      while (s.peek() === "*") {
        s.take();
        node = ["bin", "*", node, unary()];
      }
      return node;
    }
    function unary() {
      if (s.peek() === "-") {
        s.take();
        return ["neg", unary()];
      }
      return power();
    }
    function power() {
      const base = atom();
      if (s.peek() === "^") {
        s.take();
        const tok = s.take();
        if (tok === "t") return ["fn", "transpose", [base]];
        if (tok === "-") {
          if (s.take() !== "1") throw new CalcError("academic_syntax");
          return ["fn", "inv", [base]];
        }
        if (!isNumber(tok) || tok.includes(".")) throw new CalcError("academic_syntax");
        return ["pow", base, Number(tok)];
      }
      return base;
    }
    function atom() {
      const tok = s.peek();
      if (tok === "[") return ["lit", bracket()];
      if (LIN_FNS.includes(tok)) {
        s.take();
        s.expect("(");
        const args = [expr()];
        while (s.peek() === ",") {
          s.take();
          args.push(expr());
        }
        s.expect(")");
        return ["fn", tok, args];
      }
      if (tok === "(") {
        s.take();
        const node = expr();
        s.expect(")");
        return node;
      }
      if (isNumber(tok)) return ["lit", ["num", number()]];
      throw new CalcError("academic_syntax");
    }
    function number() {
      let value = Frac.parse(s.take());
      if (s.peek() === "/" && isNumber(s.peek(1))) {
        s.take();
        const den = Frac.parse(s.take());
        if (den.isZero()) throw new CalcError("div_zero");
        value = value.div(den);
      }
      return value;
    }
    function signed() {
      const negative = s.peek() === "-";
      if (negative) s.take();
      if (!isNumber(s.peek())) throw new CalcError("academic_syntax");
      const value = number();
      return negative ? value.neg() : value;
    }
    function row() {
      s.expect("[");
      const values = [signed()];
      while (s.peek() === ",") {
        s.take();
        values.push(signed());
      }
      s.expect("]");
      return values;
    }
    function bracket() {
      if (s.peek(1) === "[") {
        s.expect("[");
        const rows = [row()];
        while (s.peek() === ",") {
          s.take();
          rows.push(row());
        }
        s.expect("]");
        if (rows.length > MAX_DIM || rows.some((r) => r.length !== rows[0].length) || rows[0].length > MAX_DIM) throw new CalcError("matrix_size");
        return ["mat", rows];
      }
      const r = row();
      if (r.length > MAX_DIM) throw new CalcError("matrix_size");
      return ["vec", r];
    }
    return { expr };
  }

  const coef = (q) => (q.isInt() && q.sign() >= 0 ? q.text() : `(${q.text()})`);
  const timesRow = (q, j) => (q.eq(F1) ? `R${j}` : `${coef(q)}·R${j}`);

  function rowReduce(m, steps, reduced = true, split = null, record = true) {
    const a = m.map((r) => r.slice());
    const rows = a.length;
    const cols = a[0].length;
    const pivotCols = split !== null ? split : cols;
    let r = 0;
    for (let c = 0; c < pivotCols; c++) {
      if (r >= rows) break;
      let pivot = null;
      for (let i = r; i < rows; i++) {
        if (!a[i][c].isZero()) {
          pivot = i;
          break;
        }
      }
      if (pivot === null) continue;
      if (pivot !== r) {
        [a[r], a[pivot]] = [a[pivot], a[r]];
        if (record) steps.push(`R${r + 1} ↔ R${pivot + 1}: ${mstr(a, split)}`);
      }
      const p = a[r][c];
      if (!p.eq(F1)) {
        a[r] = a[r].map((x) => x.div(p));
        if (record) steps.push(`R${r + 1} → ${timesRow(F1.div(p), r + 1)}: ${mstr(a, split)}`);
      }
      for (let i = 0; i < rows; i++) {
        if (i === r || (!reduced && i < r)) continue;
        const f = a[i][c];
        if (f.isZero()) continue;
        a[i] = a[i].map((x, j) => x.sub(f.mul(a[r][j])));
        if (record) steps.push(`R${i + 1} → R${i + 1} ${f.sign() > 0 ? "−" : "+"} ${timesRow(f.abs(), r + 1)}: ${mstr(a, split)}`);
      }
      r++;
    }
    return a;
  }

  const det2 = (m) => m[0][0].mul(m[1][1]).sub(m[0][1].mul(m[1][0]));
  function det2Text(m) {
    const [a, b, c, d] = [m[0][0], m[0][1], m[1][0], m[1][1]];
    return `${pq(a)}·${pq(d)} − ${pq(b)}·${pq(c)} = ${pq(a.mul(d))} − ${pq(b.mul(c))} = ${qtext(det2(m))}`;
  }

  function determinant(m, steps, t) {
    const n = m.length;
    if (n !== m[0].length) throw new CalcError("not_square");
    if (n === 1) {
      steps.push(`det = ${qtext(m[0][0])}`);
      return m[0][0];
    }
    if (n === 2) {
      steps.push("det = a·d − b·c = " + det2Text(m));
      return det2(m);
    }
    if (n === 3) {
      steps.push(t.det_expand);
      const minors = [];
      for (let j = 0; j < 3; j++) {
        const minor = [1, 2].map((i) => [0, 1, 2].filter((c) => c !== j).map((c) => m[i][c]));
        minors.push(det2(minor));
        steps.push(`M1${j + 1} = det(${mstr(minor)}) = ` + det2Text(minor));
      }
      const r = m[0][0].mul(minors[0]).sub(m[0][1].mul(minors[1])).add(m[0][2].mul(minors[2]));
      steps.push(`det = ${pq(m[0][0])}·${pq(minors[0])} − ${pq(m[0][1])}·${pq(minors[1])} + ${pq(m[0][2])}·${pq(minors[2])} = ${qtext(r)}`);
      return r;
    }
    steps.push(t.det_gauss);
    const a = m.map((r) => r.slice());
    let sign = 1;
    for (let c = 0; c < n; c++) {
      let pivot = null;
      for (let i = c; i < n; i++) {
        if (!a[i][c].isZero()) {
          pivot = i;
          break;
        }
      }
      if (pivot === null) {
        steps.push(fill(t.det_zero_col, { c: c + 1 }));
        return F0;
      }
      if (pivot !== c) {
        [a[c], a[pivot]] = [a[pivot], a[c]];
        sign = -sign;
        steps.push(`R${c + 1} ↔ R${pivot + 1}: ${mstr(a)}`);
      }
      for (let i = c + 1; i < n; i++) {
        const f = a[i][c].div(a[c][c]);
        if (f.isZero()) continue;
        a[i] = a[i].map((x, j) => x.sub(f.mul(a[c][j])));
        steps.push(`R${i + 1} → R${i + 1} ${f.sign() > 0 ? "−" : "+"} ${timesRow(f.abs(), c + 1)}: ${mstr(a)}`);
      }
    }
    let product = F1;
    for (let i = 0; i < n; i++) product = product.mul(a[i][i]);
    const r = sign < 0 ? product.neg() : product;
    steps.push(`det = ${sign < 0 ? "−" : ""}(` + a.map((row, i) => pq(row[i])).join(" · ") + `) = ${qtext(r)}`);
    return r;
  }

  function inverse(m, steps, t) {
    const n = m.length;
    if (n !== m[0].length) throw new CalcError("not_square");
    const d = determinant(m, steps, t);
    if (d.isZero()) throw new CalcError("singular");
    if (n === 1) {
      steps.push(`A⁻¹ = 1/${pq(d)} = ${qtext(F1.div(d))}`);
      return [[F1.div(d)]];
    }
    if (n === 2) {
      const adj = [[m[1][1], m[0][1].neg()], [m[1][0].neg(), m[0][0]]];
      const result = adj.map((row) => row.map((x) => x.div(d)));
      steps.push(`A⁻¹ = (1/det)·[[d, −b], [−c, a]] = ${coef(F1.div(d))}·${mstr(adj)} = ${mstr(result)}`);
      return result;
    }
    steps.push(t.inv_gauss);
    const augmented = m.map((row, i) => row.concat(row.map((_, j) => (i === j ? F1 : F0))));
    const reduced = rowReduce(augmented, steps, true, n);
    return reduced.map((row) => row.slice(n));
  }

  function bisqrt(n) {
    if (n < 2n) return n;
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x--;
    while ((x + 1n) * (x + 1n) <= n) x++;
    return x;
  }
  function isSquareQ(q) {
    if (q.sign() < 0) return null;
    const a = bisqrt(q.n);
    const b = bisqrt(q.d);
    return a * a === q.n && b * b === q.d ? new Frac(a, b) : null;
  }

  function dot(u, w, steps, label) {
    let total = F0;
    u.forEach((x, i) => { total = total.add(x.mul(w[i])); });
    steps.push(`${label} = ` + u.map((x, i) => `${pq(x)}·${pq(w[i])}`).join(" + ") + ` = ${qtext(total)}`);
    return total;
  }

  function matmul(a, b, steps) {
    const rows = a.length;
    const inner = b.length;
    const cols = b[0].length;
    if (a[0].length !== inner) throw new CalcError("matrix_shape", { a: `${rows}×${a[0].length}`, b: `${inner}×${cols}` });
    const out = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        const column = b.map((r) => r[j]);
        if (steps !== null) row.push(dot(a[i], column, steps, `c${i + 1}${j + 1}`));
        else {
          let total = F0;
          a[i].forEach((x, k) => { total = total.add(x.mul(column[k])); });
          row.push(total);
        }
      }
      out.push(row);
    }
    return out;
  }

  function scale(k, value) {
    if (value[0] === "num") return ["num", k.mul(value[1])];
    if (value[0] === "vec") return ["vec", value[1].map((x) => k.mul(x))];
    if (value[0] === "mat") return ["mat", value[1].map((row) => row.map((x) => k.mul(x)))];
    throw new CalcError("academic_syntax");
  }

  function linFn(name, args, steps, t) {
    if (name === "dot" || name === "cross") {
      if (args.length !== 2) throw new CalcError("academic_syntax");
    } else if (args.length !== 1) throw new CalcError("academic_syntax");
    const a = args[0];
    if (["det", "inv", "rref", "ref", "transpose"].includes(name) && a[0] !== "mat") throw new CalcError("matrix_shape_one");
    if (name === "det") return ["num", determinant(a[1], steps, t)];
    if (name === "inv") return ["mat", inverse(a[1], steps, t)];
    if (name === "rref" || name === "ref") {
      steps.push(t[name === "rref" ? "rref_start" : "ref_start"]);
      return ["mat", rowReduce(a[1], steps, name === "rref")];
    }
    if (name === "transpose") {
      const m = a[1];
      const result = m[0].map((_, j) => m.map((row) => row[j]));
      steps.push(fill(t.la_transpose, { a: mstr(m), r: mstr(result) }));
      return ["mat", result];
    }
    if (name === "norm") {
      if (a[0] !== "vec") throw new CalcError("matrix_shape_one");
      let total = F0;
      for (const x of a[1]) total = total.add(x.mul(x));
      const root = isSquareQ(total);
      const terms = a[1].map((x) => `${pq(x)}²`).join(" + ");
      if (root !== null) {
        steps.push(`‖v‖ = √(${terms}) = √${qtext(total)} = ${qtext(root)}`);
        return ["num", root];
      }
      const approx = window.FlomaSkills.calcFmt(Math.sqrt(total.toNumber()));
      steps.push(`‖v‖ = √(${terms}) = √${qtext(total)} ≈ ${approx}`);
      return ["text", `√${qtext(total)} ≈ ${approx}`];
    }
    const [u, w] = args;
    if (u[0] !== "vec" || w[0] !== "vec" || u[1].length !== w[1].length) throw new CalcError("matrix_shape", { a: shape(u), b: shape(w) });
    if (name === "dot") return ["num", dot(u[1], w[1], steps, "u·v")];
    if (u[1].length !== 3) throw new CalcError("cross_dim");
    const [x, y] = [u[1], w[1]];
    const c = [x[1].mul(y[2]).sub(x[2].mul(y[1])), x[2].mul(y[0]).sub(x[0].mul(y[2])), x[0].mul(y[1]).sub(x[1].mul(y[0]))];
    steps.push(`u×v = (${pq(x[1])}·${pq(y[2])} − ${pq(x[2])}·${pq(y[1])}, ${pq(x[2])}·${pq(y[0])} − ${pq(x[0])}·${pq(y[2])}, `
      + `${pq(x[0])}·${pq(y[1])} − ${pq(x[1])}·${pq(y[0])}) = ${vstr(c)}`);
    return ["vec", c];
  }

  function linEval(node, steps, t) {
    const k = node[0];
    if (k === "lit") return node[1];
    if (k === "neg") return scale(Frac.of(-1), linEval(node[1], steps, t));
    if (k === "fn") return linFn(node[1], node[2].map((a) => linEval(a, steps, t)), steps, t);
    if (k === "pow") {
      const base = linEval(node[1], steps, t);
      const n = node[2];
      if (base[0] === "num") return ["num", base[1].pow(n)];
      if (base[0] !== "mat" || base[1].length !== base[1][0].length || n < 1 || n > 8) throw new CalcError("not_square");
      let result = base[1];
      for (let i = 0; i < n - 1; i++) result = matmul(result, base[1], null);
      steps.push(`A^${n} = A·A${n > 2 ? "·…" : ""} = ${mstr(result)}`);
      return ["mat", result];
    }
    const op = node[1];
    const a = linEval(node[2], steps, t);
    const b = linEval(node[3], steps, t);
    if (op === "+" || op === "-") {
      if (a[0] !== b[0] || shape(a) !== shape(b)) throw new CalcError("matrix_shape", { a: shape(a), b: shape(b) });
      const combine = (x, y) => (op === "+" ? x.add(y) : x.sub(y));
      let result;
      if (a[0] === "num") result = ["num", combine(a[1], b[1])];
      else if (a[0] === "vec") result = ["vec", a[1].map((x, i) => combine(x, b[1][i]))];
      else result = ["mat", a[1].map((row, i) => row.map((x, j) => combine(x, b[1][i][j])))];
      steps.push(`${linText(a)} ${op === "+" ? "+" : "−"} ${linText(b)} = ${linText(result)}`);
      return result;
    }
    if (a[0] === "num" || b[0] === "num") {
      const [kk, other] = a[0] === "num" ? [a[1], b] : [b[1], a];
      const result = scale(kk, other);
      if (other[0] !== "num") steps.push(`${qtext(kk)} · ${linText(other)} = ${linText(result)}`);
      return result;
    }
    if (a[0] === "vec" && b[0] === "vec") {
      if (a[1].length !== b[1].length) throw new CalcError("matrix_shape", { a: shape(a), b: shape(b) });
      return ["num", dot(a[1], b[1], steps, "u·v")];
    }
    if (a[0] === "mat" && b[0] === "vec") {
      const product = matmul(a[1], b[1].map((x) => [x]), steps);
      return ["vec", product.map((r) => r[0])];
    }
    if (a[0] === "vec") throw new CalcError("matrix_shape", { a: shape(a), b: shape(b) });
    return ["mat", matmul(a[1], b[1], steps)];
  }

  function solveLinalg(tokens, t) {
    const s = new Stream(tokens);
    const tree = linParser(s).expr();
    if (!s.done()) throw new CalcError("academic_syntax");
    const steps = [];
    const value = linEval(tree, steps, t);
    return { kind: "linalg", result: linText(value), steps, table: [] };
  }

  // --- Calculus --------------------------------------------------------------------------------------

  const CALC_FNS = ["sin", "cos", "tan", "exp", "ln", "sqrt"];
  const ONE = ["num", F1];
  const TWO = ["num", Frac.of(2)];
  const ZERO = ["num", F0];
  const num = (q) => ["num", q];
  const X = (v) => ["poly", [[1, F1]], v];

  function neq(a, b) {  // structural equality of nodes (Python's ==)
    if (a instanceof Frac || b instanceof Frac) return a instanceof Frac && b instanceof Frac && a.eq(b);
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((x, i) => neq(x, b[i]));
    }
    return a === b;
  }

  function symParser(s) {
    function expr() {
      let node = term();
      while (s.peek() === "+" || s.peek() === "-") node = [s.take() === "+" ? "add" : "sub", node, term()];
      return node;
    }
    const startsAtom = (tok) => tok !== null && (isNumber(tok) || isWord(tok) || tok === "(");
    function term() {
      let node = unary();
      for (;;) {
        const tok = s.peek();
        if (tok === "*") {
          s.take();
          node = ["mul", node, unary()];
        } else if (tok === "/") {
          s.take();
          node = ["div", node, unary()];
        } else if (startsAtom(tok)) node = ["mul", node, power()];
        else return node;
      }
    }
    function unary() {
      if (s.peek() === "-") {
        s.take();
        return ["neg", unary()];
      }
      if (s.peek() === "+") {
        s.take();
        return unary();
      }
      return power();
    }
    function power() {
      const base = atom();
      if (s.peek() === "^") {
        s.take();
        return ["pow", base, unary()];
      }
      return base;
    }
    function atom() {
      const tok = s.take();
      if (isNumber(tok)) return ["num", Frac.parse(tok)];
      if (tok === "(") {
        const node = expr();
        s.expect(")");
        return node;
      }
      if (CALC_FNS.includes(tok)) {
        s.expect("(");
        const arg = expr();
        s.expect(")");
        return ["fn", tok, arg];
      }
      if (tok === "pi" || tok === "e") return ["const", tok];
      if (tok === "inf" || tok === "infinity") return ["const", "inf"];
      if (tok.length === 1 && tok >= "a" && tok <= "z") return ["var", tok];
      throw new CalcError("academic_syntax");
    }
    return { expr };
  }

  function hasVar(n, v) {
    const k = n[0];
    if (k === "var") return n[1] === v;
    if (k === "poly") return n[1].some(([d]) => d > 0);
    if (k === "num" || k === "const") return false;
    if (k === "neg" || k === "fn") return hasVar(n[n.length - 1], v);
    return hasVar(n[1], v) || hasVar(n[2], v);
  }

  // Polynomials: Map degree → Frac (no zero entries).
  function pclean(m) {
    const out = new Map();
    for (const [d, c] of m) if (!c.isZero()) out.set(d, c);
    return out;
  }
  function padd(a, b, sign = 1) {
    const out = new Map(a);
    for (const [d, c] of b) out.set(d, (out.get(d) || F0).add(sign === 1 ? c : c.neg()));
    return pclean(out);
  }
  function pmul(a, b) {
    const out = new Map();
    for (const [d1, c1] of a) {
      for (const [d2, c2] of b) {
        if (d1 + d2 > MAX_DEGREE) return null;
        out.set(d1 + d2, (out.get(d1 + d2) || F0).add(c1.mul(c2)));
      }
    }
    return pclean(out);
  }
  const pdegrees = (p) => [...p.keys()];
  function peq(a, b) {
    if (a.size !== b.size) return false;
    for (const [d, c] of a) if (!b.has(d) || !b.get(d).eq(c)) return false;
    return true;
  }

  function toPoly(n, v) {
    const k = n[0];
    if (k === "num") return n[1].isZero() ? new Map() : new Map([[0, n[1]]]);
    if (k === "poly") return n[2] === v || !hasVar(n, n[2]) ? new Map(n[1]) : null;
    if (k === "var") return n[1] === v ? new Map([[1, F1]]) : null;
    if (k === "const" || k === "fn") return null;
    if (k === "neg") {
      const p = toPoly(n[1], v);
      return p === null ? null : new Map([...p].map(([d, c]) => [d, c.neg()]));
    }
    const a = toPoly(n[1], v);
    if (a === null) return null;
    if (k === "pow") {
      const e = toPoly(n[2], v);
      if (e === null || pdegrees(e).some((d) => d > 0)) return null;
      const exponent = e.get(0) || F0;
      if (!exponent.isInt() || exponent.sign() < 0 || exponent.cmp(Frac.of(MAX_DEGREE)) > 0) return null;
      let out = new Map([[0, F1]]);
      for (let i = 0; i < Number(exponent.n); i++) {
        out = pmul(out, a);
        if (out === null) return null;
      }
      return out;
    }
    const b = toPoly(n[2], v);
    if (b === null) return null;
    if (k === "add") return padd(a, b);
    if (k === "sub") return padd(a, b, -1);
    if (k === "mul") return pmul(a, b);
    if (pdegrees(b).some((d) => d > 0) || b.size === 0) return null;
    return new Map([...a].map(([d, c]) => [d, c.div(b.get(0))]));
  }

  function mkpoly(p, v) {
    if (p.size === 0) return ZERO;
    const ds = pdegrees(p);
    if (ds.length === 1 && ds[0] === 0) return ["num", p.get(0)];
    return ["poly", ds.slice().sort((a, b) => b - a).map((d) => [d, p.get(d)]), v];
  }

  function ptext(p, v) {
    if (p.size === 0) return "0";
    let out = "";
    for (const d of pdegrees(p).sort((a, b) => b - a)) {
      const c = p.get(d);
      const mag = c.abs();
      let body;
      if (d === 0) body = qtext(mag);
      else {
        const cs = mag.eq(F1) ? "" : mag.isInt() ? qtext(mag) : `(${qtext(mag)})`;
        body = cs + v + (d > 1 ? sup(d) : "");
      }
      if (!out) out = (c.sign() < 0 ? "-" : "") + body;
      else out += (c.sign() < 0 ? " - " : " + ") + body;
    }
    return out;
  }

  const terms = (n) => (n[0] === "poly" ? n[1].length : n[0] === "add" || n[0] === "sub" ? 2 : 1);

  function isAtom(n) {
    const k = n[0];
    if (k === "num") return n[1].sign() >= 0 && n[1].isInt();
    if (k === "poly") return n[1].length === 1 && n[1][0][1].eq(F1);
    if (k === "pow") return isAtom(n[1]) && n[2][0] === "num" && n[2][1].isInt();
    return k === "var" || k === "const" || k === "fn";
  }

  const wrap = (n) => (isAtom(n) ? show(n) : `(${show(n)})`);
  function wrapBase(n) {
    const plain = isAtom(n) && n[0] !== "pow" && !(n[0] === "poly" && n[1][0][0] > 1);
    return plain ? show(n) : `(${show(n)})`;
  }
  const wrapSum = (n) => (terms(n) > 1 || (n[0] === "num" && n[1].sign() < 0) || n[0] === "neg" ? `(${show(n)})` : show(n));
  function wrapMul(n) {
    if (["add", "sub", "neg", "div"].includes(n[0]) || terms(n) > 1 || (n[0] === "num" && (n[1].sign() < 0 || !n[1].isInt()))) return `(${show(n)})`;
    return show(n);
  }

  function show(n) {
    const k = n[0];
    if (k === "num") return qtext(n[1]);
    if (k === "poly") return ptext(new Map(n[1]), n[2]);
    if (k === "const") return { pi: "π", e: "e", inf: "∞" }[n[1]];
    if (k === "var") return n[1];
    if (k === "fn") {
      const [, name, a] = n;
      if (name === "exp") return "e^" + wrap(a);
      if (name === "sqrt") return "√" + wrap(a);
      if (name === "lnabs") return `ln|${show(a)}|`;
      return `${name}(${show(a)})`;
    }
    if (k === "neg") return "-" + wrapSum(n[1]);
    const [, a, b] = n;
    if (k === "add") {
      if (b[0] === "num" && b[1].sign() < 0) return `${show(a)} - ${qtext(b[1].neg())}`;
      if (b[0] === "neg") return `${show(a)} - ${wrapSum(b[1])}`;
      return `${show(a)} + ${show(b)}`;
    }
    if (k === "sub") return `${show(a)} - ${wrapSum(b)}`;
    if (k === "mul") {
      if (a[0] === "num") {
        const factor = b[0] === "var" || (b[0] === "pow" && b[1][0] === "var") ? show(b) : null;
        const c = a[1].isInt() ? qtext(a[1]) : `(${qtext(a[1])})`;
        if (factor !== null) return c + factor;
        return `${c}·${wrapMul(b)}`;
      }
      return `${wrapMul(a)}·${wrapMul(b)}`;
    }
    if (k === "div") return `${wrapMul(a)}/${wrap(b)}`;
    const base = wrapBase(a);
    if (b[0] === "num" && b[1].isInt()) return base + sup(b[1].n);
    return base + "^" + wrap(b);
  }

  const isNum = (n, value = null) => n[0] === "num" && (value === null || n[1].eq(value));
  const MINUS1 = Frac.of(-1);

  function simp(n, v) {
    const k = n[0];
    if (k === "var") return n[1] === v ? X(v) : n;
    if (k === "num" || k === "const" || k === "poly") return n;
    if (k === "fn") return ["fn", n[1], simp(n[2], v)];
    let a;
    let b;
    let n2;
    if (k === "neg") {
      a = simp(n[1], v);
      n2 = ["neg", a];
    } else {
      a = simp(n[1], v);
      b = simp(n[2], v);
      n2 = [k, a, b];
    }
    const p = toPoly(n2, v);
    if (p !== null) return mkpoly(p, v);
    if (k === "neg") {
      if (a[0] === "neg") return a[1];
      return n2;
    }
    if (k === "add") {
      if (isNum(a, F0)) return b;
      if (isNum(b, F0)) return a;
      if (b[0] === "num" && b[1].sign() < 0) return ["sub", a, num(b[1].neg())];
      if (b[0] === "neg") return ["sub", a, b[1]];
      if (b[0] === "mul" && b[1][0] === "num" && b[1][1].sign() < 0) return ["sub", a, simp(["mul", num(b[1][1].neg()), b[2]], v)];
      return n2;
    }
    if (k === "sub") {
      if (isNum(b, F0)) return a;
      if (isNum(a, F0)) return simp(["neg", b], v);
      if (neq(a, b)) return ZERO;
      if (b[0] === "neg") return ["add", a, b[1]];
      return n2;
    }
    if (k === "mul") {
      if (isNum(a, F0) || isNum(b, F0)) return ZERO;
      if (isNum(a, F1)) return b;
      if (isNum(b, F1)) return a;
      if (isNum(a, MINUS1)) return simp(["neg", b], v);
      if (isNum(b, MINUS1)) return simp(["neg", a], v);
      if (b[0] === "num" && a[0] !== "num") return simp(["mul", b, a], v);
      if (a[0] === "num" && b[0] === "mul" && b[1][0] === "num") return simp(["mul", num(a[1].mul(b[1][1])), b[2]], v);
      if (a[0] === "neg") return simp(["neg", ["mul", a[1], b]], v);
      if (b[0] === "neg") return simp(["neg", ["mul", a, b[1]]], v);
      if (a[0] === "div" && isNum(a[1], F1)) return simp(["div", b, a[2]], v);
      if (b[0] === "div" && isNum(b[1], F1)) return simp(["div", a, b[2]], v);
      return n2;
    }
    if (k === "div") {
      if (isNum(b, F1)) return a;
      if (isNum(a, F0)) return ZERO;
      if (neq(a, b)) return ONE;
      if (b[0] === "num" && !b[1].isZero()) return simp(["mul", num(F1.div(b[1])), a], v);
      if (a[0] === "neg") return simp(["neg", ["div", a[1], b]], v);
      if (a[0] === "num" && a[1].sign() < 0) return ["neg", ["div", num(a[1].neg()), b]];
      return n2;
    }
    if (isNum(b, F0)) return ONE;
    if (isNum(b, F1)) return a;
    if (isNum(a, F1)) return ONE;
    return n2;
  }

  const check = (x) => window.FlomaSkills.calcCheck(x);
  const fmt = (x) => window.FlomaSkills.calcFmt(x);

  function evalf(n, x) {
    const k = n[0];
    if (k === "num") return n[1].toNumber();
    if (k === "poly") {
      const ts = new Map(n[1]);
      let acc = 0;
      for (let d = Math.max(...ts.keys()); d >= 0; d--) acc = acc * x + (ts.get(d) || F0).toNumber();
      return check(acc);
    }
    if (k === "const") {
      if (n[1] === "inf") throw new CalcError("academic_syntax");
      return n[1] === "pi" ? Math.PI : Math.E;
    }
    if (k === "var") return x;
    if (k === "neg") return -evalf(n[1], x);
    if (k === "fn") {
      let a = evalf(n[2], x);
      const name = n[1];
      if (name === "sin") return check(Math.sin(a));
      if (name === "cos") return check(Math.cos(a));
      if (name === "tan") {
        if (Math.abs(Math.cos(a)) < 1e-12) throw new CalcError("tan_undefined");
        return check(Math.tan(a));
      }
      if (name === "exp") return check(Math.exp(a));
      if (name === "ln" || name === "lnabs") {
        a = name === "lnabs" ? Math.abs(a) : a;
        if (a <= 0) throw new CalcError("log_domain");
        return check(Math.log(a));
      }
      if (a < 0) throw new CalcError("sqrt_negative");
      return check(Math.sqrt(a));
    }
    const a = evalf(n[1], x);
    const b = evalf(n[2], x);
    if (k === "add") return check(a + b);
    if (k === "sub") return check(a - b);
    if (k === "mul") return check(a * b);
    if (k === "div") {
      if (b === 0) throw new CalcError("div_zero");
      return check(a / b);
    }
    if (a < 0 && b !== Math.floor(b)) throw new CalcError("pow_negative");
    if (a === 0 && b < 0) throw new CalcError("div_zero");
    return check(Math.pow(a, b));
  }

  function derive(n, v, steps, t) {
    if (!hasVar(n, v)) return ZERO;
    const p = toPoly(n, v);
    if (p !== null) {
      const dp = new Map();
      for (const [d, c] of p) if (d > 0) dp.set(d - 1, c.mul(Frac.of(d)));
      const result = mkpoly(dp, v);
      if (!peq(p, new Map([[1, F1]]))) steps.push(fill(t.d_power, { f: ptext(p, v), d: show(result) }));
      return result;
    }
    const k = n[0];
    if (k === "add" || k === "sub") {
      const f = simp(n[1], v);
      const g = simp(n[2], v);
      steps.push(fill(t.d_sum, { f: show(f), g: show(g), op: k === "add" ? "+" : "-" }));
      return simp([k, derive(n[1], v, steps, t), derive(n[2], v, steps, t)], v);
    }
    if (k === "neg") return simp(["neg", derive(n[1], v, steps, t)], v);
    if (k === "mul") {
      const a = simp(n[1], v);
      const b = simp(n[2], v);
      if (!hasVar(a, v)) {
        steps.push(fill(t.d_const, { c: show(a), f: show(b) }));
        return simp(["mul", a, derive(b, v, steps, t)], v);
      }
      if (!hasVar(b, v)) {
        steps.push(fill(t.d_const, { c: show(b), f: show(a) }));
        return simp(["mul", b, derive(a, v, steps, t)], v);
      }
      steps.push(fill(t.d_product, { u: show(a), v: show(b) }));
      const da = derive(a, v, steps, t);
      const db = derive(b, v, steps, t);
      return simp(["add", simp(["mul", da, b], v), simp(["mul", a, db], v)], v);
    }
    if (k === "div") {
      const a = simp(n[1], v);
      const b = simp(n[2], v);
      if (!hasVar(b, v)) {
        steps.push(fill(t.d_const_div, { c: show(b), f: show(a) }));
        return simp(["div", derive(a, v, steps, t), b], v);
      }
      steps.push(fill(t.d_quotient, { u: show(a), v: show(b) }));
      const da = derive(a, v, steps, t);
      const db = derive(b, v, steps, t);
      const top = simp(["sub", simp(["mul", da, b], v), simp(["mul", a, db], v)], v);
      return simp(["div", top, simp(["pow", b, TWO], v)], v);
    }
    if (k === "pow") {
      const base = simp(n[1], v);
      const e = simp(n[2], v);
      if (!hasVar(e, v) && e[0] === "num") {
        const m = e[1];
        steps.push(fill(t.d_chain_power, { f: show(["pow", base, e]), n: qtext(m), m: qtext(m.sub(F1)), u: show(base) }));
        const db = derive(base, v, steps, t);
        const outer = simp(["mul", num(m), simp(["pow", base, num(m.sub(F1))], v)], v);
        return simp(["mul", outer, db], v);
      }
      if (neq(base, ["const", "e"])) return derive(["fn", "exp", e], v, steps, t);
      if (!hasVar(base, v)) {
        steps.push(fill(t.d_expa, { a: show(base), u: show(e) }));
        const de = derive(e, v, steps, t);
        return simp(["mul", simp(["mul", ["pow", base, e], ["fn", "ln", base]], v), de], v);
      }
      throw new CalcError("derivative_unsupported");
    }
    if (k === "fn") {
      const name = n[1];
      const a = simp(n[2], v);
      const outers = {
        sin: ["fn", "cos", a],
        cos: ["neg", ["fn", "sin", a]],
        tan: ["div", ONE, ["pow", ["fn", "cos", a], TWO]],
        exp: ["fn", "exp", a],
        ln: ["div", ONE, a],
        lnabs: ["div", ONE, a],
        sqrt: ["div", ONE, ["mul", TWO, ["fn", "sqrt", a]]],
      };
      const outer = simp(outers[name], v);
      if (neq(a, X(v))) {
        steps.push(fill(t.d_basic, { f: show(["fn", name, a]), d: show(outer) }));
        return outer;
      }
      steps.push(fill(t.d_chain, { f: show(["fn", name, a]), outer: show(outer), inner: show(a) }));
      return simp(["mul", outer, derive(a, v, steps, t)], v);
    }
    throw new CalcError("derivative_unsupported");
  }

  function splitTerms(n) {
    const k = n[0];
    if (k === "add") return splitTerms(n[1]).concat(splitTerms(n[2]));
    if (k === "sub") return splitTerms(n[1]).concat(splitTerms(n[2]).map(([c, x]) => [c.neg(), x]));
    if (k === "neg") return splitTerms(n[1]).map(([c, x]) => [c.neg(), x]);
    if (k === "poly") return n[1].map(([d, c]) => [c, mkpoly(new Map([[d, F1]]), n[2])]);
    return [[F1, n]];
  }

  function constFactor(n, v) {
    if (n[0] === "mul" && n[1][0] === "num") {
      const [c, core] = constFactor(n[2], v);
      return [n[1][1].mul(c), core];
    }
    if (n[0] === "mul" && n[2][0] === "num") {
      const [c, core] = constFactor(n[1], v);
      return [n[2][1].mul(c), core];
    }
    if (n[0] === "div" && n[2][0] === "num" && !n[2][1].isZero()) {
      const [c, core] = constFactor(n[1], v);
      return [c.div(n[2][1]), core];
    }
    if (n[0] === "neg") {
      const [c, core] = constFactor(n[1], v);
      return [c.neg(), core];
    }
    return [F1, n];
  }

  function linear(n, v) {
    const p = toPoly(n, v);
    if (p === null || pdegrees(p).some((d) => d > 1) || (p.get(1) || F0).isZero()) return null;
    return [p.get(1) || F0, p.get(0) || F0];
  }

  const integratePoly = (p, v) => mkpoly(new Map([...p].map(([d, c]) => [d + 1, c.div(Frac.of(d + 1))])), v);

  function integrateCore(n, v) {
    const x = X(v);
    const p = toPoly(n, v);
    if (p !== null) return integratePoly(p, v);
    const k = n[0];
    if (k === "div" && n[1][0] === "num") {
      const lin = linear(n[2], v);
      if (lin !== null) return simp(["mul", num(n[1][1].div(lin[0])), ["fn", "lnabs", n[2]]], v);
    }
    if (k === "pow" && n[2][0] === "num" && neq(n[1], x)) {
      const q = n[2][1];
      if (q.eq(MINUS1)) return ["fn", "lnabs", x];
      return simp(["mul", num(F1.div(q.add(F1))), ["pow", x, num(q.add(F1))]], v);
    }
    if (k === "pow" && neq(n[1], ["const", "e"])) return integrateCore(["fn", "exp", n[2]], v);
    if (k === "fn") {
      const [, name, a] = n;
      if (name === "sqrt" && neq(a, x)) return simp(["mul", num(new Frac(2n, 3n)), ["pow", x, num(new Frac(3n, 2n))]], v);
      const lin = linear(a, v);
      if (lin !== null) {
        const kk = F1.div(lin[0]);
        if (name === "sin") return simp(["mul", num(kk.neg()), ["fn", "cos", a]], v);
        if (name === "cos") return simp(["mul", num(kk), ["fn", "sin", a]], v);
        if (name === "exp") return simp(["mul", num(kk), ["fn", "exp", a]], v);
        if (name === "tan") return simp(["mul", num(kk.neg()), ["fn", "lnabs", ["fn", "cos", a]]], v);
      }
    }
    throw new CalcError("integral_unsupported");
  }

  function antiderivative(n, v, steps, t) {
    n = simp(n, v);
    const p = toPoly(n, v);
    if (p !== null) {
      const result = integratePoly(p, v);
      steps.push(fill(t.i_power, { f: show(n), F: show(result), v }));
      return result;
    }
    const ts = splitTerms(n);
    if (ts.length > 1) steps.push(t.i_linear);
    let total = null;
    for (const [sign, term] of ts) {
      let [c, core] = constFactor(term, v);
      c = c.mul(sign);
      const part = simp(["mul", num(c), integrateCore(core, v)], v);
      steps.push(fill(t.i_term, { f: show(simp(["mul", num(c), core], v)), F: show(part), v }));
      total = total === null ? part : simp(["add", total, part], v);
    }
    return total;
  }

  function guards(n, v, out) {
    const k = n[0];
    if (k === "div") {
      const p = toPoly(n[2], v);
      if (p !== null) out.push(["den", p]);
    }
    if (k === "pow" && n[2][0] === "num" && n[2][1].sign() < 0) {
      const p = toPoly(n[1], v);
      if (p !== null) out.push(["den", p]);
    }
    if (k === "fn" && ["ln", "lnabs", "sqrt"].includes(n[1])) {
      const p = toPoly(n[2], v);
      if (p !== null) out.push([n[1] === "sqrt" ? "sqrt" : n[1] === "ln" ? "log" : "den", p]);
    }
    if (k === "neg" || k === "fn") guards(n[n.length - 1], v, out);
    else if (["add", "sub", "mul", "div", "pow"].includes(k)) {
      guards(n[1], v, out);
      guards(n[2], v, out);
    }
    return out;
  }

  function pfloat(p, x) {
    let acc = 0;
    if (!p.size) return acc;
    for (let d = Math.max(...p.keys()); d >= 0; d--) acc = acc * x + (p.get(d) || F0).toNumber();
    return acc;
  }

  function checkDomain(f, v, a, b) {
    const gs = guards(f, v, []);
    if (!gs.length) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (const [kind, p] of gs) {
      let previous = null;
      for (let i = 0; i < 201; i++) {
        const x = lo + (hi - lo) * i / 200;
        const value = pfloat(p, x);
        if (kind === "den" && (value === 0 || (previous !== null && (previous < 0) !== (value < 0)))) throw new CalcError("improper");
        if (kind === "log" && value <= 0) throw new CalcError("log_domain");
        if (kind === "sqrt" && value < 0) throw new CalcError("sqrt_negative");
        previous = value;
      }
    }
  }

  function parseExpr(tokens) {
    const s = new Stream(tokens);
    const node = symParser(s).expr();
    if (!s.done()) throw new CalcError("academic_syntax");
    return node;
  }
  const bound = (tokens) => simp(parseExpr(tokens), "x");

  function splitArgs(tokens) {
    const args = [];
    let depth = 0;
    let current = [];
    for (const tok of tokens) {
      if (tok === "(" || tok === "[" || tok === "{") depth++;
      else if (tok === ")" || tok === "]" || tok === "}") depth--;
      if (tok === "," && depth === 0) {
        args.push(current);
        current = [];
      } else current.push(tok);
    }
    args.push(current);
    return args;
  }

  function call(tokens, name) {
    if (tokens.length < 3 || tokens[0] !== name || tokens[1] !== "(" || tokens[tokens.length - 1] !== ")") throw new CalcError("academic_syntax");
    let depth = 0;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] === "(") depth++;
      if (tokens[i] === ")") depth--;
      if (depth === 0 && i !== tokens.length - 1) throw new CalcError("academic_syntax");
    }
    return splitArgs(tokens.slice(2, -1));
  }

  function vars(n, out) {
    const k = n[0];
    if (k === "var" && !out.includes(n[1])) out.push(n[1]);
    else if (k === "neg" || k === "fn") vars(n[n.length - 1], out);
    else if (["add", "sub", "mul", "div", "pow"].includes(k)) {
      vars(n[1], out);
      vars(n[2], out);
    }
    return out;
  }

  const prime = (order) => (order <= 3 ? "'".repeat(order) : `⁽${sup(order).split("⁻").join("")}⁾`);
  const boundValue = (node) => (node[0] === "num" ? [node[1], node[1].toNumber()] : [null, evalf(node, 0)]);
  const sameArgs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function solveCalculus(tokens, t) {
    const name = tokens[0];
    const args = call(tokens, name);
    const expr = parseExpr(args[0]);
    const names = vars(expr, []);
    let v = !names.length || names.includes("x") ? "x" : names[0];
    let rest = args.slice(1);
    if (rest.length && rest[0].length === 1 && rest[0][0].length === 1 && rest[0][0] >= "a" && rest[0][0] <= "z") {
      v = rest[0][0];
      rest = rest.slice(1);
    }
    const steps = [];
    let f = simp(expr, v);
    if (name === "limit" && expr[0] === "div") f = ["div", simp(expr[1], v), simp(expr[2], v)];
    if (name === "derivative") {
      let order = 1;
      if (rest.length) {
        if (rest.length !== 1 || rest[0].length !== 1 || !isNumber(rest[0][0]) || rest[0][0].includes(".")) throw new CalcError("academic_syntax");
        order = Number(rest[0][0]);
        if (order < 1 || order > 5) throw new CalcError("academic_syntax");
      }
      let current = f;
      for (let k = 1; k <= order; k++) {
        if (order > 1) steps.push(fill(t.d_order, { k }));
        current = derive(current, v, steps, t);
      }
      return { kind: "calculus", result: `f${prime(order)}(${v}) = ${show(current)}`, steps, table: [] };
    }
    if (name === "integral") {
      const big = antiderivative(f, v, steps, t);
      if (!rest.length) return { kind: "calculus", result: `F(${v}) = ${show(big)} + C`, steps, table: [] };
      if (rest.length !== 2) throw new CalcError("academic_syntax");
      const aNode = bound(rest[0]);
      const bNode = bound(rest[1]);
      const [qa, fa] = boundValue(aNode);
      const [qb, fb] = boundValue(bNode);
      checkDomain(f, v, fa, fb);
      const p = toPoly(big, v);
      let ta;
      let tb;
      let tr;
      if (p !== null && qa !== null && qb !== null) {
        let va = F0;
        let vb = F0;
        for (const [d, c] of p) {
          va = va.add(c.mul(qa.pow(d)));
          vb = vb.add(c.mul(qb.pow(d)));
        }
        [ta, tb, tr] = [qtext(va), qtext(vb), qtext(vb.sub(va))];
      } else {
        const va = evalf(big, fa);
        const vb = evalf(big, fb);
        [ta, tb, tr] = [fmt(va), fmt(vb), fmt(check(vb - va))];
      }
      steps.push(fill(t.i_value, { x: show(bNode), F: tb }));
      steps.push(fill(t.i_value, { x: show(aNode), F: ta }));
      steps.push(fill(t.i_bounds, { a: show(aNode), b: show(bNode), Fa: ta, Fb: tb, r: tr }));
      return { kind: "calculus", result: `∫ = ${tr}`, steps, table: [] };
    }
    if (name !== "limit" || rest.length !== 1) throw new CalcError("academic_syntax");
    const target = rest[0];
    let result;
    let targetText;
    if (sameArgs(target, ["inf"]) || sameArgs(target, ["infinity"]) || sameArgs(target, ["+", "inf"])) {
      result = limitInf(f, v, 1, steps, t);
      targetText = "∞";
    } else if (sameArgs(target, ["-", "inf"]) || sameArgs(target, ["-", "infinity"])) {
      result = limitInf(f, v, -1, steps, t);
      targetText = "-∞";
    } else {
      const node = bound(target);
      result = limitAt(f, v, node, steps, t);
      targetText = show(node);
    }
    return { kind: "calculus", result: `lim ${v}→${targetText} ${show(f)} = ${result}`, steps, table: [] };
  }

  function ratio(f, v) {
    if (f[0] === "div") {
      const p = toPoly(f[1], v);
      const q = toPoly(f[2], v);
      if (p !== null && q !== null) return [p, q];
    }
    const p = toPoly(f, v);
    return p !== null ? [p, new Map([[0, F1]])] : null;
  }

  function peval(p, x) {
    let total = F0;
    for (const [d, c] of p) total = total.add(c.mul(x.pow(d)));
    return total;
  }

  function pdivideRoot(p, a) {
    const top = Math.max(...p.keys());
    const out = new Map();
    let carry = F0;
    for (let d = top; d > 0; d--) {
      carry = (p.get(d) || F0).add(carry.mul(a));
      out.set(d - 1, carry);
    }
    return pclean(out);
  }

  const lead = (p) => {
    const d = Math.max(...p.keys());
    return [d, p.get(d)];
  };
  const isUnit = (q) => q.size === 1 && q.has(0) && q.get(0).eq(F1);
  const ratioText = (p, q, v) => (isUnit(q) ? ptext(p, v) : `(${ptext(p, v)})/(${ptext(q, v)})`);

  function limitAt(f, v, node, steps, t) {
    const r0 = ratio(f, v);
    if (r0 !== null && node[0] === "num") {
      let [p, q] = r0;
      const a = node[1];
      const factor = ptext(!a.isZero() ? new Map([[1, F1], [0, a.neg()]]) : new Map([[1, F1]]), v);
      for (;;) {
        const pa = peval(p, a);
        const qa = peval(q, a);
        if (!qa.isZero()) {
          const r = pa.div(qa);
          steps.push(fill(t.l_direct, { f: ratioText(p, q, v), v, a: qtext(a), r: qtext(r) }));
          return qtext(r);
        }
        if (!pa.isZero()) break;
        steps.push(fill(t.l_zero, { factor }));
        p = pdivideRoot(p, a);
        q = pdivideRoot(q, a);
        steps.push(fill(t.l_cancel, { f: ratioText(p, q, v) }));
      }
      let m = 0;
      while (peval(q, a).isZero()) {
        q = pdivideRoot(q, a);
        m++;
      }
      const sign = peval(p, a).div(peval(q, a)).sign() > 0 ? 1 : -1;
      if (m % 2 === 0) {
        const r = sign > 0 ? "∞" : "-∞";
        steps.push(fill(t.l_inf, { p: qtext(peval(p, a)), r }));
        return r;
      }
      const [right, left] = sign > 0 ? ["∞", "-∞"] : ["-∞", "∞"];
      steps.push(fill(t.l_sides, { right, left }));
      return t.l_none;
    }
    const a = evalf(node, 0);
    try {
      const r = evalf(f, a);
      steps.push(fill(t.l_direct, { f: show(f), v, a: show(node), r: fmt(r) }));
      return fmt(r);
    } catch (e) {
      if (!(isCalcError(e))) throw e;
    }
    const h = 1e-6;
    let lv;
    let rv;
    try {
      lv = evalf(f, a - h);
      rv = evalf(f, a + h);
    } catch (e) {
      if (!(isCalcError(e))) throw e;
      throw new CalcError("limit_unsupported");
    }
    steps.push(fill(t.l_numeric, { left: fmt(a - h), right: fmt(a + h), lv: fmt(lv), rv: fmt(rv) }));
    if (Math.abs(lv - rv) > 1e-4 * Math.max(1, Math.abs(lv))) return t.l_none;
    return fmt(Math.floor(((lv + rv) / 2) * 1e8 + 0.5) / 1e8);
  }

  function limitInf(f, v, direction, steps, t) {
    const r0 = ratio(f, v);
    if (r0 === null) throw new CalcError("limit_unsupported");
    const [p, q] = r0;
    if (!p.size) {
      steps.push(fill(t.l_direct, { f: "0", v, a: direction > 0 ? "∞" : "-∞", r: "0" }));
      return "0";
    }
    const [dp, cp] = lead(p);
    const [dq, cq] = lead(q);
    steps.push(fill(t.l_leading, { p: ptext(new Map([[dp, cp]]), v), q: ptext(new Map([[dq, cq]]), v) }));
    if (dp < dq) return "0";
    if (dp === dq) return qtext(cp.div(cq));
    const sign = (cp.div(cq).sign() > 0 ? 1 : -1) * (direction ** (dp - dq));
    return sign > 0 ? "∞" : "-∞";
  }

  // --- Combinatorics -------------------------------------------------------------------------------------

  const COMB_WORDS = ["ncr", "npr", "choose", "binomial", "expand"];

  function intArg(tokens) {
    if (tokens.length !== 1 || !isNumber(tokens[0]) || tokens[0].includes(".")) throw new CalcError("comb_range");
    return Number(tokens[0]);
  }

  function comb(n, r) {
    let out = 1n;
    for (let i = 1; i <= r; i++) out = bfloorDiv(out * BigInt(n - r + i), BigInt(i));
    return out;
  }
  function fact(n) {
    let out = 1n;
    for (let i = 2; i <= n; i++) out *= BigInt(i);
    return out;
  }

  function monomial(n) {
    const k = n[0];
    if (k === "num") return [n[1], new Map()];
    if (k === "var") return [F1, new Map([[n[1], 1]])];
    if (k === "neg") {
      const [c, vs] = monomial(n[1]);
      return [c.neg(), vs];
    }
    if (k === "pow" && n[1][0] === "var" && n[2][0] === "num" && n[2][1].isInt() && n[2][1].sign() > 0) {
      return [F1, new Map([[n[1][1], Number(n[2][1].n)]])];
    }
    if (k === "div" && n[2][0] === "num" && !n[2][1].isZero()) {
      const [c, vs] = monomial(n[1]);
      return [c.div(n[2][1]), vs];
    }
    if (k === "mul") {
      const [c1, v1] = monomial(n[1]);
      const [c2, v2] = monomial(n[2]);
      const out = new Map(v1);
      for (const [name, d] of v2) out.set(name, (out.get(name) || 0) + d);
      return [c1.mul(c2), out];
    }
    throw new CalcError("expand_unsupported");
  }

  function monoText(c, vs, first = true) {
    const names = [...vs.keys()].sort().filter((name) => vs.get(name) > 0)
      .map((name) => name + (vs.get(name) > 1 ? sup(vs.get(name)) : "")).join("");
    const mag = c.abs();
    let body;
    if (names) body = (mag.eq(F1) ? "" : mag.isInt() ? qtext(mag) : `(${qtext(mag)})`) + names;
    else body = qtext(mag);
    if (first) return (c.sign() < 0 ? "-" : "") + body;
    return (c.sign() < 0 ? " - " : " + ") + body;
  }

  function solveCombinatorics(tokens, t) {
    const steps = [];
    if (tokens[0] === "expand") {
      const args = call(tokens, "expand");
      if (args.length !== 1) throw new CalcError("academic_syntax");
      const node = parseExpr(args[0]);
      if (node[0] !== "pow" || node[2][0] !== "num" || !["add", "sub"].includes(node[1][0])) throw new CalcError("expand_unsupported");
      const nq = node[2][1];
      if (!nq.isInt() || nq.cmp(F1) < 0 || nq.cmp(Frac.of(12)) > 0) throw new CalcError("expand_unsupported");
      const n = Number(nq.n);
      const [ca, va] = monomial(node[1][1]);
      let [cb, vb] = monomial(node[1][2]);
      if (node[1][0] === "sub") cb = cb.neg();
      steps.push(fill(t.c_binomial, { a: monoText(ca, va), b: monoText(cb, vb), n }));
      const combined = new Map();
      const order = [];
      for (let k = 0; k <= n; k++) {
        const c = new Frac(comb(n, k)).mul(ca.pow(n - k)).mul(cb.pow(k));
        const vs = new Map();
        for (const [name, d] of va) vs.set(name, (vs.get(name) || 0) + d * (n - k));
        for (const [name, d] of vb) vs.set(name, (vs.get(name) || 0) + d * k);
        const key = [...vs.keys()].filter((name) => vs.get(name) > 0).sort().map((name) => `${name}:${vs.get(name)}`).join(",");
        steps.push(fill(t.c_term, { k, n, c: comb(n, k), term: monoText(c, vs) }));
        if (!combined.has(key)) {
          combined.set(key, [F0, vs]);
          order.push(key);
        }
        combined.get(key)[0] = combined.get(key)[0].add(c);
      }
      let out = "";
      for (const key of order) {
        const [c, vs] = combined.get(key);
        if (c.isZero()) continue;
        const clean = new Map([...vs].filter(([, d]) => d > 0));
        out += monoText(c, clean, !out);
      }
      return { kind: "combinatorics", result: out || "0", steps, table: [] };
    }
    let kind;
    let n;
    let r;
    if (["ncr", "npr", "binomial"].includes(tokens[0])) {
      const args = call(tokens, tokens[0]);
      if (args.length !== 2) throw new CalcError("academic_syntax");
      kind = tokens[0] === "npr" ? "npr" : "ncr";
      n = intArg(args[0]);
      r = intArg(args[1]);
    } else if (tokens.length === 3 && ["choose", "ncr", "npr"].includes(tokens[1])) {
      kind = tokens[1] === "npr" ? "npr" : "ncr";
      n = intArg([tokens[0]]);
      r = intArg([tokens[2]]);
    } else throw new CalcError("academic_syntax");
    if (!(r >= 0 && r <= n && n <= 1000)) throw new CalcError("comb_range");
    let result;
    let label;
    if (kind === "ncr") {
      result = comb(n, r);
      steps.push(fill(t.c_ncr, { n, r, k: n - r }));
      if (n <= 20) steps.push(`= ${fact(n)} / (${fact(r)} · ${fact(n - r)})`);
      label = `C(${n}, ${r})`;
    } else {
      result = fact(n) / fact(n - r);
      steps.push(fill(t.c_npr, { n, r, k: n - r }));
      if (n <= 20) steps.push(`= ${fact(n)} / ${fact(n - r)}`);
      label = `P(${n}, ${r})`;
    }
    steps.push(`= ${result}`);
    return { kind: "combinatorics", result: `${label} = ${result}`, steps, table: [] };
  }

  // --- Which module ------------------------------------------------------------------------------------

  function classify(text, tokens) {
    if (tokens.length && ["derivative", "integral", "limit"].includes(tokens[0])) return "calculus";
    if (tokens.some((tok) => COMB_WORDS.includes(tok))) return "combinatorics";
    if (tokens.includes("[") || tokens.some((tok) => LIN_FNS.includes(tok))) return "linalg";
    if (tokens.includes("{") || tokens.includes("\\") || tokens.some((tok) => SET_WORDS.includes(tok)) || (tokens.length && tokens[0] === "powerset")) return "sets";
    if (isLogic(tokens)) return "logic";
    return null;
  }

  function solve(text, cfg, language) {
    const lang = language === "ENGLISH" ? "ENGLISH" : "HEBREW";
    const t = texts(cfg, lang);
    let tokens;
    try {
      tokens = lex(text);
    } catch (e) {
      if (isCalcError(e)) return null;
      throw e;
    }
    const kind = classify(text, tokens);
    if (kind === null) return null;
    if (kind === "logic") {
      try {
        return solveLogic(tokens, t);
      } catch (e) {
        if (isCalcError(e) && e.key !== "logic_vars") return null;
        throw e;
      }
    }
    if (kind === "sets") return solveSets(tokens, t);
    if (kind === "linalg") return solveLinalg(tokens, t);
    if (kind === "calculus") return solveCalculus(tokens, t);
    return solveCombinatorics(tokens, t);
  }

  function formalOnly(text) {
    let tokens;
    try {
      tokens = lex(text);
    } catch (e) {
      return false;
    }
    return tokens.length > 0 && classify(text, tokens) !== null;
  }

  function hasConnective(text) {
    let tokens;
    try {
      tokens = lex(text);
    } catch (e) {
      return false;
    }
    return tokens.some((tok) => [...IFF_OPS, ...IMP_OPS, ...OR_OPS, ...XOR_OPS, ...AND_OPS].includes(tok));
  }

  window.FlomaCalcAcademic = { CalcError, normalize, basic, solve, formalOnly, hasConnective, Frac };
})();
