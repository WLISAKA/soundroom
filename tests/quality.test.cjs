const assert = require("node:assert/strict");
const { test } = require("node:test");
const { QQProvider } = require("../electron/qq.cjs");
const { NeteaseProvider } = require("../electron/netease.cjs");

test("QQ falls back below HQ and never requests a higher tier than the preference", async () => {
  const provider = new QQProvider();
  provider.auth = async () => ({ uin: "123" });
  const requests = [];
  provider.rpc = async (_module, _method, { filename: [file] }) => {
    requests.push(file);
    const purl = file.startsWith("M800") ? "RS01fixture.flac" : file;
    return { midurlinfo: [{ purl }], sip: ["https://example.test/"] };
  };
  assert.equal(
    (await provider.playUrl({ mid: "fixture" })).quality,
    "较高 · 192 kbps",
  );
  assert.deepEqual(requests, ["M800fixture.mp3", "O600fixture.ogg"]);
  requests.length = 0;
  assert.equal(
    (await provider.playUrl({ mid: "fixture" }, "standard")).quality,
    "标准 · 128 kbps",
  );
  assert.deepEqual(requests, ["M500fixture.mp3"]);
});

test("NetEase picks the nearest lower full stream when the first response downgrades too far", async () => {
  const provider = new NeteaseProvider();
  provider.auth = async () => ({ MUSIC_U: "fixture" });
  const requests = [];
  provider.request = async (_endpoint, { level }) => {
    requests.push(level);
    return {
      data: [
        {
          code: 200,
          url: "https://example.test/track.mp3",
          level: level === "lossless" ? "standard" : level,
          freeTrialInfo: level === "exhigh" ? { end: 30 } : null,
        },
      ],
    };
  };
  const stream = await provider.playUrl({ songId: 123 }, "lossless");
  assert.equal(stream.quality, "较高 · 192 kbps");
  assert.deepEqual(requests, ["lossless", "exhigh", "higher"]);
});

test("NetEase rejects a higher stream and a preview at the selected minimum tier", async () => {
  const provider = new NeteaseProvider();
  provider.auth = async () => ({ MUSIC_U: "fixture" });
  for (const data of [
    { level: "exhigh" },
    { level: "standard", freeTrialInfo: { end: 30 } },
  ]) {
    provider.request = async () => ({
      data: [{ code: 200, url: "https://example.test/track.mp3", ...data }],
    });
    await assert.rejects(
      provider.playUrl({ songId: 123 }, "standard"),
      /完整资源/,
    );
  }
});
