const { test } = require("node:test");
const assert = require("node:assert/strict");
const { QQProvider } = require("../electron/qq.cjs");
const { loadCompleteCollection } = require("../electron/collection-loader.cjs");
const tracks = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "qq:t" + i,
    mid: "t" + i,
    source: "qq",
    title: "Track " + i,
  }));
function pages(all, size = 100, known = true) {
  return async (offset) => ({
    name: "Playlist",
    tracks: all.slice(offset, offset + size),
    rawCount: Math.min(size, all.length - offset),
    total: known ? all.length : size,
    totalKnown: known,
    hasMore: known
      ? offset + size < all.length
      : all.slice(offset, offset + size).length === size,
  });
}
test("reads 251 songs in platform order and reports progress until complete", async () => {
  const all = tracks(251),
    offsets = [],
    progress = [];
  const page = pages(all);
  const result = await loadCompleteCollection(
    (offset) => {
      offsets.push(offset);
      return page(offset);
    },
    (p) => progress.push(p.loaded),
  );
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(progress, [100, 200, 251]);
  assert.deepEqual(result.tracks, all);
  assert.equal(result.hasMore, false);
  assert.equal(result.complete, true);
});
test("reads past the old 5000-song boundary without truncation", async () => {
  const all = tracks(5105);
  const result = await loadCompleteCollection(pages(all));
  assert.equal(result.tracks.length, 5105);
  assert.equal(result.tracks.at(-1).mid, "t5104");
});
test("exact multiples stop at the reported total; unknown totals probe an empty tail", async () => {
  const all = tracks(200);
  let knownCalls = 0,
    unknownCalls = 0;
  await loadCompleteCollection((offset) => {
    knownCalls++;
    return pages(all)(offset);
  });
  const result = await loadCompleteCollection((offset) => {
    unknownCalls++;
    return pages(all, 100, false)(offset);
  });
  assert.equal(knownCalls, 2);
  assert.equal(unknownCalls, 3);
  assert.equal(result.tracks.length, 200);
});
test("upstream page-size caps advance by actual rows, not the requested 100", async () => {
  const provider = new QQProvider({}),
    offsets = [];
  provider.auth = async () => ({ uin: "123", key: "fixture" });
  const all = Array.from({ length: 251 }, (_, i) => ({
    mid: "t" + i,
    id: i + 1,
    name: "Track " + i,
    singer: [],
  }));
  provider.rpc = async (_module, _method, param) => {
    offsets.push(param.song_begin);
    return {
      dirinfo: { title: "Playlist", songnum: 251 },
      songlist: all.slice(param.song_begin, param.song_begin + 50),
    };
  };
  const result = await provider.collectionAll("playlist", "1234");
  assert.deepEqual(offsets, [0, 50, 100, 150, 200, 250]);
  assert.equal(result.tracks.length, 251);
});
test("a failed later page never returns a playable partial collection", async () => {
  const read = pages(tracks(250));
  await assert.rejects(
    loadCompleteCollection((offset) => {
      if (offset === 100) throw new Error("network failure");
      return read(offset);
    }),
    /network failure/,
  );
});
test("zero count placeholders on nonempty pages do not truncate a collection", async () => {
  const provider = new QQProvider({});
  provider.auth = async () => ({ uin: "123", key: "fixture" });
  const all = Array.from({ length: 251 }, (_, i) => ({
    mid: "t" + i,
    id: i + 1,
    name: "Track " + i,
    singer: [],
  }));
  provider.rpc = async (_m, _n, param) => ({
    dirinfo: { title: "Playlist", songnum: 0 },
    songlist: all.slice(param.song_begin, param.song_begin + 50),
  });
  const result = await provider.collectionAll("playlist", "1234");
  assert.equal(result.tracks.length, 251);
  assert.equal(result.total, 251);
});
test("an early empty page and a repeated page are rejected", async () => {
  const all = tracks(250);
  await assert.rejects(
    loadCompleteCollection(async (offset) => ({
      ...(await pages(all)(offset)),
      ...(offset ? { tracks: [], rawCount: 0 } : {}),
    })),
    /剩余歌曲/,
  );
  await assert.rejects(
    loadCompleteCollection(() => pages(all)(0)),
    /重复返回/,
  );
});
test("detects a playlist edited while it is being loaded", async () => {
  const read = pages(tracks(250));
  await assert.rejects(
    loadCompleteCollection(async (offset) => ({
      ...(await read(offset)),
      total: offset ? 251 : 250,
    })),
    /内容发生变化/,
  );
});
test("navigation cancellation stops subsequent requests", async () => {
  let stopped = false,
    calls = 0;
  const read = pages(tracks(250));
  await assert.rejects(
    loadCompleteCollection(
      (offset) => {
        calls++;
        return read(offset);
      },
      () => {
        stopped = true;
      },
      () => stopped,
    ),
    /取消/,
  );
  assert.equal(calls, 1);
});
test("empty collections complete and unavailable metadata is counted", async () => {
  assert.equal((await loadCompleteCollection(pages([]))).tracks.length, 0);
  const result = await loadCompleteCollection(async (offset) =>
    offset === 0
      ? {
          tracks: [],
          rawCount: 100,
          totalKnown: true,
          total: 101,
          hasMore: true,
        }
      : {
          tracks: tracks(1),
          rawCount: 1,
          totalKnown: true,
          total: 101,
          hasMore: false,
        },
  );
  assert.equal(result.skipped, 100);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.complete, true);
});
test("a changed login account invalidates a pending collection", async () => {
  const provider = new QQProvider({});
  let authCalls = 0;
  provider.auth = async () => ({
    uin: ++authCalls >= 3 ? "456" : "123",
    key: "fixture",
  });
  provider.collectionPage = pages(tracks(250));
  await assert.rejects(provider.collectionAll("liked", ""), /账号已变化/);
});
