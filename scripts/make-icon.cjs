const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const size = 256;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const t = Buffer.from(type);
  let c = 0xffffffff;
  for (const v of Buffer.concat([t, data]))
    c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  const header = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  tail.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, t, data, tail]);
}
function rect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(right - radius, x)),
    cy = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
const pixels = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 4; dx++) {
        const xx = x + (dx + 0.5) / 4,
          yy = y + (dy + 0.5) / 4;
        if (!rect(xx, yy, 5, 5, 251, 251, 51)) continue;
        const white =
          rect(xx, yy, 69, 111, 87, 167, 9) ||
          rect(xx, yy, 105, 75, 123, 190, 9) ||
          rect(xx, yy, 141, 94, 159, 177, 9) ||
          rect(xx, yy, 177, 60, 195, 149, 9);
        r += white ? 244 : 16;
        g += white ? 249 : 77 + 20 * (1 - yy / size);
        b += white ? 255 : 192 + 30 * (1 - yy / size);
        a += 255;
      }
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const opacity = a / (255 * 16);
    if (opacity) {
      pixels[i] = r / (16 * opacity);
      pixels[i + 1] = g / (16 * opacity);
      pixels[i + 2] = b / (16 * opacity);
      pixels[i + 3] = opacity * 255;
    }
  }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
const dir = path.join(__dirname, "../assets");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "icon.png"), png);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader[6] = 0;
icoHeader[7] = 0;
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(dir, "icon.ico"), Buffer.concat([icoHeader, png]));
fs.writeFileSync(
  path.join(dir, "icon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="5" y="5" width="246" height="246" rx="51" fill="#1459d4"/><g fill="#f4f9ff"><rect x="69" y="111" width="18" height="56" rx="9"/><rect x="105" y="75" width="18" height="115" rx="9"/><rect x="141" y="94" width="18" height="83" rx="9"/><rect x="177" y="60" width="18" height="89" rx="9"/></g></svg>',
);
console.log("Created app icon");
