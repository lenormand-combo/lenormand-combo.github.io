// データの整合性。組を足すたびに `node --test test/` を通す
import assert from "node:assert/strict";
import { test } from "node:test";
import "../data.js";
import "../logic.js";

const { LN } = globalThis;
const L = LN.logic;
const len = (s) => [...s].length;

test("カードは36枚で、番号と項目がそろっている", () => {
  assert.equal(LN.cards.length, 37);
  const names = new Set();
  for (let i = 1; i <= 36; i++) {
    const c = LN.cards[i];
    assert.equal(c.no, i);
    for (const f of ["name", "yomi", "suit", "emoji", "meaning", "noun"]) assert.ok(c[f], `${i} ${f}`);
    assert.ok(["吉", "注意", "中立"].includes(c.tone), `${i} tone`);
    for (const t of c.themes) assert.ok(LN.THEMES.includes(t), `${i} theme ${t}`);
    assert.ok(c.keywords.length > 0);
    assert.ok(!names.has(c.name));
    names.add(c.name);
  }
});

test("トランプ対応は重複しない", () => {
  const suits = LN.cards.slice(1).map((c) => c.suit);
  assert.equal(new Set(suits).size, 36);
});

test("手書きの組：キー・テーマ・順序注記・長さ", () => {
  for (const [key, p] of Object.entries(LN.pairs)) {
    const ab = L.parsePairKey(key);
    assert.ok(ab, `キー ${key}`);
    assert.ok(Number.isInteger(p.rev) && p.rev >= 1, `${key} rev`);
    assert.ok(Array.isArray(p.themes), `${key} themes`);
    for (const t of p.themes) assert.ok(LN.THEMES.includes(t), `${key} theme ${t}`);
    assert.ok(len(p.summary) <= 20, `${key} 要約 ${len(p.summary)}字`);
    assert.ok(len(p.text) <= 100, `${key} 解説 ${len(p.text)}字`);
    const sentences = p.text.split("。").filter(Boolean).length;
    assert.ok(sentences >= 2 && sentences <= 3, `${key} 解説の文の数 ${sentences}`);
    if (p.themes.includes("健康") || p.themes.includes("お金")) assert.ok(p.text.includes("専門家"), `${key} 専門家`);
    if (p.order) {
      for (const k of Object.keys(p.order)) assert.ok(ab.includes(Number(k)), `${key} 順序注記のキー ${k}`);
    }
  }
});

test("使わない語が、手書きにも自動合成にも入っていない", () => {
  const texts = [];
  for (const [key, p] of Object.entries(LN.pairs)) texts.push([key, `${p.summary} ${p.text} ${Object.values(p.order || {}).join(" ")}`]);
  for (let a = 1; a <= 36; a++) {
    const c = LN.cards[a];
    texts.push([`card ${a}`, `${c.meaning} ${c.noun} ${c.adj || ""} ${c.keywords.join(" ")}`]);
    for (let b = 1; b <= 36; b++) {
      if (a === b) continue;
      const r = L.synth(a, b);
      texts.push([`synth ${a}-${b}`, `${r.summary} ${r.text}`]);
    }
  }
  for (const [where, t] of texts) {
    for (const w of LN.banned.words) assert.ok(!t.includes(w), `${where} に「${w}」`);
    assert.ok(!t.includes("彼"), `${where} に彼・彼女`);
  }
});

test("手書きの組は約170組で、人物カードの組はすべてそろっている", () => {
  assert.ok(Object.keys(LN.pairs).length >= 170);
  for (const p of [28, 29]) {
    for (let i = 1; i <= 36; i++) {
      if (i === p) continue;
      const key = `${Math.min(i, p)}-${Math.max(i, p)}`;
      assert.ok(LN.pairs[key], `人物の組 ${key}`);
    }
  }
});
