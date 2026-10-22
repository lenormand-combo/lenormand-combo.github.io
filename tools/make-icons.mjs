// アイコンを作る（公開しない道具）。実行: node tools/make-icons.mjs
// 図形だけで描く（絵文字は端末で見た目が変わるので使わない）。
// maskable 用に、絵柄は中央の直径 80% の円の内側に収める。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x2b, 0x23, 0x50];
const CARD = [0xf3, 0xe9, 0xd2];
const EDGE = [0xc9, 0xa1, 0x4a];
const STAR = [0xb0, 0x86, 0x2e];

// 形はすべて 0〜1 の座標で決める
const card = { x: 0.3, y: 0.2, w: 0.4, h: 0.6, r: 0.05 };
const edge = 0.012;
const star = (() => {
  const pts = [];
  const cx = 0.5;
  const cy = 0.5;
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? 0.14 : 0.035;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  return pts;
})();

function inRoundRect(x, y, { x: rx, y: ry, w, h, r }) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function colorAt(x, y) {
  if (inPolygon(x, y, star)) return STAR;
  const inner = { x: card.x + edge, y: card.y + edge, w: card.w - 2 * edge, h: card.h - 2 * edge, r: card.r - edge };
  if (inRoundRect(x, y, inner)) return CARD;
  if (inRoundRect(x, y, card)) return EDGE;
  return BG;
}

function render(size) {
  const SS = 4; // 4×4 の超標本化でなめらかにする
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      row[1 + px * 3] = Math.round(r / n);
      row[2 + px * 3] = Math.round(g / n);
      row[3 + px * 3] = Math.round(b / n);
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const S = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<rect width="${S}" height="${S}" fill="${hex(BG)}"/>
<rect x="${card.x * S}" y="${card.y * S}" width="${card.w * S}" height="${card.h * S}" rx="${card.r * S}" fill="${hex(EDGE)}"/>
<rect x="${(card.x + edge) * S}" y="${(card.y + edge) * S}" width="${(card.w - 2 * edge) * S}" height="${(card.h - 2 * edge) * S}" rx="${(card.r - edge) * S}" fill="${hex(CARD)}"/>
<polygon points="${star.map(([x, y]) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`).join(" ")}" fill="${hex(STAR)}"/>
</svg>
`;

writeFileSync(join(OUT, "icon.svg"), svg);
writeFileSync(join(OUT, "icon-192.png"), render(192));
writeFileSync(join(OUT, "icon-512.png"), render(512));
writeFileSync(join(OUT, "apple-touch-icon.png"), render(180));
console.log("icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png を書き出しました");
