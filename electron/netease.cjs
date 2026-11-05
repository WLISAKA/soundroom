const {
  createCipheriv,
  createHash,
  publicEncrypt,
  constants,
  randomBytes,
} = require("node:crypto");
const { httpUrl, parseLrc, qualityFallbacks } = require("./core.cjs");
const { loadCompleteCollection } = require("./collection-loader.cjs");

const origin = "https://music.163.com";
// Web protocol parameters from NeteaseCloudMusicApiEnhanced. See THIRD_PARTY_NOTICES.md.
const webKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;
function webForm(data) {
  const secret = randomBytes(8).toString("hex");
  const encrypt = (text, key) => {
    const cipher = createCipheriv("aes-128-cbc", key, "0102030405060708");
    return Buffer.concat([cipher.update(text), cipher.final()]).toString(
      "base64",
    );
  };
  const block = Buffer.alloc(128);
  Buffer.from(secret).reverse().copy(block, 112);
  return new URLSearchParams({
    params: encrypt(encrypt(JSON.stringify(data), "0CoJUm6Qyw8W8jud"), secret),
    encSecKey: publicEncrypt(
      { key: webKey, padding: constants.RSA_NO_PADDING },
      block,
    ).toString("hex"),
  });
}
function playerForm(endpoint, data) {
  const path = `/api/${endpoint}`;
  const body = JSON.stringify(data);
  const digest = createHash("md5")
    .update(`nobody${path}use${body}md5forencrypt`)
    .digest("hex");
  const payload = [path, body, digest].join("-36cd479b6b5-");
  const cipher = createCipheriv("aes-128-ecb", "e82ckenh8dichen8", null);
  return new URLSearchParams({
    params: Buffer.concat([cipher.update(payload), cipher.final()])
      .toString("hex")
      .toUpperCase(),
  });
}

const isId = (id) => /^[1-9]\d{0,15}$/.test(String(id));
const coverUrl = (value) => httpUrl(value)?.replace(/^http:/, "https:") || "";
function normalizeSong(song) {
  const album = song.al || song.album || {};
  const artists = (song.ar || song.artists || []).map((artist) => ({
    id: String(artist.id || ""),
    name: artist.name || "未知歌手",
  }));
  return {
    id: `netease:${song.id}`,
    songId: song.id,
    source: "netease",
    title: song.name || "未知歌曲",
    artist: artists.map((artist) => artist.name).join(" / ") || "未知歌手",
    artists,
    album: album.name || "未知专辑",
    albumMid: isId(album.id) ? String(album.id) : "",
    duration: (Number(song.dt ?? song.duration) || 0) / 1000,
    cover: coverUrl(album.picUrl),
  };
}
const tracksFrom = (songs) =>
  songs.filter((song) => isId(song?.id)).map(normalizeSong);

