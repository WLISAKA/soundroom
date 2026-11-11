const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { waitForValue, waitForPlayback } = require("./test-utils.cjs");
const root = path.join(__dirname, "..");
const runtime = path.join(root, ".runtime", `smoke-${Date.now()}`);
const fixtures = path.join(runtime, "fixtures");
const theme = process.env.SOUNDROOM_THEME === "nordic" ? "nordic" : "classic";
const screenshots = path.join(root, ".runtime", "screenshots-" + theme);
fs.mkdirSync(fixtures, { recursive: true });
fs.mkdirSync(screenshots, { recursive: true });
function wav(name) {
  const rate = 22050,
    duration = 40,
    samples = rate * duration;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  const file = path.join(fixtures, `${name}.wav`);
  fs.writeFileSync(file, buffer);
  return file;
}
const files = [wav("晴空 · 播放测试"), wav("远方 · 队列测试")];
fs.writeFileSync(
  files[0].replace(".wav", ".lrc"),
  "[00:00.00]这是一段测试歌词\n[00:05.00]喜欢的声音，就在这里\n[00:20.00]让音乐继续",
);
const env = { ...process.env, SOUNDROOM_DATA_DIR: path.join(runtime, "data") };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
async function launch() {
  const executablePath = process.env.SOUNDROOM_EXECUTABLE;
  const app = await electron.launch({
    executablePath,
    args: executablePath ? [] : [root],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .locator(".boot-screen")
    .waitFor({ state: "detached", timeout: 30000 });
  return { app, page };
}
async function main() {
  let { app, page } = await launch();
  try {
    assert.equal(
      await page.evaluate(() => window.soundroom.getTheme()),
      "classic",
    );
    if (theme === "nordic") {
      await page
        .getByRole("button", { name: "偏好与信息", exact: true })
        .click();
      await page.getByRole("radio", { name: "北欧暖白" }).check();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "nordic",
      );
      await page.locator(".modal").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        animations: "disabled",
        path: path.join(screenshots, "settings.png"),
      });
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    }
    await page.screenshot({
      animations: "disabled",
      path: path.join(screenshots, "home.png"),
    });
    assert.equal(await page.locator("h1").textContent(), "音乐库");
    assert.equal(await page.locator(".quick-links > button").count(), 4);
    assert.equal(
      await page
        .locator(".hero, .welcome-panel, .side-motto, .home-footnote")
        .count(),
      0,
    );
    await app.evaluate(({ dialog }, selectedFiles) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: selectedFiles,
      });
    }, files);
    await page
      .locator(".sidebar nav")
      .getByRole("button", { name: "本地音乐", exact: true })
      .click();
    await page.getByRole("button", { name: "选择音乐文件" }).click();
    await page.locator(".track-row").nth(1).waitFor();
    assert.equal(await page.locator(".track-row").count(), 2);
    await page.getByTitle("播放 晴空 · 播放测试", { exact: true }).click();
    await waitForPlayback(page, (state) => state.playing === true);
    await page.locator('input[aria-label="播放进度"]').evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, "7");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() => window.soundroom.command("seek", 7));
    await waitForPlayback(page, (state) => state.position >= 7);
    assert.equal(
      await page.evaluate(
        async () => (await window.soundroom.getPlayback()).lyric,
      ),
      "喜欢的声音，就在这里",
    );
    await page.screenshot({
      animations: "disabled",
      path: path.join(screenshots, "local.png"),
    });
    await page.getByTitle("打开播放页").click();
    await page.locator(".lyric-line.current").waitFor();
    await page.screenshot({
      animations: "disabled",
      path: path.join(screenshots, "player.png"),
    });
    await page.getByRole("button", { name: "收起播放页" }).click();
    const miniPromise = app.waitForEvent("window");
    await page.getByRole("button", { name: "歌词小窗", exact: true }).click();
    const mini = await miniPromise;
    await mini.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    await mini.locator(".mini-meta strong").waitFor();
    await mini.waitForFunction(
      () =>
        document.querySelector(".mini-meta strong")?.textContent ===
        "晴空 · 播放测试",
    );
    const miniWindow = await app.browserWindow(mini);
    const geometry = await miniWindow.evaluate((win) => ({
      outer: win.getBounds(),
      content: win.getContentBounds(),
      shadow: win.hasShadow(),
    }));
    assert.equal(geometry.outer.width, geometry.content.width);
    assert.equal(geometry.outer.height, geometry.content.height);
    assert.equal(geometry.shadow, false);
    if (theme === "nordic") {
      const before = await page.evaluate(() => window.soundroom.getPlayback());
      await page.evaluate(() => window.soundroom.setTheme("classic"));
      await mini.waitForFunction(
        () => document.documentElement.dataset.theme === "classic",
      );
      await page.evaluate(() => window.soundroom.setTheme("nordic"));
      await mini.waitForFunction(
        () => document.documentElement.dataset.theme === "nordic",
      );
      const after = await page.evaluate(() => window.soundroom.getPlayback());
      assert.equal(after.track.id, before.track.id);
      assert.equal(after.playing, true);
      const fade = await mini
        .locator(".mini-cover")
        .evaluate((el) => getComputedStyle(el, "::after").backgroundImage);
      assert.ok(
        fade.includes("linear-gradient") && fade.includes("245, 240, 235"),
      );
      await mini.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await mini
          .locator(".mini-lyric-lines")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await mini.emulateMedia({ reducedMotion: "no-preference" });
      await miniWindow.evaluate((win) => win.setSize(500, 180));
      await mini.waitForFunction(
        () => innerWidth === 500 && innerHeight === 180,
      );
      const bar = await mini.locator(".mini-progress").boundingBox();
      const meta = await mini.locator(".mini-meta").boundingBox();
      const lyric = await mini.locator(".desktop-lyric").boundingBox();
      const controls = await mini.locator(".mini-bottom").boundingBox();
      assert.ok(bar.y + bar.height <= 180);
      assert.ok(meta.y + meta.height <= lyric.y);
      assert.ok(lyric.y + lyric.height <= controls.y);
      await miniWindow.evaluate((win) => win.setSize(600, 196));
      await mini.waitForFunction(
        () => innerWidth === 600 && innerHeight === 196,
      );
    }
    const mode = mini.getByRole("button", { name: "切换随机播放" });
    await mode.click();
    await waitForPlayback(page, (state) => state.shuffle === true);
    assert.equal(await mode.getAttribute("aria-pressed"), "true");
    assert.equal(
      await page
        .getByRole("button", { name: "随机播放", exact: true })
        .evaluate((button) => button.classList.contains("is-active")),
      true,
    );
    await page.getByRole("button", { name: "随机播放", exact: true }).click();
    await mini.waitForFunction(
      () =>
        document.querySelector(".mini-mode")?.getAttribute("aria-pressed") ===
        "false",
    );
    await mode.click();
    await waitForPlayback(page, (state) => state.shuffle === true);
    const miniWidth = await mini.evaluate(() => outerWidth);
    await mini.getByRole("button", { name: "调整小窗大小" }).focus();
    await mini
      .getByRole("button", { name: "调整小窗大小" })
      .press("ArrowRight");
    await mini.waitForFunction((width) => outerWidth === width + 10, miniWidth);
    await mini.evaluate(() => document.activeElement?.blur());
    await mini.screenshot({
      animations: "disabled",
      path: path.join(screenshots, "mini.png"),
    });
    await mini.getByTitle("暂停", { exact: true }).click();
    await waitForPlayback(page, (state) => state.playing === false);
    await mini.getByTitle("下一首", { exact: true }).click();
    await waitForPlayback(
      page,
      (state) => state.track?.title === "远方 · 队列测试",
    );
    await waitForPlayback(page, (state) => state.playing === true);
    await mini.getByTitle("上一首", { exact: true }).click();
    await waitForPlayback(
      page,
      (state) => state.track?.title === "晴空 · 播放测试",
    );
    assert.equal(
      await page.getByRole("button", { name: "桌面歌词", exact: true }).count(),
      0,
    );
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      2,
    );
    assert.equal(await mini.locator(".aux-brand").count(), 0);
    const coverBounds = await mini.locator(".mini-cover").boundingBox();
    const miniHeight = await mini.evaluate(() => innerHeight);
    assert.equal(coverBounds.y, 0);
    assert.equal(coverBounds.x, 0);
    assert.equal(Math.round(coverBounds.height), miniHeight);
    await mini.getByRole("slider", { name: "小窗播放进度" }).focus();
    await mini.getByRole("slider", { name: "小窗播放进度" }).press("Home");
    await waitForPlayback(page, (state) => state.position < 2);
    await page.evaluate(() => window.soundroom.command("seek", 8));
    await mini.waitForFunction(
      () =>
        document.querySelector(".desktop-lyric strong")?.textContent ===
        "喜欢的声音，就在这里",
    );
    await mini.evaluate(() => document.activeElement?.blur());
    await mini.screenshot({
      animations: "disabled",
      path: path.join(screenshots, "mini.png"),
    });
    await page.getByRole("button", { name: "关闭到托盘" }).click();
    const mainWindow = await app.browserWindow(page);
    for (
      let i = 0;
      i < 30 && (await mainWindow.evaluate((win) => win.isVisible()));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await mainWindow.evaluate((win) => win.isVisible()), false);
    const before = await page.evaluate(
      async () => (await window.soundroom.getPlayback()).position,
    );
    await waitForPlayback(page, (state) => state.position > before + 1);
    await page.evaluate(() => window.soundroom.window("show"));
    const security = await app.evaluate(({ BrowserWindow }) => {
      const prefs =
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        node: prefs.nodeIntegration,
        isolated: prefs.contextIsolation,
        sandbox: prefs.sandbox,
      };
    });
    assert.deepEqual(security, { node: false, isolated: true, sandbox: true });
    await page.evaluate(() => window.soundroom.command("seek", 12));
    await waitForPlayback(page, (state) => state.position >= 12);
    // Give the real periodic persistence path one cycle before graceful shutdown.
    await waitForValue(
      () => page.evaluate(() => window.soundroom.bootstrap()),
      (data) => data.player?.position >= 12,
    );
    await app.close();
    ({ app, page } = await launch());
    const saved = await page.evaluate(() => window.soundroom.bootstrap());
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    assert.equal(await page.evaluate(() => window.soundroom.getTheme()), theme);
    assert.equal(saved.local.length, 2);
    assert.equal(saved.player.queue.length, 2);
    assert.ok(saved.player.position >= 12);
    assert.equal(saved.player.shuffle, true);
    assert.equal(
      await page.locator(".play-button").getAttribute("aria-label"),
      "播放",
    );
    const startState = await page.evaluate(() =>
      window.soundroom.getPlayback(),
    );
    assert.ok(startState.position >= 12);
    assert.equal(startState.playing, false);
    if (theme === "nordic") {
      const win = await app.browserWindow(page);
      for (const [width, height] of [
        [940, 660],
        [1450, 900],
      ]) {
        await win.evaluate(
          (win, size) => win.setSize(...size),
          [width, height],
        );
        await page.waitForFunction((width) => innerWidth === width, width);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const accountBounds = await page
          .locator(".account-button")
          .boundingBox();
        const sidebarBounds = await page.locator(".sidebar").boundingBox();
        assert.ok(
          accountBounds.y + accountBounds.height <=
            sidebarBounds.y + sidebarBounds.height,
        );
        await page.getByRole("button", { name: "音乐库", exact: true }).click();
        await page.screenshot({
          animations: "disabled",
          path: path.join(screenshots, `home-${width}.png`),
        });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          theme,
          checks: [
            "appearance selection, shared window theme and restart persistence",
            "desktop startup",
            "native file import and metadata",
            "actual local audio playback",
            "seek and synchronized LRC",
            "mini player controls",
            "frameless native window and custom resizing",
            "two-way shuffle mode sync and persistence",
            "combined mini player and synchronized lyrics",
            "full-height album cover and mini player seeking",
            "tray background playback",
            "isolated renderers",
            "queue and progress recovery",
          ],
          screenshots,
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
