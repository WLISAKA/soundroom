const { spawn } = require("node:child_process");
const path = require("node:path");
async function start() {
  const { createServer } = await import("vite");
  const server = await createServer();
  await server.listen();
  const env = { ...process.env, SOUNDROOM_DEV_URL: "http://127.0.0.1:5173" };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [path.join(__dirname, "..")], {
    stdio: "inherit",
    env,
  });
  child.on("exit", async (code) => {
    await server.close();
    process.exit(code || 0);
  });
  process.on("SIGINT", () => child.kill());
}
start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