class NeteaseProvider {
  constructor(session) {
    this.session = session;
  }
  async auth(required = false) {
    const cookies = await this.session.cookies.get({ url: origin });
    const auth = Object.fromEntries(
      cookies.map(({ name, value }) => [name, value]),
    );
    if (required && !auth.MUSIC_U) throw new Error("请先登录网易云音乐");
    return auth;
  }
  async request(endpoint, params = {}, auth, player = false) {
    auth ??= await this.auth();
    const csrf = auth.__csrf || "";
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Referer: `${origin}/`,
    };
    let url = `${origin}/weapi/${endpoint}?csrf_token=${encodeURIComponent(csrf)}`;
    let form;
    if (player) {
      url = `https://interface3.music.163.com/eapi/${endpoint}`;
      const header = {
        os: "pc",
        appver: "8.0.0",
        __csrf: csrf,
        MUSIC_U: auth.MUSIC_U,
      };
      headers.Cookie = Object.entries(header)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
      form = playerForm(endpoint, { ...params, header });
    } else {
      form = webForm({ ...params, csrf_token: csrf });
    }
    let result;
    try {
      const response = await this.session.fetch(url, {
        method: "POST",
        credentials: "include",
        redirect: "error",
        headers,
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      result = await response.json();
    } catch {
      throw new Error("连接网易云音乐失败，请检查网络后重试");
    }
    if ([301, -462].includes(result?.code) && endpoint === "nuser/account/get")
      return {};
    if ([301, -462].includes(result?.code))
      throw new Error("网易云音乐登录已失效，请重新登录");
    if (result?.code !== 200)
      throw new Error(
        `网易云音乐暂时无法完成操作（${Number(result?.code) || "响应异常"}）`,
      );
    return result;
  }
  async account() {
    const auth = await this.auth();
    if (!auth.MUSIC_U) return { loggedIn: false };
    const { account, profile } = await this.request(
      "nuser/account/get",
      {},
      auth,
    );
    if (!isId(account?.id)) return { loggedIn: false };
    return {
      loggedIn: true,
      uin: String(account.id),
      nickname: profile?.nickname || "网易云音乐",
      avatar: coverUrl(profile?.avatarUrl),
    };
  }
  async library() {
    const auth = await this.auth(true);
    const account = await this.account();
    if (!account.loggedIn) throw new Error("请先登录网易云音乐");
    const playlists = new Map();
    let offset = 0;
    while (true) {
      const { playlist, more } = await this.request(
        "user/playlist",
        {
          uid: account.uin,
          limit: 100,
          offset,
          includeVideo: false,
        },
        auth,
      );
      if ((await this.auth()).MUSIC_U !== auth.MUSIC_U)
        throw new Error("网易云音乐账号已变化，请重新加载歌单");
      if (!Array.isArray(playlist)) throw new Error("未能读取网易云音乐歌单");
      const previousCount = playlists.size;
      for (const item of playlist) {
        if (!isId(item?.id)) continue;
        playlists.set(String(item.id), {
          id: String(item.id),
          name: item.name || "歌单",
          cover: coverUrl(item.coverImgUrl),
          count: Number(item.trackCount) || 0,
          dirId: 0,
          kind: String(item.userId) === account.uin ? "created" : "collected",
        });
      }
      if (!more) return [...playlists.values()];
      if (previousCount === playlists.size)
        throw new Error("网易云音乐歌单列表分页未更新，请刷新重试");
      offset += playlist.length;
    }
  }
  async search(query, page = 1) {
    const term = String(query || "")
      .trim()
      .slice(0, 120);
    if (!term) return { tracks: [], total: 0, hasMore: false };
    const offset = (Math.max(1, Math.floor(Number(page) || 1)) - 1) * 40;
    const { result } = await this.request("search/get", {
      s: term,
      type: 1,
      limit: 40,
      offset,
      total: true,
    });
    const songs = result?.songs || [];
    const total = Number(result?.songCount) || songs.length;
    return {
      tracks: tracksFrom(songs),
      total,
      hasMore: songs.length > 0 && offset + songs.length < total,
    };
  }
  async collectionAll(kind, id, onProgress, cancelled) {
    if (!isId(id)) throw new Error("网易云音乐编号无效");
    if (kind === "album" || kind === "artist") {
      const isAlbum = kind === "album";
      const data = await this.request(
        isAlbum ? `v1/album/${id}` : `v1/artist/${id}`,
      );
      const info = isAlbum ? data.album : data.artist;
      const tracks = tracksFrom(
        isAlbum ? data.songs || [] : data.hotSongs || [],
      );
      return {
        name: info?.name,
        cover: coverUrl(info?.picUrl),
        tracks,
        total: tracks.length,
        hasMore: false,
        complete: true,
      };
    }
    if (kind !== "playlist") throw new Error("网易云音乐页面类型无效");
    const auth = await this.auth(true);
    const { playlist } = await this.request(
      "v6/playlist/detail",
      { id, n: 100000 },
      auth,
    );
    if (!Array.isArray(playlist?.trackIds))
      throw new Error("未能读取网易云音乐歌单");
    const ids = playlist.trackIds.map((item) => item.id);
    if (Number(playlist.trackCount) > ids.length)
      throw new Error("网易云音乐未返回完整歌单，请刷新重试");
    return loadCompleteCollection(
      async (offset) => {
        const batch = ids.slice(offset, offset + 100);
        if ((await this.auth()).MUSIC_U !== auth.MUSIC_U)
          throw new Error("网易云音乐账号已变化，请重新加载歌单");
        const songs = batch.length
          ? (
              await this.request(
                "v3/song/detail",
                {
                  c: JSON.stringify(batch.map((id) => ({ id }))),
                  ids: JSON.stringify(batch),
                },
                auth,
              )
            ).songs
          : [];
        if ((await this.auth()).MUSIC_U !== auth.MUSIC_U)
          throw new Error("网易云音乐账号已变化，请重新加载歌单");
        if (!Array.isArray(songs))
          throw new Error("网易云音乐返回的歌曲数据不完整");
        const byId = new Map(
          tracksFrom(songs).map((track) => [track.songId, track]),
        );
        return {
          name: playlist.name || "歌单",
          cover: coverUrl(playlist.coverImgUrl),
          description: playlist.description || "",
          tracks: batch.map((id) => byId.get(id)).filter(Boolean),
          rawCount: batch.length,
          total: ids.length,
          totalKnown: true,
        };
      },
      onProgress,
      cancelled,
    );
  }
  async playUrl(track, preference) {
    if (!isId(track?.songId)) throw new Error("歌曲编号无效");
    const auth = await this.auth(true);
    const levels = {
      lossless: "lossless",
      high: "exhigh",
      higher: "higher",
      standard: "standard",
    };
    const labels = {
      lossless: "无损 · FLAC",
      exhigh: "HQ · 320 kbps",
      higher: "较高 · 192 kbps",
      standard: "标准 · 128 kbps",
    };
    const allowed = qualityFallbacks(preference).map(
      (quality) => levels[quality],
    );
    const candidates = new Map();
    for (const [index, level] of allowed.entries()) {
      if (candidates.has(level)) return candidates.get(level);
      const { data } = await this.request(
        "song/enhance/player/url/v1",
        {
          ids: JSON.stringify([Number(track.songId)]),
          level,
          encodeType: "flac",
        },
        auth,
        true,
      );
      const stream = data?.[0];
      const url = httpUrl(stream?.url);
      if (
        stream?.code === 200 &&
        url &&
        !stream.freeTrialInfo &&
        allowed.indexOf(stream.level) >= index
      ) {
        const result = { url, quality: labels[stream.level] };
        if (stream.level === level) return result;
        candidates.set(stream.level, result);
      }
    }
    throw new Error(
      "网易云音乐未提供符合偏好音质的完整资源，请确认账号与地区权限",
    );
  }
  async lyric(track) {
    if (!isId(track?.songId)) return [];
    const data = await this.request("song/lyric", {
      id: track.songId,
      lv: -1,
      tv: -1,
    });
    return parseLrc(data.lrc?.lyric);
  }
}
module.exports = { NeteaseProvider };
