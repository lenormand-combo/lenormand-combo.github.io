/*
 * 処理（画面に依存しない部分）。ブラウザと Node の両方で使う。
 * data.js を先に読み込んでおくこと（globalThis.LN.cards などを使う）。
 */
(() => {
  const LN = (globalThis.LN = globalThis.LN || {});

  const STORE_VERSION = 1;
  const MAX_TEXT = 5000;
  const MAX_IMPORT_BYTES = 1024 * 1024;
  const PERSONS = new Set([13, 28, 29]);
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  // ── 文字の正規化 ──
  // 全角→半角（NFKC）、小文字化、カタカナ→ひらがな、空白の整理
  function normalize(s) {
    return String(s ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── カード番号と組のキー ──
  function cardNo(v) {
    const s = String(v);
    if (!/^[1-9]\d?$/.test(s)) return null;
    const n = Number(s);
    return n >= 1 && n <= 36 ? n : null;
  }

  function pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  // "3-24" の形で、1≤a<b≤36 のときだけ [a, b] を返す
  function parsePairKey(key) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) return null;
    const m = /^([1-9]\d?)-([1-9]\d?)$/.exec(key);
    if (!m) return null;
    const a = cardNo(m[1]);
    const b = cardNo(m[2]);
    if (a === null || b === null || a >= b) return null;
    return [a, b];
  }

  // ── カードの解決 ──
  let cardTerms = null;
  function terms() {
    if (!cardTerms) {
      cardTerms = LN.cards.slice(1).map((c) => ({
        no: c.no,
        words: [c.name, c.yomi, ...c.aliases].map(normalize),
      }));
    }
    return cardTerms;
  }

  // 番号は完全一致。名前・読み・別名は完全一致を優先し、なければ前方一致で1枚に決まるときだけ
  function resolveCard(term) {
    const t = normalize(term);
    if (!t) return null;
    if (/^\d+$/.test(t)) return cardNo(t);
    const exact = terms().filter((c) => c.words.includes(t));
    if (exact.length === 1) return exact[0].no;
    if (exact.length > 1) return null;
    const prefix = terms().filter((c) => c.words.some((w) => w.startsWith(t)));
    return prefix.length === 1 ? prefix[0].no : null;
  }

  // ── 検索語の解釈 ──
  // 戻り値: {type:"empty"} | {type:"pair", a, b} | {type:"card", a} | {type:"text", terms}
  function parseQuery(q) {
    const t = normalize(q);
    if (!t) return { type: "empty" };
    const tokens = t.split(/[\s\-‐−–—・、,+×]+/).filter(Boolean);
    if (tokens.length === 1) {
      const tok = tokens[0];
      const c = resolveCard(tok);
      if (c) return { type: "card", a: c };
      // 「船と太陽」：「と」で分けて両方がカードに決まるとき
      for (let i = 1; i < tok.length - 1; i++) {
        if (tok[i] !== "と") continue;
        const a = resolveCard(tok.slice(0, i));
        const b = resolveCard(tok.slice(i + 1));
        if (a && b && a !== b) return { type: "pair", a, b };
      }
    } else if (tokens.length === 2) {
      const a = resolveCard(tokens[0]);
      const b = resolveCard(tokens[1]);
      if (a && b) return a === b ? { type: "card", a } : { type: "pair", a, b };
    }
    return { type: "text", terms: tokens };
  }

  // ── 読み ──
  function combineTone(a, b) {
    const tones = [LN.cards[a].tone, LN.cards[b].tone];
    const good = tones.includes("吉");
    const bad = tones.includes("注意");
    if (good && bad) return "混合";
    if (bad) return "注意";
    if (good) return "吉";
    return "中";
  }

  function commonThemes(a, b) {
    const tb = LN.cards[b].themes;
    return LN.cards[a].themes.filter((t) => tb.includes(t));
  }

  const ADVICE = {
    吉: "前向きな流れとして読めます。",
    注意: "焦らず状況を確かめながら進みましょう。",
    混合: "良い面と気をつけたい面の両方に目を向けましょう。",
    中: "まわりのカードと合わせて読みましょう。",
  };

  // 自動合成。a が1枚目、b が2枚目。要約は「〈a の名詞〉に〈b の名詞〉」、b が紳士・淑女なら「〈b の形容〉〈a の名詞〉」
  function synth(a, b) {
    const A = LN.cards[a];
    const B = LN.cards[b];
    const key = pairKey(a, b);
    const tone = combineTone(a, b);
    const themes = commonThemes(a, b);
    const alt = LN.banned.pairs.includes(key) || (PERSONS.has(a) && B.tone === "注意");
    let summary;
    let text;
    if (alt) {
      summary = `${A.name}と${B.name}`;
      text = PERSONS.has(a)
        ? `${A.name}が表す人が、「${B.noun}」に向き合う場面を示します。`
        : `${A.name}の「${A.noun}」と、${B.name}の「${B.noun}」が重なる場面を示します。`;
    } else {
      summary = B.adj ? `${B.adj}${A.noun}` : `${A.noun}に${B.noun}`;
      text = `${A.name}の「${A.noun}」に、${B.name}の「${B.keywords[0]}」の性質が加わる組み合わせです。`;
    }
    text += ADVICE[tone];
    if (themes.includes("健康") || themes.includes("お金")) text += "気になるときは専門家に相談しましょう。";
    return { kind: "auto", summary, text, themes, tone, rev: 0 };
  }

  // a, b は表示する順（タップ・入力した順）
  function reading(a, b) {
    const hand = LN.pairs[pairKey(a, b)];
    if (!hand) return synth(a, b);
    return {
      kind: "hand",
      summary: hand.summary,
      text: hand.text,
      themes: hand.themes,
      tone: combineTone(a, b),
      rev: hand.rev,
      order: hand.order || null,
    };
  }

  // ── 検索 ──
  function allPairs() {
    const out = [];
    for (let a = 1; a <= 36; a++) for (let b = a + 1; b <= 36; b++) out.push([a, b]);
    return out;
  }

  function cardRows(c) {
    const out = [];
    for (let o = 1; o <= 36; o++) if (o !== c) out.push([c, o]);
    return out;
  }

  const haystackCache = new Map();
  function baseHaystack(key) {
    let h = haystackCache.get(key);
    if (h === undefined) {
      const [a, b] = parsePairKey(key);
      const r = reading(a, b);
      const parts = [r.summary, r.text, ...(r.order ? Object.values(r.order) : [])];
      for (const n of [a, b]) {
        const c = LN.cards[n];
        parts.push(c.name, c.yomi, ...c.aliases, ...c.keywords);
      }
      h = normalize(parts.join(" "));
      haystackCache.set(key, h);
    }
    return h;
  }

  // rows: [[a,b], ...]。user: 保存データの pairs
  function filterRows(rows, { terms = [], theme = null, handOnly = false, user = null } = {}) {
    const words = terms.map(normalize).filter(Boolean);
    const out = [];
    for (const [a, b] of rows) {
      const key = pairKey(a, b);
      const hand = LN.pairs[key];
      if (handOnly && !hand) continue;
      if (theme) {
        const th = hand ? hand.themes : commonThemes(a, b);
        if (!th.includes(theme)) continue;
      }
      const u = user?.[key];
      if (words.length) {
        const h = `${baseHaystack(key)} ${normalize(`${u?.myReading || ""} ${u?.memo || ""}`)}`;
        if (!words.every((w) => h.includes(w))) continue;
      }
      out.push({ a, b, key, rank: u?.myReading || hand ? 0 : 1 });
    }
    // 自分の読み・手書きを先に、自動合成を後に（それぞれの中では元の順）
    return out.map((r, i) => ({ r, i })).sort((x, y) => x.r.rank - y.r.rank || x.i - y.i).map((x) => x.r);
  }

  // ── 保存データ ──
  function emptyStore() {
    return { version: STORE_VERSION, pairs: Object.create(null), lastExport: null };
  }

  function clampTime(v, now) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, now) : 0;
  }

  function sanitizeEntry(e, now) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const out = {
      star: e.star === true,
      flag: e.flag === true,
      myReading: typeof e.myReading === "string" ? e.myReading.slice(0, MAX_TEXT) : "",
      memo: typeof e.memo === "string" ? e.memo.slice(0, MAX_TEXT) : "",
      baseRev: Number.isInteger(e.baseRev) && e.baseRev >= 0 ? e.baseRev : 0,
      updatedAt: clampTime(e.updatedAt, now),
    };
    return isEmptyEntry(out) ? null : out;
  }

  function isEmptyEntry(e) {
    return !e || (!e.star && !e.flag && !e.myReading && !e.memo);
  }

  // 知らない version は例外。知らないキー・不正な組は捨てる
  function sanitizeStore(obj, now = Date.now()) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("データの形が正しくありません");
    if (obj.version !== STORE_VERSION) throw new Error("対応していない版のデータです");
    const store = emptyStore();
    const src = obj.pairs;
    if (src && typeof src === "object" && !Array.isArray(src)) {
      for (const key of Object.keys(src)) {
        if (!parsePairKey(key)) continue;
        const e = sanitizeEntry(src[key], now);
        if (e) store.pairs[key] = e;
      }
    }
    const le = clampTime(obj.lastExport, now);
    store.lastExport = le || null;
    return store;
  }

  function parseImport(text, now = Date.now()) {
    if (typeof text !== "string") throw new Error("ファイルを読めませんでした");
    if (text.length > MAX_IMPORT_BYTES) throw new Error("ファイルが大きすぎます（1MB まで）");
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("JSON として読めませんでした");
    }
    return sanitizeStore(obj, now);
  }

  // 組ごとに updatedAt が新しいほうを残す
  function mergeStores(local, incoming) {
    const out = emptyStore();
    out.lastExport = local.lastExport;
    for (const k of Object.keys(local.pairs)) out.pairs[k] = local.pairs[k];
    for (const k of Object.keys(incoming.pairs)) {
      const cur = out.pairs[k];
      if (!cur || incoming.pairs[k].updatedAt > cur.updatedAt) out.pairs[k] = incoming.pairs[k];
    }
    return out;
  }

  // ── 画面の場所（URL の # 以降）──
  // 戻り値: {view:"draw"} | {view:"card", a} | {view:"pair", a, b} | {view:"fav"} | {view:"settings"} | null（不正）
  function parseHash(hash) {
    let h;
    try {
      h = decodeURIComponent(String(hash || ""));
    } catch {
      return null;
    }
    if (h === "" || h === "#" || h === "#draw") return { view: "draw" };
    if (h === "#fav") return { view: "fav" };
    if (h === "#settings") return { view: "settings" };
    let m = /^#c\/([^/]+)$/.exec(h);
    if (m) {
      const a = cardNo(m[1]);
      return a ? { view: "card", a } : null;
    }
    m = /^#p\/([^-/]+)-([^-/]+)$/.exec(h);
    if (m) {
      const a = cardNo(m[1]);
      const b = cardNo(m[2]);
      return a && b && a !== b ? { view: "pair", a, b } : null;
    }
    return null;
  }

  LN.logic = {
    STORE_VERSION,
    MAX_TEXT,
    MAX_IMPORT_BYTES,
    normalize,
    cardNo,
    pairKey,
    parsePairKey,
    resolveCard,
    parseQuery,
    combineTone,
    synth,
    reading,
    allPairs,
    cardRows,
    filterRows,
    emptyStore,
    isEmptyEntry,
    sanitizeEntry,
    sanitizeStore,
    parseImport,
    mergeStores,
    parseHash,
  };
})();
