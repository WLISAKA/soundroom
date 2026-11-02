const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseLrc,
  lyricAt,
  normalizeTrack,
  httpUrl,
} = require("../electron/core.cjs");
const { QQProvider, check } = require("../electron/qq.cjs");
test("LRC timestamps, multiple tags and millisecond offsets remain synchronized", () => {
  const lines = parseLrc(
    "[ar:Artist]\n[offset:-500]\n[00:03.50][00:10.005]hello\n[01:00.00]world",
  );
  assert.deepEqual(lines, [
    { time: 3, text: "hello" },
    { time: 9.505, text: "hello" },
    { time: 59.5, text: "world" },
  ]);
  assert.equal(lyricAt(lines, 2), -1);
  assert.equal(lyricAt(lines, 9.6), 1);
});
test("song wrappers preserve real song, artist, album and media identifiers", () => {
  const track = normalizeTrack({
    songInfo: {
      mid: "abc",
      id: 123,
      title: "Test",
      singer: [{ mid: "artist", name: "Singer" }],
      album: { mid: "album", title: "Record" },
      file: { media_mid: "media" },
      interval: 180,
    },
  });
  assert.equal(track.mid, "abc");
  assert.equal(track.songId, 123);
  assert.equal(track.mediaMid, "media");
  assert.equal(track.albumMid, "album");
  assert.equal(track.artists[0].id, "artist");
});
test("unsafe media URL schemes and unacknowledged mutations are rejected", () => {
  assert.equal(httpUrl("javascript:alert(1)"), null);
  assert.equal(httpUrl("file:///C:/private.txt"), null);
  assert.throws(() => check({ code: 0 }, true), /未确认/);
  assert.throws(() => check({ retCode: 5 }, true));
});
test("unauthenticated mutation releases the write lock and never sends writes", async () => {
  const provider = new QQProvider({ cookies: { get: async () => [] } });
  await assert.rejects(provider.createPlaylist("Test"), /登录/);
  assert.equal(provider.busy, false);
  await assert.rejects(provider.createPlaylist("Test"), /登录/);
  assert.equal(provider.busy, false);
});
test("like operation verifies exact song identity and reads server state after writing", async () => {
  const provider = new QQProvider({});
  const calls = [];
  provider.auth = async () => ({ uin: "123", key: "test" });
  provider.rpc = async (module, method, param, options) => {
    calls.push({ module, method, param, options });
    if (method === "get_song_detail_yqq")
      return { track_info: { mid: "abc", id: 42, type: 0 } };
    if (method === "IsSongFanByMid") return { m_fan: { abc: true } };
    return { retCode: 0 };
  };
  assert.deepEqual(await provider.like({ mid: "abc", source: "qq" }, true), {
    liked: true,
  });
  assert.equal(calls[1].method, "AddSonglist");
  assert.equal(calls[1].param.dirId, 201);
  assert.deepEqual(calls[1].param.v_songInfo, [{ songId: 42, songType: 0 }]);
  assert.equal(calls[2].method, "IsSongFanByMid");
});
test("server rejection and unconfirmed likes never become local success", async () => {
  const provider = new QQProvider({});
  provider.auth = async () => ({ uin: "123", key: "test" });
  provider.rpc = async (_m, method) =>
    method === "get_song_detail_yqq"
      ? { track_info: { mid: "abc", id: 42, type: 0 } }
      : method === "IsSongFanByMid"
        ? { m_fan: { abc: false } }
        : { retCode: 0 };
  await assert.rejects(
    provider.like({ mid: "abc", source: "qq" }, true),
    /尚未确认/,
  );
  assert.equal(provider.busy, false);
});
test("account change blocks mutations before submitting a write", async () => {
  const provider = new QQProvider({});
  let calls = 0,
    written = false;
  provider.auth = async () => ({
    uin: ++calls === 1 ? "123" : "456",
    key: "test",
  });
  provider.rpc = async () => {
    written = true;
    return {};
  };
  await assert.rejects(provider.createPlaylist("Test"), /账号已变化/);
  assert.equal(written, false);
});
test("foreign or system playlists cannot be deleted", async () => {
  const provider = new QQProvider({});
  provider.auth = async () => ({ uin: "123", key: "test" });
  provider.rpc = async () => ({
    v_playlist: [{ tid: 55, uin: "456", dirId: 9 }],
  });
  await assert.rejects(provider.ownedPlaylist("55"), /未做修改/);
  provider.rpc = async () => ({
    v_playlist: [{ tid: 55, uin: "123", dirId: 201 }],
  });
  await assert.rejects(provider.ownedPlaylist("55"), /未做修改/);
});
