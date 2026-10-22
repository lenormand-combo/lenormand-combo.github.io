// 実行: node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";
import "../data.js";
import "../logic.js";

const { LN } = globalThis;
const L = LN.logic;

test("正規化：全角・カタカナ・空白", () => {
  assert.equal(L.normalize("３　２４"), "3 24");
  assert.equal(L.normalize("ネズミ"), "ねずみ");
  assert.equal(L.normalize("  ＡＢ  "), "ab");
});

test("組のキーの正規化と検査", () => {
  assert.equal(L.pairKey(24, 3), "3-24");
  assert.equal(L.pairKey(3, 24), "3-24");
  assert.deepEqual(L.parsePairKey("3-24"), [3, 24]);
  for (const bad of ["24-3", "3-3", "0-5", "1-37", "03-5", "__proto__", "a-b", "1-2-3", ""]) {
    assert.equal(L.parsePairKey(bad), null, bad);
  }
});

test("カードの解決", () => {
  assert.equal(L.resolveCard("3"), 3);
  assert.equal(L.resolveCard("３"), 3);
  assert.equal(L.resolveCard("37"), null);
  assert.equal(L.resolveCard("船"), 3);
  assert.equal(L.resolveCard("いかり"), 35);
  assert.equal(L.resolveCard("イカリ"), 35);
  assert.equal(L.resolveCard("き"), 5); // 読みの完全一致が前方一致より先
  assert.equal(L.resolveCard("ほうき"), 11);
  assert.equal(L.resolveCard("こうのとり"), 17);
  assert.equal(L.resolveCard("くろ"), null); // クローバーとクロス（十字架）で決まらない
});

test("検索語の解釈", () => {
  assert.deepEqual(L.parseQuery("３　２４"), { type: "pair", a: 3, b: 24 });
  assert.deepEqual(L.parseQuery("3-24"), { type: "pair", a: 3, b: 24 });
  assert.deepEqual(L.parseQuery("船 太陽"), { type: "pair", a: 3, b: 31 });
  assert.deepEqual(L.parseQuery("船と太陽"), { type: "pair", a: 3, b: 31 });
  assert.deepEqual(L.parseQuery("コウノトリと塔"), { type: "pair", a: 17, b: 19 });
  assert.deepEqual(L.parseQuery("いかり"), { type: "card", a: 35 });
  assert.deepEqual(L.parseQuery("3"), { type: "card", a: 3 });
  assert.equal(L.parseQuery("引っ越し").type, "text");
  assert.equal(L.parseQuery("").type, "empty");
});

test("番号の検索は完全一致（3 で 13 や 23 は出ない）", () => {
  const q = L.parseQuery("3");
  assert.equal(q.type, "card");
  assert.equal(q.a, 3);
});

test("全文検索：手書きが先、自動合成が後", () => {
  const rows = L.filterRows(L.allPairs(), { terms: ["お金"] });
  assert.ok(rows.length > 0);
  const firstAuto = rows.findIndex((r) => !LN.pairs[r.key]);
  const lastHand = rows.map((r) => Boolean(LN.pairs[r.key])).lastIndexOf(true);
  assert.ok(firstAuto === -1 || lastHand < firstAuto);
  assert.ok(rows.some((r) => r.key === "23-34"));
});

test("全文検索：自分の読みも対象", () => {
  const user = Object.create(null);
  user["5-6"] = { myReading: "ふしぎなことば", memo: "" };
  const rows = L.filterRows(L.allPairs(), { terms: ["ふしぎな"], user });
  assert.deepEqual(rows.map((r) => r.key), ["5-6"]);
});

test("テーマと手書きのみの絞り込み", () => {
  const rows = L.filterRows(L.cardRows(28), { theme: "恋愛", handOnly: true });
  for (const r of rows) {
    assert.ok(LN.pairs[r.key]);
    assert.ok(LN.pairs[r.key].themes.includes("恋愛"));
  }
  assert.equal(L.cardRows(3).length, 35);
});

test("保存データの検査", () => {
  const now = 1_000_000;
  const raw = JSON.parse(
    '{"version":1,"pairs":{"__proto__":{"star":true},"3-24":{"star":true,"updatedAt":2000000,"extra":1},' +
      '"24-3":{"star":true},"1-37":{"star":true},"5-6":{"star":"yes"},"7-8":{"memo":"' +
      "あ".repeat(6000) +
      '","updatedAt":5}},"lastExport":"x"}',
  );
  const s = L.sanitizeStore(raw, now);
  assert.deepEqual(Object.keys(s.pairs).sort(), ["3-24", "7-8"]);
  assert.equal(s.pairs["3-24"].updatedAt, now); // 未来は今に丸める
  assert.equal(s.pairs["3-24"].extra, undefined);
  assert.equal(s.pairs["7-8"].memo.length, L.MAX_TEXT);
  assert.equal(s.lastExport, null);
  assert.equal(Object.getPrototypeOf(s.pairs), null);
  assert.equal({}.star, undefined); // プロトタイプが汚れていない
  assert.throws(() => L.sanitizeStore({ version: 2, pairs: {} }), /版/);
  assert.throws(() => L.parseImport("not json"), /JSON/);
  assert.throws(() => L.parseImport("x".repeat(L.MAX_IMPORT_BYTES + 1)), /大きすぎ/);
});

test("併合：updatedAt が新しいほうが残る", () => {
  const local = L.emptyStore();
  local.pairs["1-2"] = { star: true, flag: false, myReading: "古い", memo: "", baseRev: 0, updatedAt: 10 };
  local.pairs["3-4"] = { star: true, flag: false, myReading: "手元が新しい", memo: "", baseRev: 0, updatedAt: 50 };
  const inc = L.emptyStore();
  inc.pairs["1-2"] = { star: false, flag: false, myReading: "新しい", memo: "", baseRev: 0, updatedAt: 20 };
  inc.pairs["3-4"] = { star: false, flag: false, myReading: "古い", memo: "", baseRev: 0, updatedAt: 40 };
  inc.pairs["5-6"] = { star: true, flag: false, myReading: "", memo: "", baseRev: 0, updatedAt: 1 };
  const m = L.mergeStores(local, inc);
  assert.equal(m.pairs["1-2"].myReading, "新しい");
  assert.equal(m.pairs["3-4"].myReading, "手元が新しい");
  assert.ok(m.pairs["5-6"]);
});

test("画面の場所の解釈", () => {
  assert.deepEqual(L.parseHash(""), { view: "draw" });
  assert.deepEqual(L.parseHash("#c/3"), { view: "card", a: 3 });
  assert.deepEqual(L.parseHash("#p/24-3"), { view: "pair", a: 24, b: 3 });
  assert.deepEqual(L.parseHash("#fav"), { view: "fav" });
  for (const bad of ["#p/99-0", "#p/3-3", "#c/abc", "#p/03-1e1", "#c/37", "#%E0%A4%A", "#x"]) {
    assert.equal(L.parseHash(bad), null, bad);
  }
});
