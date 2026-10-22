/*
 * 画面とルーティング。data.js と logic.js を先に読み込む。
 * 文字はすべて textContent で出す（innerHTML は使わない）。
 */
(() => {
  const { LN } = globalThis;
  const L = LN.logic;
  const C = LN.cards;

  const STORE_KEY = "lenormand-combo:v1";
  const BACKUP_KEY = "lenormand-combo:v1:backup";
  const MAX_ROWS = 200;

  const state = {
    store: L.emptyStore(),
    storageOk: true,
    route: { view: "draw" },
    hash: "",
    query: "",
    theme: null,
    handOnly: false,
    lastDrawHash: "#draw",
    scroll: new Map(),
    pendingImport: null,
  };

  // ── DOM の組み立て ──
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "value") el.value = v;
        else if (k === "hidden") el.hidden = Boolean(v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // 記号は読み上げず、代わりの文字を読ませる
  function mark(cls, symbol, label) {
    return h("span", { class: `badge ${cls}` }, h("span", { "aria-hidden": "true", text: symbol }), h("span", { class: "sr-only", text: label }));
  }

  const toneLabel = (t) => (t === "中立" ? "中" : t);

  // ── 知らせ ──
  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ── 保存 ──
  function loadStore() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      state.storageOk = true;
    } catch {
      state.storageOk = false;
      return L.emptyStore();
    }
    if (!raw) return L.emptyStore();
    try {
      return L.sanitizeStore(JSON.parse(raw));
    } catch {
      return L.emptyStore();
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      state.storageOk = true;
      return true;
    } catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
      toast(quota ? "保存できませんでした。容量がいっぱいです。設定から書き出してください" : "この環境では保存できません");
      if (!quota) state.storageOk = false;
      return false;
    }
  }

  // 保存の直前に読み直し、その組だけを差し替える（別のタブの変更を消さない）
  function savePair(key, patch) {
    const fresh = loadStore();
    const cur = fresh.pairs[key] || { star: false, flag: false, myReading: "", memo: "", baseRev: 0, updatedAt: 0 };
    const next = L.sanitizeEntry({ ...cur, ...patch, updatedAt: Date.now() }, Date.now());
    if (next) fresh.pairs[key] = next;
    else delete fresh.pairs[key];
    const ok = writeStore(fresh);
    state.store = ok ? fresh : (() => {
      // 保存できなかったときも、画面の上では変更を保つ
      const s = state.store;
      if (next) s.pairs[key] = next;
      else delete s.pairs[key];
      return s;
    })();
    return ok;
  }

  function entryOf(key) {
    return state.store.pairs[key] || null;
  }

  // ── ルーティング ──
  function navigate(hash, { replace = false } = {}) {
    rememberScroll();
    const depth = (history.state && history.state.depth) || 0;
    if (replace) history.replaceState({ depth }, "", hash);
    else history.pushState({ depth: depth + 1 }, "", hash);
    route();
  }

  function rememberScroll() {
    if (state.hash) state.scroll.set(state.hash, window.scrollY);
  }

  function route() {
    const parsed = L.parseHash(location.hash);
    if (!parsed) {
      history.replaceState({ depth: (history.state && history.state.depth) || 0 }, "", "#draw");
      state.route = { view: "draw" };
    } else {
      state.route = parsed;
    }
    state.hash = location.hash || "#draw";
    if (state.route.view === "draw" || state.route.view === "card") state.lastDrawHash = state.hash;
    render();
    const y = state.scroll.get(state.hash) || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function goBack() {
    const depth = (history.state && history.state.depth) || 0;
    if (depth > 0) {
      rememberScroll();
      history.back();
      return;
    }
    const r = state.route;
    navigate(r.view === "pair" ? `#c/${r.a}` : "#draw", { replace: true });
  }

  // ── 描画 ──
  function render() {
    const view = document.getElementById("view");
    const r = state.route;
    let title = "ルノルマン・コンビ検索";
    let content;
    if (r.view === "pair") {
      content = renderPair(r.a, r.b);
      title = `${C[r.a].name} × ${C[r.b].name}`;
    } else if (r.view === "fav") {
      content = renderFav();
      title = "お気に入り";
    } else if (r.view === "settings") {
      content = renderSettings();
      title = "設定";
    } else {
      content = renderDraw();
      if (r.view === "card") title = `${r.a} ${C[r.a].name} と…`;
    }
    view.replaceChildren(content);
    document.getElementById("title").textContent = title;
    document.title = title === "ルノルマン・コンビ検索" ? title : `${title}｜ルノルマン・コンビ検索`;
    document.getElementById("back").hidden = r.view === "draw";
    const tab = r.view === "fav" ? "fav" : r.view === "settings" ? "settings" : "draw";
    for (const a of document.querySelectorAll(".tabs a")) {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  // ── 引く ──
  function tile(n, selected) {
    const c = C[n];
    return h(
      "button",
      {
        type: "button",
        class: "tile",
        "aria-label": `${n}番 ${c.name}`,
        "aria-pressed": selected ? "true" : "false",
        "data-no": n,
        onclick: () => onTile(n),
      },
      h("span", { class: "no", "aria-hidden": "true", text: n }),
      h("span", { class: "emoji", "aria-hidden": "true", text: c.emoji }),
      h("span", { class: "name", "aria-hidden": "true", text: c.name }),
    );
  }

  function onTile(n) {
    const r = state.route;
    if (r.view === "card") {
      if (n === r.a) navigate("#draw");
      else navigate(`#p/${r.a}-${n}`);
    } else {
      navigate(`#c/${n}`);
    }
  }

  function renderDraw() {
    const wrap = h("div", { class: "draw" });
    const input = h("input", {
      type: "search",
      id: "q",
      value: state.query,
      placeholder: "例：3 24／船 太陽／引っ越し",
      autocomplete: "off",
      enterkeyhint: "search",
      "aria-describedby": "q-help",
      oninput: (e) => {
        state.query = e.target.value;
        clearBtn.hidden = !state.query;
        renderDrawBody(body);
      },
    });
    const clearBtn = h("button", {
      type: "button",
      class: "icon-btn",
      "aria-label": "検索語を消す",
      hidden: !state.query,
      text: "×",
      onclick: () => {
        state.query = "";
        input.value = "";
        clearBtn.hidden = true;
        renderDrawBody(body);
        input.focus();
      },
    });
    wrap.append(
      h("div", { class: "search", role: "search" }, h("label", { for: "q", class: "sr-only", text: "カード・番号・言葉で検索" }), input, clearBtn),
      h("p", { id: "q-help", class: "sr-only", text: "番号2つ、カード名2つ、または言葉で探せます" }),
    );

    const chips = h("div", { class: "chips", role: "group", "aria-label": "絞り込み" });
    for (const t of LN.THEMES) {
      chips.append(
        h("button", {
          type: "button",
          class: "chip",
          "aria-pressed": state.theme === t ? "true" : "false",
          text: t,
          onclick: () => {
            state.theme = state.theme === t ? null : t;
            render();
          },
        }),
      );
    }
    chips.append(
      h("button", {
        type: "button",
        class: "chip",
        "aria-pressed": state.handOnly ? "true" : "false",
        text: "手書きのみ",
        onclick: () => {
          state.handOnly = !state.handOnly;
          render();
        },
      }),
    );
    wrap.append(chips);

    const body = h("div", { class: "draw-body" });
    renderDrawBody(body);
    wrap.append(body);
    return wrap;
  }

  function renderDrawBody(body) {
    const sel = state.route.view === "card" ? state.route.a : null;
    const q = L.parseQuery(state.query);
    const filters = { theme: state.theme, handOnly: state.handOnly, user: state.store.pairs };
    const out = [];

    if (q.type === "empty" && !sel && !state.theme && !state.handOnly) {
      const grid = h("div", { class: "grid" });
      for (let n = 1; n <= 36; n++) grid.append(tile(n, false));
      out.push(grid, h("p", { class: "hint", text: "1枚目をタップすると、そのカードとの組み合わせが一覧で出ます。続けて2枚目をタップすると、その組の読みが開きます。" }));
      body.replaceChildren(...out);
      return;
    }

    if (q.type === "empty" && sel) {
      // 1枚目を選んだ：1行に縮めたタイル＋35組
      const strip = h("div", { class: "strip", role: "group", "aria-label": "2枚目を選ぶ" });
      for (let n = 1; n <= 36; n++) strip.append(tile(n, n === sel));
      out.push(
        h(
          "div",
          { class: "selected-bar" },
          h("h2", null, `① ${C[sel].emoji} ${sel} ${C[sel].name} と…`),
          h("button", { type: "button", class: "icon-btn", "aria-label": "選択を解除", text: "×", onclick: () => navigate("#draw") }),
        ),
        strip,
      );
      const rows = L.filterRows(L.cardRows(sel), filters);
      out.push(rowsList(rows, sel));
      body.replaceChildren(...out);
      requestAnimationFrame(() => {
        const t = strip.querySelector(`[data-no="${sel}"]`);
        if (t) strip.scrollLeft = t.offsetLeft - strip.clientWidth / 2 + t.clientWidth / 2;
      });
      return;
    }

    // 検索中・絞り込み中はグリッドを隠す
    if (q.type === "pair") {
      out.push(h("p", { class: "hint", text: "この組み合わせ：" }), h("ul", { class: "rows" }, h("li", null, row(q.a, q.b, null, true))));
    } else {
      let rows;
      let heading;
      if (q.type === "card") {
        rows = L.filterRows(L.cardRows(q.a), filters);
        heading = `① ${C[q.a].emoji} ${q.a} ${C[q.a].name} と…`;
        out.push(h("div", { class: "selected-bar" }, h("h2", null, heading)));
        out.push(rowsList(rows, q.a));
      } else {
        const base = sel ? L.cardRows(sel) : L.allPairs();
        rows = L.filterRows(base, { ...filters, terms: q.type === "text" ? q.terms : [] });
        if (sel) out.push(h("div", { class: "selected-bar" }, h("h2", null, `① ${C[sel].emoji} ${sel} ${C[sel].name} の組から`), h("button", { type: "button", class: "icon-btn", "aria-label": "選択を解除", text: "×", onclick: () => navigate("#draw") })));
        out.push(h("p", { class: "hint", text: `${rows.length}件` }));
        out.push(rowsList(rows, sel));
      }
    }
    body.replaceChildren(...out);
  }

  function rowsList(rows, first) {
    if (!rows.length) return h("p", { class: "empty", text: "当てはまる組み合わせはありません。言葉を変えるか、絞り込みを外してください。" });
    const ul = h("ul", { class: "rows" });
    for (const r of rows.slice(0, MAX_ROWS)) {
      const a = first && r.b === first ? r.b : r.a;
      const b = a === r.a ? r.b : r.a;
      ul.append(h("li", null, row(a, b, first)));
    }
    const frag = document.createDocumentFragment();
    frag.append(ul);
    if (rows.length > MAX_ROWS) frag.append(h("p", { class: "more", text: `ほかに ${rows.length - MAX_ROWS} 件あります。言葉やテーマで絞り込んでください。` }));
    return frag;
  }

  function marksFor(a, b) {
    const key = L.pairKey(a, b);
    const e = entryOf(key);
    const hand = LN.pairs[key];
    const out = [];
    if (e && e.myReading) out.push(mark("kind-mine", "✎自分", "（自分の読みあり）"));
    else if (hand) out.push(mark("kind-hand", "手", "（手書きの読み）"));
    else out.push(mark("kind-auto", "自動", "（自動合成の読み）"));
    if (hand && hand.order) out.push(mark("order", "⇄", "（順序で意味が変わる）"));
    if (e && e.star) out.push(mark("star", "★", "（お気に入り）"));
    if (e && e.flag) out.push(mark("flag", "⚑", "（要修正）"));
    return out;
  }

  // first が指定されていれば、相手のカードだけを見出しに出す
  function row(a, b, first, pinned = false) {
    const key = L.pairKey(a, b);
    const e = entryOf(key);
    const summary = e && e.myReading ? firstLine(e.myReading) : L.reading(a, b).summary;
    const who = first
      ? h("span", { class: "who partner" }, h("span", { class: "emoji", "aria-hidden": "true", text: C[b].emoji }), `${b} ${C[b].name}`)
      : h("span", { class: "who" }, `${a} ${C[a].name} × ${b} ${C[b].name}`);
    return h(
      "button",
      { type: "button", class: `row${pinned ? " pinned" : ""}`, onclick: () => navigate(`#p/${a}-${b}`) },
      who,
      h("span", { class: "body" }, h("span", { class: "summary", text: summary }), h("span", { class: "marks" }, marksFor(a, b))),
    );
  }

  function firstLine(s) {
    const line = s.split(/\r?\n/).find((x) => x.trim()) || "";
    return line.length > 60 ? `${line.slice(0, 60)}…` : line;
  }

  // ── 組の詳細 ──
  function cardPanel(n) {
    const c = C[n];
    return h(
      "section",
      { class: "card-panel", "aria-label": `${n}番 ${c.name}` },
      h("div", { class: "head" }, h("span", { class: "emoji", "aria-hidden": "true", text: c.emoji }), h("h2", null, `${n} ${c.name}`)),
      h("div", { class: "meta" }, `${c.suit}　`, mark(`tone-${toneLabel(c.tone)}`, toneLabel(c.tone), "")),
      h("p", { text: c.meaning }),
      h("p", { class: "kw", text: `キーワード：${c.keywords.join("・")}` }),
      c.time ? h("p", { class: "kw", text: `時期：${c.time}` }) : null,
      c.note ? h("p", { class: "kw", text: `※ ${c.note}` }) : null,
    );
  }

  function renderPair(a, b) {
    const key = L.pairKey(a, b);
    const r = L.reading(a, b);
    const e = entryOf(key) || { star: false, flag: false, myReading: "", memo: "" };
    const wrap = h("div", { class: "pair" });

    wrap.append(
      h(
        "div",
        { class: "pair-cards" },
        cardPanel(a),
        h("button", { type: "button", class: "swap", "aria-label": "順序を入れ替える", text: "⇄", onclick: () => navigate(`#p/${b}-${a}`, { replace: true }) }),
        cardPanel(b),
      ),
    );

    if (e.myReading) {
      wrap.append(
        h("section", { class: "reading mine", "aria-label": "自分の読み" }, h("div", { class: "labels" }, mark("kind-mine", "✎自分", "（自分の読み）")), h("p", { class: "text", text: e.myReading })),
      );
    }

    const kind = r.kind === "hand" ? mark("kind-hand", "手書き", "") : mark("kind-auto", "自動合成", "");
    const box = h(
      "section",
      { class: "reading", "aria-label": e.myReading ? "元の読み" : "読み" },
      h("div", { class: "labels" }, e.myReading ? h("span", { class: "sub", text: "元の読み" }) : null, kind, mark(`tone-${r.tone}`, r.tone, "")),
      h("h3", { text: r.summary }),
      h("p", { text: r.text }),
    );
    if (r.order) {
      const ul = h("ul", { class: "orders", "aria-label": "順序で変わる意味" });
      const keys = Object.keys(r.order).sort((x, y) => (Number(x) === a ? -1 : Number(y) === a ? 1 : 0));
      for (const k of keys) ul.append(h("li", { class: Number(k) === a ? "now" : null, text: r.order[k] }));
      box.append(ul);
    }
    if (r.kind === "auto") {
      const rev = L.reading(b, a);
      box.append(
        h("p", { class: "sub", text: `逆の向き（${C[b].name}→${C[a].name}）：${rev.summary}` }),
        h("p", { class: "sub", text: "カードの意味を機械的に組み合わせた目安です。" }),
      );
    }
    wrap.append(box);

    const starBtn = h("button", {
      type: "button",
      id: "star-btn",
      class: "toggle star",
      "aria-pressed": e.star ? "true" : "false",
      text: e.star ? "★ お気に入り" : "☆ お気に入り",
      onclick: () => {
        const cur = entryOf(key);
        savePair(key, { star: !(cur && cur.star) });
        render();
        document.getElementById("star-btn")?.focus();
      },
    });
    const flagBtn = h("button", {
      type: "button",
      id: "flag-btn",
      class: "toggle flag",
      "aria-pressed": e.flag ? "true" : "false",
      text: e.flag ? "⚑ 要修正" : "⚐ 要修正",
      onclick: () => {
        const cur = entryOf(key);
        savePair(key, { flag: !(cur && cur.flag) });
        render();
        document.getElementById("flag-btn")?.focus();
      },
    });
    wrap.append(h("div", { class: "actions" }, starBtn, flagBtn));

    wrap.append(
      textField({
        id: "my",
        label: "自分の読み",
        value: e.myReading,
        placeholder: "自分の言葉で書いた読み。書くと一覧でもこちらが出ます",
        save: (v) => savePair(key, { myReading: v, baseRev: r.rev || 0 }),
        reset: true,
      }),
      textField({ id: "memo", label: "メモ", value: e.memo, placeholder: "気づいたことなど", save: (v) => savePair(key, { memo: v }) }),
    );
    return wrap;
  }

  function textField({ id, label, value, placeholder, save, reset = false }) {
    const status = h("span", { class: "saved", "aria-live": "polite" });
    const ta = h("textarea", { id, maxlength: L.MAX_TEXT, placeholder, value });
    let last = value;
    const commit = () => {
      if (ta.value === last) return;
      if (save(ta.value)) {
        last = ta.value;
        status.textContent = "保存しました";
      } else {
        status.textContent = "保存できませんでした";
      }
    };
    ta.addEventListener("blur", () => {
      const changed = ta.value !== last;
      commit();
      // 自分の読みは一覧や見出しにも出るので、保存したら描き直す（フォーカスが外れたあと）
      if (changed && id === "my") setTimeout(() => !isEditing() && render(), 0);
    });
    const actions = h("div", { class: "row-actions" }, status);
    if (reset) {
      actions.append(
        h("button", {
          type: "button",
          class: "small-btn",
          text: "リセット",
          onclick: () => {
            if (!ta.value && !last) return;
            if (!confirm("自分の読みを消して、元の読みに戻しますか？")) return;
            ta.value = "";
            commit();
            render();
          },
        }),
      );
    }
    return h("div", { class: "field" }, h("label", { for: id, text: label }), ta, actions);
  }

  function isEditing() {
    const a = document.activeElement;
    return Boolean(a && a.tagName === "TEXTAREA");
  }

  // ── お気に入り ──
  function renderFav() {
    const keys = Object.keys(state.store.pairs)
      .filter((k) => !L.isEmptyEntry(state.store.pairs[k]))
      .sort((x, y) => state.store.pairs[y].updatedAt - state.store.pairs[x].updatedAt);
    if (!keys.length) {
      return h(
        "div",
        null,
        h("p", { class: "empty", text: "まだありません。" }),
        h("p", { class: "note", text: "組み合わせの画面で ★ を付けたり、自分の読み・メモを書いたり、⚑（要修正）を付けたりすると、ここに新しい順で並びます。" }),
      );
    }
    const ul = h("ul", { class: "rows" });
    for (const k of keys) {
      const [a, b] = L.parsePairKey(k);
      ul.append(h("li", null, row(a, b, null)));
    }
    return h("div", null, h("p", { class: "hint", text: `${keys.length}件（新しい順）` }), ul);
  }

  // ── 設定 ──
  function renderSettings() {
    const wrap = h("div", { class: "settings" });
    const le = state.store.lastExport;

    if (!state.storageOk) {
      wrap.append(h("section", { class: "section" }, h("p", { class: "warn", text: "この環境ではデータを保存できません。プライベートブラウズを解除するか、別のブラウザで開いてください。" })));
    }

    const fileInput = h("input", {
      type: "file",
      accept: "application/json,.json",
      class: "sr-only",
      id: "import-file",
      onchange: onImportFile,
    });
    const importArea = h("div", { id: "import-area" });
    renderImportArea(importArea);

    wrap.append(
      h(
        "section",
        { class: "section", "aria-labelledby": "s-data" },
        h("h2", { id: "s-data", text: "データの書き出し・読み込み" }),
        h("p", { text: "★・自分の読み・メモ・要修正は、この端末のこのブラウザの中だけに保存されます。スマホと PC の間で移すときや、バックアップには書き出しを使ってください。書き出したファイルにはメモも含まれます。" }),
        h("p", { class: "note", text: `最後に書き出した日：${le ? new Date(le).toLocaleString("ja-JP") : "まだありません"}` }),
        h(
          "div",
          { class: "btns" },
          h("button", { type: "button", class: "btn", text: "書き出す", onclick: exportData }),
          h("label", { class: "btn ghost file-label", for: "import-file", tabindex: "0", role: "button", onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileInput.click()) }, "ファイルを読み込む"),
          fileInput,
        ),
        importArea,
        hasBackup() ? h("div", { class: "btns" }, h("button", { type: "button", class: "btn ghost", text: "直前の読み込みを取り消す", onclick: restoreBackup })) : null,
      ),
      h(
        "section",
        { class: "section", "aria-labelledby": "s-ios" },
        h("h2", { id: "s-ios", text: "iPhone・iPad で使うとき" }),
        h("ul", null,
          h("li", { text: "Safari の共有ボタンから「ホーム画面に追加」して、ホーム画面のアイコンから開いてください。" }),
          h("li", { text: "Safari で開いた場合とホーム画面から開いた場合では、保存データが別々になります。" }),
          h("li", { text: "しばらく使わないと、データが消えることがあります。ときどき書き出しておくと安心です。" }),
        ),
      ),
      h(
        "section",
        { class: "section", "aria-labelledby": "s-about" },
        h("h2", { id: "s-about", text: "このアプリについて" }),
        h("p", { text: "ルノルマンカード36枚の2枚組の意味を、リーディング中にすぐ引くためのアプリです。" }),
        h("ul", null,
          h("li", { text: "意味は特定の流派にこだわらず、広く使われている解釈を参考に、このアプリのために書き下ろしました。" }),
          h("li", { text: "「手」の印は手書きの読み、「自動」はカードの意味を機械的に組み合わせた目安です。自動の組は、自分の読みで上書きできます。" }),
          h("li", { text: "データは端末の中だけに保存し、外部へ送りません。" }),
          h("li", { text: "娯楽と自己内省のための参考情報です。医療・法律・金融の助言ではありません。" }),
          h("li", null, "誤りの報告：", h("a", { href: "https://github.com/lenormand-combo/lenormand-combo.github.io/issues", rel: "noopener", target: "_blank", text: "GitHub の Issues" })),
          h("li", { text: "ライセンス：プログラムは MIT License。文章は無断転載・複製・再配布を禁じます。" }),
        ),
        h("p", { class: "note", text: "© 2026 lenormand-combo" }),
      ),
    );
    return wrap;
  }

  function renderImportArea(area) {
    const p = state.pendingImport;
    if (!p) {
      area.replaceChildren();
      return;
    }
    const n = Object.keys(p.pairs).length;
    area.replaceChildren(
      h("p", { text: `読み込むデータ：${n}件。読み込み方を選んでください。` }),
      h(
        "div",
        { class: "btns" },
        h("button", { type: "button", class: "btn", text: "併合して読み込む", onclick: () => applyImport("merge") }),
        h("button", { type: "button", class: "btn ghost", text: "全部置き換える", onclick: () => applyImport("replace") }),
        h("button", { type: "button", class: "small-btn", text: "やめる", onclick: () => { state.pendingImport = null; render(); } }),
      ),
      h("p", { class: "note", text: "併合：組ごとに、新しく更新されたほうを残します。置き換え：いまのデータを消して、ファイルの内容にします。" }),
    );
  }

  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > L.MAX_IMPORT_BYTES) {
      toast("ファイルが大きすぎます（1MB まで）");
      return;
    }
    try {
      state.pendingImport = L.parseImport(await file.text());
      render();
    } catch (err) {
      toast(err && err.message ? err.message : "読み込めませんでした");
    }
  }

  function applyImport(mode) {
    const incoming = state.pendingImport;
    if (!incoming) return;
    if (mode === "replace" && !confirm("いまのデータを消して、ファイルの内容に置き換えますか？（直前のデータは1回分だけ取り消せます）")) return;
    const current = loadStore();
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(current));
    } catch {
      // 控えが取れなくても読み込みは続ける
    }
    const next = mode === "merge" ? L.mergeStores(current, incoming) : { ...incoming, lastExport: current.lastExport };
    if (writeStore(next)) {
      state.store = next;
      state.pendingImport = null;
      toast(mode === "merge" ? "併合して読み込みました" : "置き換えて読み込みました");
      render();
    }
  }

  function hasBackup() {
    try {
      return Boolean(localStorage.getItem(BACKUP_KEY));
    } catch {
      return false;
    }
  }

  function restoreBackup() {
    if (!confirm("直前の読み込みの前の状態に戻しますか？")) return;
    try {
      const prev = L.sanitizeStore(JSON.parse(localStorage.getItem(BACKUP_KEY)));
      if (writeStore(prev)) {
        localStorage.removeItem(BACKUP_KEY);
        state.store = prev;
        toast("読み込みの前に戻しました");
        render();
      }
    } catch {
      toast("戻せませんでした");
    }
  }

  function exportData() {
    const now = Date.now();
    const fresh = loadStore();
    const data = { app: "lenormand-combo", version: L.STORE_VERSION, exportedAt: new Date(now).toISOString(), pairs: fresh.pairs };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date(now);
    const pad = (x) => String(x).padStart(2, "0");
    const a = h("a", { href: url, download: `lenormand-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    fresh.lastExport = now;
    if (writeStore(fresh)) state.store = fresh;
    toast("書き出しました");
    render();
  }

  // ── 起動 ──
  function init() {
    state.store = loadStore();
    if (!history.state) history.replaceState({ depth: 0 }, "", location.hash || "#draw");

    history.scrollRestoration = "manual";
    window.addEventListener("popstate", () => {
      rememberScroll();
      route();
    });
    document.getElementById("back").addEventListener("click", goBack);
    for (const a of document.querySelectorAll(".tabs a")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const tab = a.dataset.tab;
        const target = tab === "draw" ? (state.route.view === "draw" || state.route.view === "card" ? "#draw" : state.lastDrawHash) : `#${tab}`;
        if (target === state.hash) return;
        navigate(target);
      });
    }

    // 別のタブの変更を取り込む。編集中は上書きしない
    window.addEventListener("storage", (e) => {
      if (e.key !== STORE_KEY) return;
      state.store = loadStore();
      if (isEditing()) toast("別のタブで変更がありました。編集を終えると反映されます");
      else {
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
      }
    });

    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch {
      // 使えない環境では何もしない
    }
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    route();
  }

  init();
})();
