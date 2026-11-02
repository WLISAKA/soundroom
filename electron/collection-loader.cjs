// Complete a collection before exposing it as playable. Never return a partial
// result after a failed, cancelled or non-advancing upstream page.
async function loadCompleteCollection(
  readPage,
  onProgress = () => {},
  cancelled = () => false,
) {
  const tracks = new Map();
  let first,
    offset = 0,
    expectedTotal = null,
    skipped = 0;
  const guard = () => {
    if (cancelled()) throw new Error("已取消歌单加载");
  };
  while (true) {
    guard();
    const page = await readPage(offset);
    guard();
    if (!first) first = page;
    if (!Array.isArray(page.tracks))
      throw new Error("歌单歌曲数据不完整，请重试");
    if (page.totalKnown) {
      if (expectedTotal !== null && page.total !== expectedTotal)
        throw new Error("加载期间歌单内容发生变化，请刷新重试");
      expectedTotal = page.total;
    }
    const count = page.rawCount ?? page.tracks.length;
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("歌单分页数据无效");
    const previousCount = tracks.size;
    for (const track of page.tracks)
      if (!tracks.has(track.id)) tracks.set(track.id, track);
    skipped += count - page.tracks.length;
    if (page.tracks.length && tracks.size === previousCount)
      throw new Error("QQ 音乐重复返回了同一页，未能读取完整歌单，请重试");
    offset += count;
    onProgress({ loaded: tracks.size, total: expectedTotal, skipped });
    if (expectedTotal !== null && offset > expectedTotal)
      throw new Error("歌单返回的曲目数量不一致，请刷新重试");
    if (expectedTotal !== null ? offset === expectedTotal : count === 0) break;
    if (!count) throw new Error("QQ 音乐未返回歌单的剩余歌曲，请重试");
  }
  return {
    ...first,
    tracks: [...tracks.values()],
    total: expectedTotal ?? offset,
    skipped,
    hasMore: false,
    complete: true,
  };
}
module.exports = { loadCompleteCollection };
