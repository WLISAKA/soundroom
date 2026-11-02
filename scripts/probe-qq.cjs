const { QQProvider } = require("../electron/qq.cjs");
async function main(provider) {
  const diagnostics = await Promise.all(
    [
      "https://y.qq.com/",
      "https://c.y.qq.com/",
      "https://u.y.qq.com/cgi-bin/musicu.fcg",
    ].map(async (url) => {
      try {
        const response = await provider.session.fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        return { host: new URL(url).host, status: response.status };
      } catch (error) {
        return { host: new URL(url).host, error: error.message };
      }
    }),
  );
  console.log(JSON.stringify({ network: diagnostics }));
  const search = await provider.search("周杰伦");
  console.log(
    JSON.stringify({
      operation: "anonymous search",
      total: search.total,
      returned: search.tracks.length,
      sample: search.tracks[0]?.title,
    }),
  );
  const track = search.tracks[0];
  if (!track) throw new Error("搜索没有返回歌曲");
  for (const [kind, id] of [
    ["album", track.albumMid],
    ["artist", track.artists?.[0]?.id],
  ]) {
    if (!id) continue;
    const result = await provider.collection(kind, id);
    console.log(
      JSON.stringify({
        operation: kind,
        name: result.name,
        total: result.total,
        returned: result.tracks.length,
      }),
    );
  }
}
if (process.versions.electron) {
  const { app, session } = require("electron");
  app.setPath(
    "userData",
    require("node:path").join(__dirname, "../.runtime/network-probe"),
  );
  app.whenReady().then(async () => {
    let code = 0;
    try {
      await main(new QQProvider(session.fromPartition("qq-probe")));
    } catch (e) {
      console.error(e.message);
      code = 1;
    }
    app.exit(code);
  });
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require("node:child_process").spawn(
    require("electron"),
    [__filename],
    { env, stdio: "inherit" },
  );
  child.on("exit", (code) => {
    process.exitCode = code || 0;
  });
}
