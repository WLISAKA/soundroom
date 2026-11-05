const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "bootstrap",
  "login",
  "logout",
  "account",
  "library",
  "neteaseLibrary",
  "collection",
  "collectionAll",
  "cancelCollection",
  "search",
  "playUrl",
  "lyric",
  "importLocal",
  "removeLocal",
  "savePlayer",
  "like",
  "likeStatus",
  "createPlaylist",
  "deletePlaylist",
  "editPlaylist",
  "window",
  "getPlayback",
  "resizeMini",
];
const api = Object.fromEntries(
  methods.map((method) => [
    method,
    async (...args) => {
      const result = await ipcRenderer.invoke(`soundroom:${method}`, ...args);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  ]),
);
api.publish = (data) => ipcRenderer.send("soundroom:playback", data);
api.command = (name, value) =>
  ipcRenderer.send("soundroom:command", { name, value });
api.subscribe = (channel, callback) => {
  if (
    ![
      "playback",
      "command",
      "account",
      "netease-account",
      "library",
      "collection-progress",
    ].includes(channel)
  )
    return () => {};
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(`soundroom:${channel}`, handler);
  return () => ipcRenderer.removeListener(`soundroom:${channel}`, handler);
};
contextBridge.exposeInMainWorld("soundroom", api);
