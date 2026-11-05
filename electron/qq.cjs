const { createHash, randomBytes } = require("node:crypto");
const {
  normalizeTrack,
  parseLrc,
  httpUrl,
  qualityFallbacks,
} = require("./core.cjs");

// Signature protocol referenced from @sansenjian/qq-music-api (MIT).
// See THIRD_PARTY_NOTICES.md for attribution and license.
function sign(body) {
  const hash = createHash("sha1").update(body).digest("hex").toUpperCase();
  const pick = (indexes) => indexes.map((i) => hash[i]).join("");
  const key = [
    89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133,
    143, 161, 121, 179,
  ];
  const middle = Buffer.from(
    key.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16)),
  )
    .toString("base64")
    .replace(/[\\/+=]/g, "");
  return `zzc${pick([23, 14, 6, 36, 16, 7, 19])}${middle}${pick([16, 1, 32, 12, 19, 27, 8, 5])}`.toLowerCase();
}
function gtk(key = "") {
  let h = 5381;
  for (const c of key) h = (h + (h << 5) + c.charCodeAt(0)) | 0;
  return h & 0x7fffffff;
}
function check(payload, write = false) {
  const codes = [
    payload?.code,
    payload?.subcode,
    ...(write ? [payload?.retCode] : []),
  ].filter((v) => v !== undefined);
  if (codes.some((v) => Number(v) !== 0)) {
    const code = codes.find((v) => Number(v) !== 0);
    throw new Error(
      [301, 1000, 2000].includes(Number(code))
        ? `登录状态失效或接口要求重新验证，请重新登录（${code}）`
        : `QQ 音乐暂时无法完成操作（${code}）`,
    );
  }
  if (write && payload?.retCode === undefined)
    throw new Error("QQ 音乐未确认写入，请刷新后检查结果");
  return payload;
}
function playlist(raw, kind) {
  const id = String(raw.tid || raw.dissid || raw.id || "");
  return {
    id,
    name:
      raw.diss_name || raw.dissname || raw.title || raw.name || "未命名歌单",
    cover:
      httpUrl(
        raw.diss_cover ||
          raw.imgurl ||
          raw.picurl ||
          raw.logo ||
          raw.cover ||
          "",
      ) || "",
    count: Number(
      raw.song_cnt || raw.song_count || raw.songnum || raw.songnum || 0,
    ),
    dirId: Number(raw.dirid || raw.dirId || 0),
    kind,
  };
}
class QQProvider {
  constructor(session) {
    this.session = session;
    this.busy = false;
  }
  async auth(required = false) {
    const cookies = await this.session.cookies.get({
      url: "https://y.qq.com/",
    });
    const map = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
    const uin = String(map.uin || map.qqmusic_uin || "").replace(/^o0*/, "");
    const key = map.qqmusic_key || map.qm_keyst;
    if (required && (!/^\d+$/.test(uin) || !key))
      throw new Error("请先登录 QQ 音乐");
    return {
      uin,
      key,
      map,
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    };
  }
  async json(url, options = {}) {
    const auth = await this.auth();
    let response;
    try {
      response = await this.session.fetch(url, {
        ...options,
        headers: {
          Referer: "https://y.qq.com/",
          Origin: "https://y.qq.com",
          Cookie: auth.cookie,
          ...options.headers,
        },
        signal: AbortSignal.timeout(18000),
      });
    } catch {
      throw new Error("连接 QQ 音乐失败，请检查网络后重试");
    }
    if (!response.ok)
      throw new Error(`QQ 音乐请求失败（HTTP ${response.status}）`);
    const text = await response.text();
    try {
      return JSON.parse(
        text.replace(/^\s*[\w.]+\(/, "").replace(/\);?\s*$/, ""),
      );
    } catch {
      throw new Error("QQ 音乐返回了无法识别的数据，请稍后重试");
    }
  }
  async get(url, params) {
    const auth = await this.auth();
    const query = new URLSearchParams({
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      platform: "yqq.json",
      g_tk: String(gtk(auth.key)),
      ...params,
    });
    return check(await this.json(`${url}?${query}`));
  }
  async rpc(module, method, param, options = {}) {
    const auth = await this.auth(options.write);
    const payload = options.search
      ? { [module]: { module, method, param } }
      : {
          comm: {
            ct: 24,
            cv: 4747474,
            format: "json",
            uin: auth.uin || "0",
            authst: auth.key || "",
            platform: "yqq.json",
            g_tk: gtk(auth.map.skey || auth.key),
            g_tk_new_20200303: gtk(auth.key || auth.map.p_skey),
            inCharset: "utf-8",
            outCharset: "utf-8",
            notice: 0,
            needNewCode: 1,
          },
          req: { module, method, param },
        };
    const body = JSON.stringify(payload);
    const signed = options.signed;
    const response = check(
      await this.json(
        `https://u.y.qq.com/cgi-bin/${signed ? "musics" : "musicu"}.fcg${signed ? `?sign=${sign(body)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      ),
    );
    const block = response[options.search ? module : "req"];
    if (!block) throw new Error("QQ 音乐接口响应不完整");
    check(block);
    const data = block.data;
    if (!data || typeof data !== "object")
      throw new Error("QQ 音乐接口没有返回数据");
    return check(data, options.write);
  }
  async account() {
    const auth = await this.auth();
    if (!auth.key || !/^\d+$/.test(auth.uin)) return { loggedIn: false };
    const profile = await this.get(
      "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
      {
        cid: "205360838",
        userid: auth.uin,
        uin: auth.uin,
        loginUin: auth.uin,
        reqfrom: "1",
        reqtype: "0",
        hostUin: "0",
        needNewCode: "0",
      },
    );
    const p = profile.data?.creator;
    if (!p) throw new Error("登录状态未通过 QQ 音乐验证，请在登录窗口完成登录");
    return {
      loggedIn: true,
      uin: auth.uin,
      nickname: p.nick || p.nickname || "QQ 音乐用户",
      avatar: httpUrl(p.headpic || p.avatar) || "",
      verified: true,
    };
  }
  async library() {
    const { uin } = await this.auth(true);
    const results = await Promise.allSettled([
      this.get("https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss", {
        hostuin: uin,
        hostUin: "0",
        sin: "0",
        size: "1000",
        loginUin: uin,
        needNewCode: "0",
      }),
      this.get(
        "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg",
        {
          ct: "20",
          cid: "205360956",
          userid: uin,
          reqtype: "3",
          sin: "0",
          ein: "999",
        },
      ),
    ]);
    const warnings = [];
    function read(result, key, kind) {
      if (result.status === "rejected") {
        warnings.push(
          `${kind === "created" ? "个人歌单" : "收藏歌单"}：${result.reason.message}`,
        );
        return [];
      }
      const list = result.value.data?.[key];
      if (!Array.isArray(list)) {
        warnings.push("歌单数据格式发生变化，请稍后重试");
        return [];
      }
      return list
        .map((p) => playlist(p, kind))
        .filter(
          (p) =>
            /^\d+$/.test(p.id) &&
            p.dirId !== 201 &&
            ![202, 203, 204, 205, 206].includes(p.dirId),
        );
    }
    return {
      created: read(results[0], "disslist", "created"),
      collected: read(results[1], "cdlist", "collected"),
      warnings,
    };
  }
  async collection(kind, id, page = 0) {
    return this.collectionPage(
      kind,
      id,
      Math.max(0, Math.floor(Number(page) || 0)) * 100,
    );
  }
  async collectionAll(kind, id, onProgress, cancelled) {
    const { loadCompleteCollection } = require("./collection-loader.cjs");
    const initial = await this.auth(kind === "liked");
    return loadCompleteCollection(
      async (offset) => {
        const current = await this.auth(kind === "liked");
        if (initial.uin !== current.uin || initial.key !== current.key)
          throw new Error("登录账号已变化，请重新加载歌单");
        const result = await this.collectionPage(kind, id, offset);
        const after = await this.auth(kind === "liked");
        if (initial.uin !== after.uin || initial.key !== after.key)
          throw new Error("登录账号已变化，请重新加载歌单");
        return result;
      },
      onProgress,
      cancelled,
    );
  }
  async collectionPage(kind, id, offset = 0) {
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    const pageInfo = (raw, rawTotal) => {
      const known =
        rawTotal !== undefined &&
        rawTotal !== null &&
        Number.isSafeInteger(Number(rawTotal)) &&
        Number(rawTotal) >= 0 &&
        (Number(rawTotal) > 0 || (offset === 0 && raw.length === 0));
      const total = known ? Number(rawTotal) : raw.length;
      return {
        rawCount: raw.length,
        total,
        totalKnown: known,
        hasMore: known ? offset + raw.length < total : raw.length === 100,
      };
    };
    if (kind === "playlist" || kind === "liked") {
      if (kind === "liked") await this.auth(true);
      else if (!/^\d+$/.test(String(id))) throw new Error("歌单编号无效");
      const data = await this.rpc("music.srfDissInfo.DissInfo", "CgiGetDiss", {
        disstid: kind === "liked" ? 0 : Number(id),
        dirid: kind === "liked" ? 201 : 0,
        tag: true,
        song_begin: offset,
        song_num: 100,
        userinfo: true,
        orderlist: true,
        onlysonglist: false,
      });
      if (!Array.isArray(data.songlist)) throw new Error("未能读取歌单歌曲");
      const info = data.dirinfo || {};
      const tracks = data.songlist.map(normalizeTrack).filter((t) => t.mid);
      return {
        name: kind === "liked" ? "我的喜欢" : info.title || "歌单",
        cover: httpUrl(info.picurl || info.picurl2) || tracks[0]?.cover || "",
        description: info.desc || "",
        tracks,
        ...pageInfo(
          data.songlist,
          Number(info.songnum) > 0
            ? info.songnum
            : (data.total_song_num ?? info.songnum),
        ),
        dirId: Number(info.dirid || 0),
        owned: Number(info.owndir) === 1,
      };
    }
    if (!/^[a-zA-Z0-9]+$/.test(String(id))) throw new Error("编号无效");
    if (kind === "album") {
      const data = await this.rpc(
        "music.musichallAlbum.AlbumSongList",
        "GetAlbumSongList",
        { albumMid: id, albumID: 0, begin: offset, num: 100, order: 2 },
      );
      const tracks = (data.songList || [])
        .map(normalizeTrack)
        .filter((t) => t.mid);
      return {
        name: tracks[0]?.album || "专辑",
        cover: tracks[0]?.cover || "",
        tracks,
        ...pageInfo(data.songList || [], data.totalNum),
      };
    }
    if (kind === "artist") {
      const data = await this.rpc(
        "musichall.song_list_server",
        "GetSingerSongList",
        { singerMid: id, order: 1, begin: offset, num: 100 },
      );
      const tracks = (data.songList || [])
        .map(normalizeTrack)
        .filter((t) => t.mid);
      return {
        name: tracks[0]?.artists.find((a) => a.id === id)?.name || "歌手",
        cover: `https://y.gtimg.cn/music/photo_new/T001R500x500M000${id}.jpg`,
        tracks,
        ...pageInfo(data.songList || [], data.totalNum),
      };
    }
    throw new Error("页面类型无效");
  }
  async search(query, page = 1) {
    query = String(query || "")
      .trim()
      .slice(0, 120);
    if (!query) return { tracks: [], total: 0, hasMore: false };
    const data = await this.rpc(
      "music.search.SearchCgiService",
      "DoSearchForQQMusicDesktop",
      {
        search_type: 0,
        query,
        page_num: Math.max(1, Number(page) || 1),
        num_per_page: 40,
      },
      { search: true },
    );
    const songs = data.body?.song;
    if (!Array.isArray(songs?.list)) throw new Error("未能读取搜索结果");
    return {
      tracks: songs.list.map(normalizeTrack).filter((t) => t.mid),
      total: Number(songs.sum || songs.totalnum || songs.list.length),
      hasMore: songs.list.length === 40,
    };
  }
  async playUrl(track, preference) {
    if (!/^[a-zA-Z0-9]+$/.test(track?.mid || ""))
      throw new Error("歌曲编号无效");
    const { uin } = await this.auth(true);
    const mediaMid = /^[a-zA-Z0-9]+$/.test(track.mediaMid || "")
      ? track.mediaMid
      : track.mid;
    const guid = randomBytes(4).readUInt32BE().toString();
    const formats = {
      lossless: ["F000", "flac", "无损 · FLAC"],
      high: ["M800", "mp3", "HQ · 320 kbps"],
      higher: ["O600", "ogg", "较高 · 192 kbps"],
      standard: ["M500", "mp3", "标准 · 128 kbps"],
    };
    for (const level of qualityFallbacks(preference)) {
      const [prefix, extension, quality] = formats[level];
      const filename = `${prefix}${mediaMid}.${extension}`;
      const data = await this.rpc("vkey.GetVkeyServer", "CgiGetVkey", {
        guid,
        songmid: [track.mid],
        songtype: [0],
        uin,
        loginflag: 1,
        platform: "20",
        filename: [filename],
      });
      const info = data.midurlinfo?.[0];
      if (!info?.purl || !Array.isArray(data.sip)) continue;
      const domain =
        data.sip.find((s) => s.startsWith("https://")) ||
        data.sip.find((s) => s.startsWith("http://"));
      if (!domain) continue;
      const url = URL.parse(info.purl, domain);
      if (url?.pathname.split("/").at(-1) === filename && httpUrl(url.href))
        return { url: url.href, quality };
    }
    throw new Error(
      "QQ 音乐未提供符合偏好音质的完整资源，请确认账号与地区权限",
    );
  }
  async lyric(track) {
    if (!track?.mid) return [];
    let response;
    try {
      response = await this.get(
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
        {
          songmid: track.mid,
          songid: String(track.songId || ""),
          nobase64: "1",
        },
      );
    } catch {
      response = await this.rpc(
        "music.musichallSong.PlayLyricInfo",
        "GetPlayLyricInfo",
        {
          songMID: track.mid,
          songID: Number(track.songId || 0),
          trans_t: 0,
          roma_t: 0,
          qrc_t: 0,
          crypt: 0,
          lrc_t: 0,
          interval: 0,
        },
      );
    }
    if (!response.lyric) return [];
    const text = String(response.lyric);
    return parseLrc(
      text.includes("[") ? text : Buffer.from(text, "base64").toString("utf8"),
    );
  }
  async mutate(work) {
    if (this.busy) throw new Error("正在同步，请稍后再操作");
    this.busy = true;
    try {
      const before = await this.auth(true);
      const guard = async () => {
        const now = await this.auth(true);
        if (now.uin !== before.uin || now.key !== before.key)
          throw new Error("登录账号已变化，请刷新后重试");
      };
      await guard();
      return await work(guard);
    } finally {
      this.busy = false;
    }
  }
  async songIdentity(track) {
    if (track?.source !== "qq" || !/^[a-zA-Z0-9]+$/.test(track.mid || ""))
      throw new Error("请选择 QQ 音乐歌曲");
    const data = await this.rpc(
      "music.pf_song_detail_svr",
      "get_song_detail_yqq",
      { song_mid: track.mid },
    );
    const info = data.track_info;
    if (
      info?.mid !== track.mid ||
      !Number.isSafeInteger(info.id) ||
      !Number.isSafeInteger(info.type)
    )
      throw new Error("无法确认歌曲身份，未修改账号数据");
    return { songId: info.id, songType: info.type };
  }
  async like(track, liked) {
    if (typeof liked !== "boolean") throw new Error("收藏状态无效");
    return this.mutate(async (guard) => {
      const identity = await this.songIdentity(track);
      await guard();
      await this.rpc(
        "music.musicasset.PlaylistDetailWrite",
        liked ? "AddSonglist" : "DelSonglist",
        { dirId: 201, v_songInfo: [identity] },
        { write: true, signed: true },
      );
      await guard();
      const verify = await this.rpc(
        "music.musicasset.SongFavRead",
        "IsSongFanByMid",
        { v_songMid: [track.mid] },
      );
      if (verify.m_fan?.[track.mid] !== liked)
        throw new Error("平台尚未确认收藏变化，请刷新后检查");
      return { liked };
    });
  }
  async likeStatus(mids) {
    await this.auth(true);
    if (
      !Array.isArray(mids) ||
      mids.length > 100 ||
      mids.some((mid) => !/^[a-zA-Z0-9]+$/.test(mid))
    )
      throw new Error("歌曲编号无效");
    if (!mids.length) return {};
    const data = await this.rpc(
      "music.musicasset.SongFavRead",
      "IsSongFanByMid",
      { v_songMid: mids },
    );
    if (!data.m_fan || mids.some((mid) => typeof data.m_fan[mid] !== "boolean"))
      throw new Error("平台未返回完整的喜欢状态");
    return data.m_fan;
  }
  async ownedPlaylist(id) {
    const auth = await this.auth(true);
    const owned = await this.rpc(
      "music.musicasset.PlaylistBaseRead",
      "GetPlaylistByUin",
      { uin: auth.uin, bWithoutStatus: false },
    );
    const entries = owned.v_playlist || owned.vPlaylist || [];
    const matches = entries.filter(
      (p) => String(p.tid) === String(id) && String(p.uin) === auth.uin,
    );
    const entry = matches[0];
    const dirId = Number(entry?.dirId);
    if (
      matches.length !== 1 ||
      !Number.isSafeInteger(dirId) ||
      dirId <= 0 ||
      (dirId >= 201 && dirId <= 206)
    )
      throw new Error("无法确认这是你的普通歌单，未做修改");
    const detail = await this.collection("playlist", id);
    if (!detail.owned || detail.dirId !== dirId)
      throw new Error("歌单归属不一致，未做修改");
    return dirId;
  }
  async createPlaylist(name) {
    name = String(name || "").trim();
    if (!name || name.length > 60) throw new Error("歌单名称应为 1–60 个字符");
    return this.mutate(async (guard) => {
      const data = await this.rpc(
        "music.musicasset.PlaylistBaseWrite",
        "AddPlaylist",
        { dirName: name, dirDesc: "", dirPicUrl: "", taglist: "", dirShow: 2 },
        { write: true },
      );
      await guard();
      const id = String(data.result?.tid || "");
      if (!/^\d+$/.test(id))
        throw new Error("平台没有返回新歌单编号，请先刷新确认，避免重复创建");
      const detail = await this.collection("playlist", id);
      if (detail.name !== name)
        throw new Error("创建请求已发送，请刷新 QQ 音乐确认结果");
      return { id, name };
    });
  }
  async deletePlaylist(id) {
    return this.mutate(async (guard) => {
      const dirId = await this.ownedPlaylist(id);
      await guard();
      await this.rpc(
        "music.musicasset.PlaylistBaseWrite",
        "DelPlaylist",
        { dirId },
        { write: true },
      );
      await guard();
      const library = await this.library();
      if (
        library.warnings.length ||
        library.created.some((p) => p.id === String(id))
      )
        throw new Error("删除请求已发送，尚未能确认结果，请刷新检查");
      return { deleted: true };
    });
  }
  async editPlaylist(id, track, action) {
    if (!["add", "remove"].includes(action)) throw new Error("歌单操作无效");
    return this.mutate(async (guard) => {
      const dirId = await this.ownedPlaylist(id);
      const identity = await this.songIdentity(track);
      await guard();
      await this.rpc(
        "music.musicasset.PlaylistDetailWrite",
        action === "add" ? "AddSonglist" : "DelSonglist",
        { dirId, tid: Number(id), bFmtUtf8: true, v_songInfo: [identity] },
        { write: true },
      );
      await guard();
      let page = 0,
        found = false,
        more;
      do {
        const detail = await this.collection("playlist", id, page++);
        found ||= detail.tracks.some((t) => t.mid === track.mid);
        more = detail.hasMore;
      } while (!found && more && page < 50);
      if ((more && !found) || found !== (action === "add"))
        throw new Error("平台尚未确认歌单变化，请刷新检查");
      return { updated: true };
    });
  }
}
module.exports = { QQProvider, sign, gtk, check };
