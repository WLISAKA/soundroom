const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  session,
  protocol,
  net,
  dialog,
  globalShortcut,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { atomicWrite, readJson, parseLrc } = require("./core.cjs");
const { registerPlayerShortcuts } = require("./shortcuts.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "soundroom",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (process.env.SOUNDROOM_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.SOUNDROOM_DATA_DIR));
const dataFile = () => path.join(app.getPath("userData"), "library.json");
let store,
  main,
  mini,
  tray,
  qq,
  loginWindow,
  quitting = false,
  lastPlayback = {},
  shortcuts = [],
  activeCollection,
  saveTimer;
const ownWindows = () => [main, mini].filter((w) => w && !w.isDestroyed());
const broadcast = (channel, data) =>
  ownWindows().forEach((w) => w.webContents.send(`soundroom:${channel}`, data));
const persist = () => atomicWrite(dataFile(), store);
const publicTrack = (t) => {
  const { path: _path, ...result } = t;
  return result;
};
function localTracks() {
  return store.local.map(publicTrack);
}
function trustedSender(event) {
  return (
    ownWindows().some((w) => w.webContents.id === event.sender.id) &&
    event.senderFrame === event.sender.mainFrame
  );
}
function register(name, action) {
  ipcMain.handle(`soundroom:${name}`, async (event, ...args) => {
    if (!trustedSender(event)) return { ok: false, error: "请求来源无效" };
    try {
      return { ok: true, data: await action(...args) };
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || "操作失败").replace(
          /(?:uin|qm_keyst|qqmusic_key|p_skey)=[^;\s]*/g,
          "[已隐藏]",
        ),
      };
    }
  });
}
function loadWindow(win, mode = "") {
  const dev = process.env.SOUNDROOM_DEV_URL;
  if (dev && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(dev))
    win.loadURL(`${dev}/#${mode}`);
  else win.loadFile(path.join(__dirname, "../dist/index.html"), { hash: mode });
}
function secureWindow(options) {
  const win = new BrowserWindow({
    backgroundColor: "#f6f7f9",
    icon: path.join(__dirname, "../assets/icon.ico"),
    ...options,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  return win;
}
function showMain() {
  if (!main || main.isDestroyed()) createMain();
  main.show();
  main.focus();
}
function createMain() {
  main = secureWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 660,
    frame: false,
    title: "声间 · Soundroom",
    show: false,
  });
  loadWindow(main);
  main.once("ready-to-show", () => main.show());
  main.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      main.hide();
    }
  });
  main.on("closed", () => {
    main = null;
  });
}
function toggleAux() {
  if (mini && !mini.isDestroyed()) {
    mini.close();
    return false;
  }
  const win = secureWindow({
    width: 600,
    height: 196,
    minWidth: 500,
    minHeight: 180,
    maxHeight: 260,
    backgroundColor: "#101d35",
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    title: "歌词小窗",
  });
  mini = win;
  loadWindow(win, "mini");
  win.on("closed", () => {
    mini = null;
  });
  return true;
}
function createTray() {
  const image = nativeImage.createFromPath(
    path.join(__dirname, "../assets/icon.ico"),
  );
  tray = new Tray(image.resize({ width: 24, height: 24 }));
  tray.setToolTip("声间 · Soundroom");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开声间", click: showMain },
      { type: "separator" },
      {
        label: "播放 / 暂停",
        click: () =>
          main?.webContents.send("soundroom:command", { name: "toggle" }),
      },
      {
        label: "上一首",
        click: () =>
          main?.webContents.send("soundroom:command", { name: "previous" }),
      },
      {
        label: "下一首",
        click: () =>
          main?.webContents.send("soundroom:command", { name: "next" }),
      },
      { label: "歌词小窗", click: () => toggleAux() },
      { type: "separator" },
      {
        label: "退出声间",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", showMain);
}
async function openLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "QQ 音乐 · 登录后关闭此窗口",
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:qqmusic",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const allow = (url) => {
    try {
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        (u.hostname === "qq.com" || u.hostname.endsWith(".qq.com"))
      );
    } catch {
      return false;
    }
  };
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allow(url)) loginWindow.loadURL(url);
    return { action: "deny" };
  });
  loginWindow.webContents.on("will-navigate", (event, url) => {
    if (!allow(url)) event.preventDefault();
  });
  loginWindow.on("closed", async () => {
    loginWindow = null;
    try {
      broadcast("account", await qq.account());
    } catch {
      broadcast("account", { loggedIn: false });
    }
  });
  await loginWindow.loadURL("https://y.qq.com/");
}
async function importLocal() {
  const result = await dialog.showOpenDialog(main, {
    title: "添加本地音乐",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "音乐",
        extensions: ["mp3", "flac", "m4a", "aac", "ogg", "wav", "opus"],
      },
    ],
  });
  if (result.canceled) return { tracks: localTracks(), skipped: [] };
  const { parseFile } = await import("music-metadata");
  const skipped = [];
  for (const file of result.filePaths) {
    if (store.local.some((t) => t.path === file)) continue;
    try {
      const meta = await parseFile(file, { duration: true });
      const picture = meta.common.picture?.[0];
      const cover =
        picture && picture.data.length < 2_000_000
          ? `data:${picture.format};base64,${Buffer.from(picture.data).toString("base64")}`
          : "";
      store.local.push({
        id: `local:${randomUUID()}`,
        source: "local",
        title: meta.common.title || path.basename(file, path.extname(file)),
        artist: meta.common.artist || "未知歌手",
        album: meta.common.album || "本地音乐",
        duration: meta.format.duration || 0,
        cover,
        path: file,
      });
    } catch {
      skipped.push(path.basename(file));
    }
  }
  persist();
  broadcast("library", localTracks());
  return { tracks: localTracks(), skipped };
}
async function localLyric(id) {
  const track = store.local.find((t) => t.id === id);
  if (!track) throw new Error("本地歌曲已移除");
  const lrcPath = track.path.replace(/\.[^.]+$/, ".lrc");
  try {
    return parseLrc(await fs.promises.readFile(lrcPath, "utf8"));
  } catch {
    return [];
  }
}
app.on("before-quit", () => {
  quitting = true;
  clearTimeout(saveTimer);
  if (store) {
    if (
      store.player &&
      lastPlayback.track?.id === store.player.currentId &&
      Number.isFinite(lastPlayback.position)
    )
      store.player.position = lastPlayback.position;
    persist();
  }
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on("second-instance", showMain);
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("local.soundroom.player");
      Menu.setApplicationMenu(null);
      store = readJson(dataFile(), { local: [], player: null });
      if (!Array.isArray(store.local)) store.local = [];
      const { QQProvider } = require("./qq.cjs");
      const qqSession = session.fromPartition("persist:qqmusic");
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      qqSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      qq = new QQProvider(qqSession);
      protocol.handle("soundroom", async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== "track")
          return new Response(null, { status: 404 });
        const track = store.local.find(
          (t) => t.id === decodeURIComponent(url.pathname.slice(1)),
        );
        if (!track) return new Response(null, { status: 404 });
        try {
          return await net.fetch(pathToFileURL(track.path).href, {
            headers: request.headers,
            method: request.method,
          });
        } catch {
          return new Response("文件不存在", { status: 404 });
        }
      });
      register("bootstrap", async () => ({
        local: localTracks(),
        player: store.player,
        account: await qq.account().catch(() => ({ loggedIn: false })),
        version: app.getVersion(),
        shortcuts,
      }));
      register("login", openLogin);
      register("logout", async () => {
        await qqSession.clearStorageData();
        broadcast("account", { loggedIn: false });
      });
      for (const method of [
        "account",
        "library",
        "collection",
        "search",
        "like",
        "likeStatus",
        "createPlaylist",
        "deletePlaylist",
        "editPlaylist",
      ])
        register(method, (...args) => qq[method](...args));
      register("collectionAll", async (kind, id, requestId) => {
        if (typeof requestId !== "string" || requestId.length > 100)
          throw new Error("歌单加载请求无效");
        if (activeCollection) activeCollection.cancelled = true;
        const job = { requestId, cancelled: false };
        activeCollection = job;
        try {
          return await qq.collectionAll(
            kind,
            id,
            (progress) => {
              if (!job.cancelled && main && !main.isDestroyed())
                main.webContents.send("soundroom:collection-progress", {
                  requestId,
                  ...progress,
                });
            },
            () => job.cancelled,
          );
        } finally {
          if (activeCollection === job) activeCollection = null;
        }
      });
      register("cancelCollection", (requestId) => {
        if (activeCollection?.requestId === requestId)
          activeCollection.cancelled = true;
      });
      register("playUrl", async (track) => {
        if (track?.source === "local") {
          const stored = store.local.find((t) => t.id === track.id);
          if (!stored || !fs.existsSync(stored.path))
            throw new Error("找不到音乐文件，请重新导入");
          return {
            url: `soundroom://track/${encodeURIComponent(stored.id)}`,
            quality: "本地",
          };
        }
        return qq.playUrl(track);
      });
      register("lyric", (track) =>
        track?.source === "local" ? localLyric(track.id) : qq.lyric(track),
      );
      register("importLocal", importLocal);
      register("removeLocal", (id) => {
        store.local = store.local.filter((t) => t.id !== id);
        persist();
        broadcast("library", localTracks());
        return localTracks();
      });
      register("savePlayer", (player) => {
        if (quitting) return true;
        if (
          !player ||
          !Array.isArray(player.queue) ||
          player.queue.length > 100000
        )
          throw new Error("队列无效");
        store.player = {
          queue: player.queue.map(publicTrack),
          currentId: String(player.currentId || ""),
          position: Math.max(0, Number(player.position) || 0),
          volume: Math.max(0, Math.min(1, Number(player.volume) || 0)),
          repeat: ["off", "all", "one"].includes(player.repeat)
            ? player.repeat
            : "all",
          shuffle: !!player.shuffle,
        };
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
        return true;
      });
      register("getPlayback", () => lastPlayback);
      register("resizeMini", (size) => {
        if (!mini || mini.isDestroyed()) return;
        const width = Number(size?.width),
          height = Number(size?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        mini.setSize(
          Math.max(500, Math.min(1400, Math.round(width))),
          Math.max(180, Math.min(260, Math.round(height))),
        );
      });
      register("window", (action) => {
        if (action === "minimize") main.minimize();
        else if (action === "maximize")
          main.isMaximized() ? main.unmaximize() : main.maximize();
        else if (action === "close") main.close();
        else if (action === "mini" || action === "lyrics") return toggleAux();
        else if (action === "show") showMain();
        else if (action === "close-mini") mini?.close();
        else if (action === "close-lyrics") mini?.close();
        else if (action === "quit") {
          quitting = true;
          app.quit();
        }
      });
      ipcMain.on("soundroom:playback", (event, data) => {
        if (event.sender !== main?.webContents) return;
        lastPlayback = data;
        broadcast("playback", data);
        if (tray)
          tray.setToolTip(
            data.track
              ? `${data.track.title} — ${data.track.artist}`.slice(0, 120)
              : "声间 · Soundroom",
          );
      });
      ipcMain.on("soundroom:command", (event, command) => {
        if (
          trustedSender(event) &&
          ["toggle", "next", "previous", "seek", "toggleShuffle"].includes(
            command?.name,
          )
        )
          main?.webContents.send("soundroom:command", command);
      });
      createMain();
      try {
        createTray();
      } catch {
        tray = null;
      }
      shortcuts = registerPlayerShortcuts(globalShortcut, (name) =>
        main?.webContents.send("soundroom:command", { name }),
      );
    })
    .catch((error) => {
      dialog.showErrorBox("声间启动失败", error.message);
      app.quit();
    });
}
