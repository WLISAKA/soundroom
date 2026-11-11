const { _electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { waitForValue, waitForPlayback } = require("./test-utils.cjs");
const root = path.resolve(__dirname, "..");
const runtime = path.join(root, ".runtime", "collections-" + Date.now());
fs.mkdirSync(runtime, { recursive: true });
const wav = Buffer.alloc(44 + 22050 * 40 * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(22050, 24);
wav.writeUInt32LE(44100, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
const audioPath = path.join(runtime, "静音测试.wav");
fs.writeFileSync(audioPath, wav);
const env = { ...process.env, SOUNDROOM_DATA_DIR: path.join(runtime, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
async function launch() {
  const executablePath = process.env.SOUNDROOM_EXECUTABLE;
  const app = await _electron.launch({
    executablePath,
    args: executablePath ? [] : [root],
    env,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".boot-screen").waitFor({ state: "detached" });
  return { app, page };
}
async function openPlaylist(page, name) {
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "个人歌单", exact: true })
    .click();
  await page
    .locator(".playlist-grid")
    .getByRole("button", { name, exact: true })
    .click();
}
async function queueOf(page, count) {
  const data = await waitForValue(
    () => page.evaluate(() => window.soundroom.bootstrap()),
    (d) => d.player?.queue.length === count,
  );
  return data.player.queue;
}
async function main() {
  let { app, page } = await launch();
  try {
    if (process.env.SOUNDROOM_THEME === "nordic") {
      await page.evaluate(() => window.soundroom.setTheme("nordic"));
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "nordic",
      );
    }
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, audioPath);
    await page
      .locator(".sidebar nav")
      .getByRole("button", { name: "本地音乐", exact: true })
      .click();
    await page.getByRole("button", { name: "选择音乐文件" }).click();
    await page.locator(".track-row").waitFor();
    const stream = await page.evaluate(async () => {
      const data = await window.soundroom.bootstrap();
      return window.soundroom.playUrl(data.local[0]);
    });
    // Replace only QQ transport data in this isolated instance. Aggregation,
    // cancellation, progress IPC, rendering, audio, queue and persistence stay real.
    await app.evaluate(({ app }, stream) => {
      const { QQProvider } = process.mainModule.require(
        app.getAppPath() + "/electron/qq.cjs",
      );
      const fixture = (globalThis.collectionFixture = {
        calls: [],
        likes: [],
        configs: {
          111: { count: 251, name: "251首测试歌单" },
          222: { count: 5105, name: "5105首测试歌单" },
          333: { count: 251, name: "失败测试歌单", fail: true },
          444: { count: 2000, name: "取消测试歌单", delay: 300 },
        },
      });
      QQProvider.prototype.auth = async () => ({
        uin: "123",
        key: "fixture-only",
      });
      QQProvider.prototype.account = async () => ({
        loggedIn: true,
        uin: "123",
        nickname: "测试账号",
      });
      QQProvider.prototype.library = async () => ({
        created: Object.entries(fixture.configs).map(([id, c]) => ({
          id,
          name: c.name,
          count: c.count,
          kind: "created",
          dirId: Number(id),
          cover: "",
        })),
        collected: [],
        warnings: [],
      });
      QQProvider.prototype.likeStatus = async (mids) => {
        fixture.likes.push(mids.length);
        return Object.fromEntries(mids.map((mid) => [mid, false]));
      };
      QQProvider.prototype.lyric = async () => [];
      QQProvider.prototype.playUrl = async () => stream;
      QQProvider.prototype.collectionPage = async (_kind, id, offset) => {
        const config = fixture.configs[id];
        fixture.calls.push({ id, offset });
        if (config.delay)
          await new Promise((resolve) => setTimeout(resolve, config.delay));
        if (config.fail && offset >= 100) throw new Error("测试分页失败");
        const tracks = Array.from(
          { length: Math.min(100, config.count - offset) },
          (_, i) => {
            const n = offset + i + 1;
            return {
              id: "qq:" + id + "-" + n,
              mid: id + "-" + n,
              source: "qq",
              title: "歌曲" + n,
              artist: "测试歌手",
              album: config.name,
              duration: 40,
              cover: "",
            };
          },
        );
        return {
          name: config.name,
          tracks,
          rawCount: tracks.length,
          total: config.count,
          totalKnown: true,
          hasMore: offset + tracks.length < config.count,
        };
      };
    }, stream);
    await page.getByRole("button", { name: "偏好与信息", exact: true }).click();
    await page.getByRole("button", { name: "刷新账号", exact: true }).click();
    await page
      .locator(".account-button strong")
      .filter({ hasText: "测试账号" })
      .waitFor();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await openPlaylist(page, "251首测试歌单");
    await page
      .locator(".list-toolbar")
      .filter({ hasText: "共 251 首" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "载入更多" }).count(),
      0,
    );
    assert.ok(
      (await page.locator(".track-row").count()) < 100,
      "long lists must be virtualized",
    );
    const firstCalls = await app.evaluate(() =>
      globalThis.collectionFixture.calls
        .filter((c) => c.id === "111")
        .map((c) => c.offset),
    );
    assert.deepEqual(firstCalls, [0, 100, 200]);
    await page.getByRole("button", { name: "播放全部", exact: true }).click();
    await waitForPlayback(page, (s) => s.playing && s.track?.mid === "111-1");
    let queue = await queueOf(page, 251);
    assert.equal(queue.at(-1).mid, "111-251");
    await page.locator(".main-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.getByTitle("播放 歌曲251", { exact: true }).click();
    await waitForPlayback(page, (s) => s.track?.mid === "111-251" && s.playing);
    queue = await queueOf(page, 251);
    assert.equal(queue[0].mid, "111-1");
    await page.getByRole("button", { name: "播放队列", exact: true }).click();
    await page.locator(".queue-list").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page
      .locator(".queue-track strong")
      .filter({ hasText: /^歌曲251$/ })
      .waitFor();
    assert.ok((await page.locator(".queue-item").count()) < 100);
    await page.getByRole("button", { name: "清空队列", exact: true }).click();
    await page.getByRole("button", { name: "关闭队列", exact: true }).click();
    await page.locator(".main-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByRole("button", { name: "加入队列", exact: true }).click();
    await queueOf(page, 251);
    await openPlaylist(page, "5105首测试歌单");
    await page
      .locator(".list-toolbar")
      .filter({ hasText: "共 5105 首" })
      .waitFor();
    await page.getByTitle("播放 歌曲1", { exact: true }).click();
    await waitForPlayback(page, (s) => s.playing && s.track?.mid === "222-1");
    queue = await queueOf(page, 5105);
    assert.equal(queue.at(-1).mid, "222-5105");
    const likes = await app.evaluate(() => globalThis.collectionFixture.likes);
    assert.ok(
      likes.reduce((sum, n) => sum + n, 0) < 400,
      "only visible rows should request like status",
    );
    await openPlaylist(page, "失败测试歌单");
    await page
      .locator(".error-banner")
      .filter({ hasText: "测试分页失败" })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "播放全部", exact: true }).count(),
      0,
    );
    await queueOf(page, 5105);
    await app.evaluate(() => {
      globalThis.collectionFixture.configs["333"].fail = false;
    });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page
      .locator(".list-toolbar")
      .filter({ hasText: "共 251 首" })
      .waitFor();
    await openPlaylist(page, "取消测试歌单");
    await page
      .locator(".loading-state")
      .filter({ hasText: "100 / 2000" })
      .waitFor();
    await page
      .locator(".sidebar nav")
      .getByRole("button", { name: "音乐库", exact: true })
      .click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await page.locator("h1").textContent(), "音乐库");
    const cancelledCalls = await app.evaluate(
      () =>
        globalThis.collectionFixture.calls.filter((c) => c.id === "444").length,
    );
    assert.ok(cancelledCalls <= 2, "navigation must stop further pages");
    await waitForValue(
      () =>
        Promise.resolve(
          JSON.parse(fs.readFileSync(path.join(runtime, "data/library.json"))),
        ),
      (data) => data.player?.queue.length === 5105,
    );
    await app.close();
    ({ app, page } = await launch());
    queue = await queueOf(page, 5105);
    assert.equal(queue.at(-1).mid, "222-5105");
    assert.equal(
      (await page.evaluate(() => window.soundroom.getPlayback())).playing,
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          checks: [
            "251-song automatic aggregation",
            "play all queues entire playlist",
            "click last song preserves full queue",
            "add all to queue",
            "5105-song queue and restart persistence",
            "virtualized songs and queue",
            "failed pages do not queue partial results",
            "retry and navigation cancellation",
          ],
          dataDir: runtime,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close().catch(() => {});
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
