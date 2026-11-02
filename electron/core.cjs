const fs = require("node:fs");
const path = require("node:path");

function parseLrc(text = "") {
  let offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const content = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!content) continue;
    for (const m of line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)) {
      lines.push({
        time: Math.max(
          0,
          Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || 0}`) + offset,
        ),
        text: content,
      });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
function lyricAt(lines, time) {
  let left = 0,
    right = lines.length - 1,
    found = -1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      left = mid + 1;
    } else right = mid - 1;
  }
  return found;
}
function normalizeTrack(raw = {}) {
  const s = raw.track_info || raw.songInfo || raw.data || raw;
  const mid = String(s.mid || s.songmid || "");
  const album = s.album || {};
  const artists = s.singer || [];
  const albumMid = String(album.mid || s.albummid || "");
  return {
    id: `qq:${mid}`,
    mid,
    songId: Number(s.id || s.songid || 0),
    mediaMid: s.file?.media_mid || mid,
    title: s.title || s.name || s.songname || "未知歌曲",
    artist: artists.map((a) => a.name || a.title).join(" / ") || "未知歌手",
    artists: artists.map((a) => ({
      id: String(a.mid || a.id || ""),
      name: a.name || a.title,
    })),
    album: album.title || album.name || s.albumname || "未知专辑",
    albumMid,
    cover: albumMid
      ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
      : "",
    duration: Number(s.interval || 0),
    source: "qq",
  };
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function httpUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
module.exports = {
  parseLrc,
  lyricAt,
  normalizeTrack,
  atomicWrite,
  readJson,
  httpUrl,
};
