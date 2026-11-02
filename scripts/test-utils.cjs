async function waitForValue(read, predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the actual player state");
}
function waitForPlayback(page, predicate, timeout) {
  return waitForValue(
    () => page.evaluate(() => window.soundroom.getPlayback()),
    predicate,
    timeout,
  );
}
module.exports = { waitForValue, waitForPlayback };
