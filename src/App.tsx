import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Disc3,
  FolderPlus,
  Heart,
  Home,
  ListMusic,
  ListPlus,
  LoaderCircle,
  LogOut,
  Maximize2,
  Minus,
  MoreHorizontal,
  Music2,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayer } from "./player";
import { useVirtualList } from "./useVirtualList";
import type {
  Account,
  Collection,
  Library,
  OnlineSource,
  Playlist,
  QualityPreference,
  Track,
} from "./types";

const api = window.soundroom;
const sourceNames = { qq: "QQ 音乐", netease: "网易云音乐", local: "本地" };
type Route = {
  kind:
    | "home"
    | "liked"
    | "created"
    | "collected"
    | "netease-library"
    | "local"
    | "playlist"
    | "album"
    | "artist"
    | "search";
  id?: string;
  name?: string;
  source?: OnlineSource;
};
type Dialog =
  | { type: "create" }
  | { type: "delete"; playlist: Playlist }
  | { type: "add"; track: Track }
  | { type: "settings" }
  | null;
const initialLibrary: Library = { created: [], collected: [], warnings: [] };
export const time = (seconds: number) =>
  Number.isFinite(seconds)
    ? `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`
    : "0:00";
function Cover({
  track,
  className = "",
}: {
  track?: { cover?: string; title?: string; name?: string } | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [track?.cover]);
  return (
    <div className={`cover ${className}`}>
      {track?.cover && !broken ? (
        <img src={track.cover} alt="" onError={() => setBroken(true)} />
      ) : (
        <Music2 strokeWidth={1.3} />
      )}
    </div>
  );
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export default function App() {
  if (!api)
    return (
      <div className="web-notice">
        <h1>声间</h1>
        <p>请通过桌面版启动播放器。</p>
        <code>npm start</code>
      </div>
    );
  return <DesktopApp />;
}
function DesktopApp() {
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);
  const player = usePlayer(notify);
  const [account, setAccount] = useState<Account>({ loggedIn: false });
  const [neteaseAccount, setNeteaseAccount] = useState<Account>({
    loggedIn: false,
  });
  const [neteasePlaylists, setNeteasePlaylists] = useState<Playlist[]>([]);
  const [searchSource, setSearchSource] = useState<OnlineSource>("qq");
  const [version, setVersion] = useState("");
  const [shortcuts, setShortcuts] = useState<
    Awaited<ReturnType<typeof api.bootstrap>>["shortcuts"]
  >([]);
  const [local, setLocal] = useState<Track[]>([]);
  const [library, setLibrary] = useState<Library>(initialLibrary);
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [history, setHistory] = useState<Route[]>([]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState<{
    loaded: number;
    total: number | null;
  } | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const loadToken = useRef(0),
    accountToken = useRef(0);
  const lyricRef = useRef<HTMLDivElement>(null);
  const activeCollectionRequest = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null),
    trackTableRef = useRef<HTMLDivElement>(null);
  const queueScrollRef = useRef<HTMLDivElement>(null),
    queueRowsRef = useRef<HTMLDivElement>(null);
  const navigate = (next: Route) => {
    setHistory((h) => [...h.slice(-24), route]);
    setRoute(next);
    setMenu(null);
  };
  const refreshLibrary = useCallback(async () => {
    const token = accountToken.current;
    setLibraryBusy(true);
    try {
      const data = await api.library();
      if (token === accountToken.current) setLibrary(data);
    } catch (e) {
      if (token === accountToken.current) notify((e as Error).message);
    } finally {
      if (token === accountToken.current) setLibraryBusy(false);
    }
  }, [notify]);
  const applyAccount = useCallback((next: Account) => {
    ++accountToken.current;
    setAccount(next);
    setLikes({});
    setLibrary(initialLibrary);
    setLibraryBusy(false);
  }, []);
  useEffect(() => {
    void api
      .bootstrap()
      .then((data) => {
        setLocal(data.local);
        applyAccount(data.account);
        setNeteaseAccount(data.neteaseAccount);
        setVersion(data.version);
        player.restore(data.player);
        setShortcuts(data.shortcuts || []);
        setInitialized(true);
      })
      .catch((e) => {
        notify(e.message);
        setInitialized(true);
        player.restore(null);
      });
    const a = api.subscribe("account", applyAccount),
      b = api.subscribe("library", setLocal),
      c = api.subscribe("collection-progress", (progress) => {
        if (progress.requestId === activeCollectionRequest.current)
          setLoadingProgress(progress);
      }),
      d = api.subscribe("netease-account", setNeteaseAccount);
    return () => {
      a();
      b();
      c();
      d();
    };
  }, []);
  useEffect(() => {
    if (account.loggedIn) void refreshLibrary();
  }, [account, refreshLibrary]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refreshAccount = async (source: OnlineSource = "qq") => {
    try {
      const data = await api.account(source);
      if (source === "qq") applyAccount(data);
      else setNeteaseAccount(data);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const neteaseRoute =
    route.source === "netease" || route.kind === "netease-library";
  const routeAccount = neteaseRoute ? neteaseAccount : account;
  const load = useCallback(
    async (append = false) => {
      const token = ++loadToken.current;
      if (activeCollectionRequest.current)
        void api
          .cancelCollection(activeCollectionRequest.current)
          .catch(() => {});
      activeCollectionRequest.current = null;
      setLoadingProgress(null);
      if (route.kind === "netease-library") {
        setCollection(null);
        setNeteasePlaylists([]);
        setError("");
        setBusy(neteaseAccount.loggedIn);
        if (!neteaseAccount.loggedIn) return;
        try {
          const playlists = await api.neteaseLibrary();
          if (token === loadToken.current) setNeteasePlaylists(playlists);
        } catch (e) {
          if (token === loadToken.current) setError((e as Error).message);
        } finally {
          if (token === loadToken.current) setBusy(false);
        }
        return;
      }
      if (
        !["liked", "playlist", "album", "artist", "search"].includes(route.kind)
      ) {
        setCollection(null);
        setError("");
        setBusy(false);
        return;
      }
      if (route.kind === "liked" && !account.loggedIn) {
        setCollection(null);
        setError("");
        setBusy(false);
        return;
      }
      const nextPage = append ? page + 1 : 0;
      setBusy(true);
      setError("");
      if (!append) {
        setCollection(null);
        setPage(0);
      }
      try {
        const requestId = `${token}:${Date.now()}`;
        if (route.kind !== "search")
          activeCollectionRequest.current = requestId;
        const result =
          route.kind === "search"
            ? {
                name: route.name || "",
                ...(await api.search(
                  route.name || "",
                  nextPage + 1,
                  route.source,
                )),
              }
            : await api.collectionAll(
                route.kind,
                route.id || "",
                requestId,
                route.source,
              );
        if (token !== loadToken.current) return;
        setCollection((previous) =>
          append && previous
            ? {
                ...result,
                tracks: [
                  ...new Map(
                    [...previous.tracks, ...result.tracks].map((t) => [
                      t.id,
                      t,
                    ]),
                  ).values(),
                ],
              }
            : result,
        );
        setPage(nextPage);
        if (route.kind === "liked")
          setLikes((old) => ({
            ...old,
            ...Object.fromEntries(result.tracks.map((t) => [t.mid!, true])),
          }));
      } catch (e) {
        if (token === loadToken.current) setError((e as Error).message);
      } finally {
        if (token === loadToken.current) {
          setBusy(false);
          setLoadingProgress(null);
          activeCollectionRequest.current = null;
        }
      }
    },
    [route, account.loggedIn, neteaseAccount.loggedIn, page],
  );
  useEffect(() => {
    void load();
    return () => {
      ++loadToken.current;
      if (activeCollectionRequest.current)
        void api
          .cancelCollection(activeCollectionRequest.current)
          .catch(() => {});
      activeCollectionRequest.current = null;
    };
  }, [route, routeAccount]);
  const tracks = route.kind === "local" ? local : collection?.tracks || [];
  const trackWindow = useVirtualList(
    tracks,
    mainScrollRef,
    trackTableRef,
    `${route.kind}:${route.id}:${route.name}`,
    65,
    39,
  );
  const queueWindow = useVirtualList(
    player.queue,
    queueScrollRef,
    queueRowsRef,
    String(queueOpen),
    54,
  );
  useEffect(() => {
    if (!account.loggedIn) return;
    let cancelled = false;
    const epoch = accountToken.current;
    const mids = [
      ...new Set(
        [...trackWindow.visible, ...(player.current ? [player.current] : [])]
          .filter(
            (t) => t.source === "qq" && t.mid && likes[t.mid] === undefined,
          )
          .map((t) => t.mid!),
      ),
    ];
    void (async () => {
      for (let start = 0; start < mids.length; start += 100) {
        try {
          const states = await api.likeStatus(mids.slice(start, start + 100));
          if (!cancelled && epoch === accountToken.current)
            setLikes((old) => ({ ...old, ...states }));
        } catch (e) {
          if (!cancelled && epoch === accountToken.current)
            notify(`读取喜欢状态失败：${(e as Error).message}`);
          break;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackWindow.visible, player.current, account]);
  useEffect(() => {
    lyricRef.current
      ?.querySelector(".lyric-line.current")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [player.lyricIndex, playerOpen]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape") {
        if (!dialogBusy) setDialog(null);
        setPlayerOpen(false);
        setQueueOpen(false);
        setMenu(null);
        return;
      }
      const tag = (event.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) || dialog)
        return;
      if (event.code === "Space") {
        event.preventDefault();
        void player.toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [player.toggle, dialog, dialogBusy]);
  const importMusic = async () => {
    setImporting(true);
    try {
      const result = await api.importLocal();
      setLocal(result.tracks);
      if (result.skipped.length)
        notify(`以下文件未能读取：${result.skipped.join("、")}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  const doLike = async (track: Track) => {
    if (!account.loggedIn) {
      notify("请先登录 QQ 音乐");
      return;
    }
    if (!track.mid || likes[track.mid] === undefined) {
      notify("尚未读取到这首歌的喜欢状态，请刷新页面后重试");
      return;
    }
    setLikeBusy(track.id);
    try {
      const result = await api.like(track, !likes[track.mid]);
      setLikes((old) => ({ ...old, [track.mid!]: result.liked }));
      notify(
        result.liked
          ? "已同步到 QQ 音乐「我的喜欢」"
          : "已从 QQ 音乐「我的喜欢」移除",
      );
      if (route.kind === "liked" && !result.liked)
        setCollection((old) =>
          old
            ? {
                ...old,
                total: Math.max(0, old.total - 1),
                tracks: old.tracks.filter((t) => t.id !== track.id),
              }
            : old,
        );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLikeBusy(null);
    }
  };
  const openDialog = (next: Dialog) => {
    setDialog(next);
    setDialogError("");
    setDialogName("");
    setMenu(null);
  };
  const submitDialog = async (playlistId?: string) => {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.type === "create") {
        await api.createPlaylist(dialogName);
        notify("已在 QQ 音乐创建私密歌单");
      }
      if (dialog.type === "delete") {
        await api.deletePlaylist(dialog.playlist.id);
        notify("歌单已从 QQ 音乐删除");
        if (route.id === dialog.playlist.id) navigate({ kind: "created" });
      }
      if (dialog.type === "add" && playlistId) {
        await api.editPlaylist(playlistId, dialog.track, "add");
        notify("已同步添加到歌单");
        if (route.kind === "playlist" && route.id === playlistId) void load();
      }
      setDialog(null);
      await refreshLibrary();
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setDialogBusy(false);
    }
  };
  const playAll = async () => {
    if (busy || !tracks.length) return;
    void player.play(tracks[0], tracks);
  };
  const removeFromPlaylist = async (track: Track) => {
    setMenu(null);
    try {
      await api.editPlaylist(route.id!, track, "remove");
      notify("已从 QQ 音乐歌单移除");
      void load();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const title = {
    home: "音乐库",
    liked: "我的喜欢",
    created: "个人歌单",
    collected: "收藏歌单",
    "netease-library": "网易云歌单",
    local: "本地音乐",
    playlist: collection?.name || route.name,
    album: collection?.name || route.name || "专辑",
    artist: collection?.name || route.name || "歌手",
    search: `“${route.name}”`,
  }[route.kind];
  const selectedPlaylist = neteaseRoute
    ? undefined
    : library.created.find((p) => p.id === route.id);
  const needsLogin =
    !routeAccount.loggedIn &&
    ["liked", "created", "collected", "playlist", "netease-library"].includes(
      route.kind,
    );
  const cards =
    route.kind === "collected" ? library.collected : library.created;
  const current = player.current;
  const likedCurrent = current?.mid ? likes[current.mid] : undefined;

  function renderTrackList() {
    return (
      <div className="track-table" ref={trackTableRef}>
        <div className="track-head">
          <span>#</span>
          <span>歌曲</span>
          <span>专辑</span>
          <span>时长</span>
          <span />
        </div>
        {trackWindow.before > 0 && (
          <div aria-hidden="true" style={{ height: trackWindow.before }} />
        )}
        {trackWindow.visible.map((track, visibleIndex) => {
          const index = trackWindow.start + visibleIndex;
          return (
            <div
              className={`track-row ${current?.id === track.id ? "selected" : ""}`}
              key={track.id}
              onDoubleClick={() => void player.play(track, tracks)}
            >
              <button
                className="track-index"
                title={`播放 ${track.title}`}
                onClick={() => void player.play(track, tracks)}
              >
                {current?.id === track.id && player.playing ? (
                  <span className="equalizer">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <Play className="row-play" size={15} fill="currentColor" />
                  </>
                )}
              </button>
              <div className="track-info">
                <Cover track={track} />
                <div>
                  <button
                    className="track-title"
                    onClick={() => void player.play(track, tracks)}
                  >
                    {track.title}
                  </button>
                  <div className="track-subtitle">
                    {track.source !== "local" && track.artists?.length
                      ? track.artists.map((artist, i) => (
                          <span key={artist.id || i}>
                            {i > 0 && " / "}
                            <button
                              onClick={() =>
                                navigate({
                                  kind: "artist",
                                  source: track.source as OnlineSource,
                                  id: artist.id,
                                  name: artist.name,
                                })
                              }
                            >
                              {artist.name}
                            </button>
                          </span>
                        ))
                      : track.artist}
                    {track.source === "local" && <small>本地</small>}
                    {track.source === "netease" && <small>网易云</small>}
                  </div>
                </div>
              </div>
              <button
                className="album-link"
                disabled={!track.albumMid}
                onClick={() =>
                  navigate({
                    kind: "album",
                    source: track.source === "local" ? undefined : track.source,
                    id: track.albumMid,
                    name: track.album,
                  })
                }
              >
                {track.album}
              </button>
              <span className="track-time">{time(track.duration)}</span>
              <div className="row-actions">
                {track.source === "qq" && (
                  <IconButton
                    label={track.mid && likes[track.mid] ? "取消喜欢" : "喜欢"}
                    active={!!(track.mid && likes[track.mid])}
                    disabled={
                      likeBusy !== null ||
                      !account.loggedIn ||
                      !track.mid ||
                      likes[track.mid] === undefined
                    }
                    onClick={() => void doLike(track)}
                  >
                    <Heart
                      size={16}
                      fill={
                        track.mid && likes[track.mid] ? "currentColor" : "none"
                      }
                    />
                  </IconButton>
                )}
                <div className="menu-anchor">
                  <IconButton
                    label={`更多：${track.title}`}
                    active={menu === track.id}
                    onClick={() => setMenu(menu === track.id ? null : track.id)}
                  >
                    <MoreHorizontal size={18} />
                  </IconButton>
                  {menu === track.id && (
                    <div className="popover">
                      <button
                        onClick={() => {
                          player.setQueue((q) =>
                            q.some((t) => t.id === track.id)
                              ? q
                              : [...q, track],
                          );
                          setMenu(null);
                          notify("已加入播放队列");
                        }}
                      >
                        <ListPlus size={15} />
                        加入队列
                      </button>
                      {track.source === "qq" && account.loggedIn && (
                        <button
                          onClick={() => openDialog({ type: "add", track })}
                        >
                          <Plus size={15} />
                          添加到歌单
                        </button>
                      )}
                      {route.kind === "playlist" && collection?.owned && (
                        <button onClick={() => void removeFromPlaylist(track)}>
                          <Minus size={15} />
                          从歌单移除
                        </button>
                      )}
                      {track.source === "local" && (
                        <button
                          onClick={() => {
                            void api
                              .removeLocal(track.id)
                              .then(setLocal)
                              .catch((e) => notify(e.message));
                            player.remove(track.id);
                            setMenu(null);
                          }}
                        >
                          <X size={15} />
                          从曲库移除 · 保留文件
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {trackWindow.after > 0 && (
          <div aria-hidden="true" style={{ height: trackWindow.after }} />
        )}
      </div>
    );
  }
  function renderCards(list: Playlist[], source: OnlineSource = "qq") {
    return (
      <div className="playlist-grid">
        {list.map((p) => (
          <div className="playlist-card" key={p.id}>
            <button
              className="playlist-art"
              onClick={() =>
                navigate({ kind: "playlist", id: p.id, name: p.name, source })
              }
            >
              <Cover track={p} />
              <span className="card-play">
                <Play size={20} fill="currentColor" />
              </span>
            </button>
            <div className="card-caption">
              <button
                className="card-name"
                onClick={() =>
                  navigate({ kind: "playlist", id: p.id, name: p.name, source })
                }
              >
                {p.name}
              </button>
              {p.kind === "created" && source === "qq" && (
                <IconButton
                  label={`删除歌单 ${p.name}`}
                  onClick={() => openDialog({ type: "delete", playlist: p })}
                >
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
            <p>{p.count} 首歌曲</p>
          </div>
        ))}
      </div>
    );
  }
  function loginEmpty() {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <ListMusic size={30} strokeWidth={1.2} />
        </div>
        <h3>请先登录 QQ 音乐</h3>
        <p>
          登录 QQ 音乐，读取喜欢与歌单。
          <br />
          登录后可查看和管理账号中的歌单。
        </p>
        <button
          className="primary"
          onClick={() => void api.login().catch((e) => notify(e.message))}
        >
          登录 QQ 音乐 <ArrowUpRight size={16} />
        </button>
        <button className="text-button" onClick={() => void refreshAccount()}>
          已完成登录？刷新账号
        </button>
      </div>
    );
  }
  return (
    <div
      className="app-shell"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(".menu-anchor")) setMenu(null);
      }}
    >
      <aside className="sidebar">
        <div className="brand drag">
          <span className="brand-symbol">
            声<span>间</span>
            <i />
          </span>
          <span className="brand-en">SOUNDROOM</span>
        </div>
        <div className="side-section-label">你的音乐空间</div>
        <nav>
          {(
            [
              { kind: "home", text: "音乐库", icon: Home },
              { kind: "liked", text: "我的喜欢", icon: Heart },
              { kind: "created", text: "个人歌单", icon: ListMusic },
              { kind: "collected", text: "收藏歌单", icon: Bookmark },
              { kind: "netease-library", text: "网易云歌单", icon: ListMusic },
              { kind: "local", text: "本地音乐", icon: Music2 },
            ] as const
          ).map((item) => (
            <button
              key={item.kind}
              className={route.kind === item.kind ? "nav-active" : ""}
              onClick={() => navigate({ kind: item.kind })}
            >
              <item.icon size={18} strokeWidth={1.6} />
              <span>{item.text}</span>
              {route.kind === item.kind && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="side-section-label side-playlist-label">
          <span>我的歌单</span>
          <IconButton
            label="新建歌单"
            onClick={() =>
              account.loggedIn
                ? openDialog({ type: "create" })
                : notify("请先登录 QQ 音乐")
            }
          >
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="side-playlists">
          {library.created.slice(0, 9).map((p) => (
            <button
              key={p.id}
              className={!neteaseRoute && route.id === p.id ? "selected" : ""}
              onClick={() =>
                navigate({ kind: "playlist", id: p.id, name: p.name })
              }
            >
              <span className="playlist-dot" />
              {p.name}
            </button>
          ))}
          {!library.created.length && (
            <p>
              {account.loggedIn
                ? "你的歌单会出现在这里"
                : "登录后，歌单就在这里"}
            </p>
          )}
        </div>
        <div className="side-bottom">
          <button
            className="account-button"
            onClick={() =>
              account.loggedIn
                ? openDialog({ type: "settings" })
                : void api.login().catch((e) => notify(e.message))
            }
          >
            <span
              className={`account-avatar ${account.loggedIn ? "connected" : ""}`}
            >
              {account.loggedIn ? (
                (account.nickname || "我").slice(0, 1)
              ) : (
                <Music2 size={17} />
              )}
            </span>
            <span>
              <strong>
                {account.loggedIn ? account.nickname : "连接 QQ 音乐"}
              </strong>
              <small>
                {account.loggedIn ? "账号已连接" : "登录后读取歌单"}
              </small>
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar drag">
          <div className="topbar-left no-drag">
            <IconButton
              label="返回"
              disabled={!history.length}
              onClick={() => {
                const previous = history.at(-1);
                if (previous) {
                  setRoute(previous);
                  setHistory((h) => h.slice(0, -1));
                }
              }}
            >
              <ArrowLeft size={18} />
            </IconButton>
            <span className="breadcrumb">
              我的音乐 <span>/</span> {route.kind === "home" ? "音乐库" : title}
            </span>
          </div>
          <form
            className="search-box no-drag"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (search.trim())
                navigate({
                  kind: "search",
                  name: search.trim(),
                  source: searchSource,
                });
            }}
          >
            <Search size={16} />
            <input
              aria-label="搜索音乐"
              placeholder="搜索歌曲、歌手"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="搜索音源"
              value={searchSource}
              onChange={(e) => {
                const source = e.target.value as OnlineSource;
                setSearchSource(source);
                if (route.kind === "search")
                  navigate({
                    ...route,
                    source,
                    name: search.trim() || route.name,
                  });
              }}
            >
              <option value="qq">QQ 音乐</option>
              <option value="netease">网易云音乐</option>
            </select>
          </form>
          <div className="window-actions no-drag">
            <IconButton
              label="偏好与信息"
              onClick={() => openDialog({ type: "settings" })}
            >
              <Settings2 size={16} />
            </IconButton>
            <span />
            <IconButton
              label="最小化"
              onClick={() => void api.window("minimize")}
            >
              <Minus size={15} />
            </IconButton>
            <IconButton
              label="最大化"
              onClick={() => void api.window("maximize")}
            >
              <Maximize2 size={13} />
            </IconButton>
            <IconButton
              label="关闭到托盘"
              className="window-close"
              onClick={() => void api.window("close")}
            >
              <X size={17} />
            </IconButton>
          </div>
        </header>
        <main
          className="main-content"
          ref={mainScrollRef}
          key={`${route.kind}:${route.id}:${route.name}`}
        >
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
            </div>
            {route.kind !== "home" && (
              <div className="heading-actions">
                {route.kind === "local" ? (
                  <button
                    className="secondary"
                    disabled={importing}
                    onClick={() => void importMusic()}
                  >
                    <FolderPlus size={16} />
                    {importing ? "正在读取" : "添加音乐"}
                  </button>
                ) : ["created", "collected"].includes(route.kind) ? (
                  <>
                    <IconButton
                      label="刷新歌单"
                      disabled={libraryBusy || !account.loggedIn}
                      onClick={() => void refreshLibrary()}
                    >
                      <RefreshCw
                        size={16}
                        className={libraryBusy ? "spin" : ""}
                      />
                    </IconButton>
                    {route.kind === "created" && account.loggedIn && (
                      <button
                        className="secondary"
                        onClick={() => openDialog({ type: "create" })}
                      >
                        <Plus size={16} />
                        新建歌单
                      </button>
                    )}
                  </>
                ) : (
                  <IconButton
                    label="刷新当前列表"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    <RefreshCw size={16} className={busy ? "spin" : ""} />
                  </IconButton>
                )}
              </div>
            )}
          </div>
          {route.kind === "home" ? (
            <>
              <div className="quick-links" aria-label="音乐库入口">
                <button onClick={() => navigate({ kind: "liked" })}>
                  <span className="quick-icon">
                    <Heart size={23} strokeWidth={1.4} />
                  </span>
                  <strong>我的喜欢</strong>
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => navigate({ kind: "created" })}>
                  <span className="quick-icon">
                    <ListMusic size={23} strokeWidth={1.4} />
                  </span>
                  <strong>个人歌单</strong>
                  {account.loggedIn && (
                    <small>{library.created.length} 张</small>
                  )}
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => navigate({ kind: "collected" })}>
                  <span className="quick-icon">
                    <Bookmark size={23} strokeWidth={1.4} />
                  </span>
                  <strong>收藏歌单</strong>
                  {account.loggedIn && (
                    <small>{library.collected.length} 张</small>
                  )}
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => navigate({ kind: "local" })}>
                  <span className="quick-icon">
                    <Disc3 size={23} strokeWidth={1.4} />
                  </span>
                  <strong>本地音乐</strong>
                  <small>{local.length} 首</small>
                  <ArrowUpRight size={17} />
                </button>
              </div>
            </>
          ) : needsLogin ? (
            neteaseRoute ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Music2 size={30} />
                </div>
                <h3>连接网易云音乐</h3>
                <p>登录后读取账号中的歌单。</p>
                <button
                  className="primary"
                  onClick={() =>
                    void api.login("netease").catch((e) => notify(e.message))
                  }
                >
                  登录网易云音乐
                </button>
              </div>
            ) : (
              loginEmpty()
            )
          ) : route.kind === "netease-library" ? (
            busy ? (
              <div className="loading-state">
                <LoaderCircle className="spin" size={22} />
                正在读取歌单
              </div>
            ) : error ? (
              <div className="error-banner">{error}</div>
            ) : neteasePlaylists.length ? (
              renderCards(neteasePlaylists, "netease")
            ) : (
              <div className="empty-state">
                <h3>暂无网易云歌单</h3>
              </div>
            )
          ) : ["created", "collected"].includes(route.kind) ? (
            <>
              {library.warnings.length > 0 && (
                <div className="error-banner">
                  {library.warnings.join("；")}
                </div>
              )}
              {libraryBusy && !cards.length ? (
                <div className="loading-state">
                  <LoaderCircle className="spin" size={22} />
                  正在读取歌单
                </div>
              ) : cards.length ? (
                renderCards(cards)
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <ListMusic size={30} />
                  </div>
                  <h3>
                    {route.kind === "created"
                      ? "暂无个人歌单"
                      : "这里还没有收藏歌单"}
                  </h3>
                  <p>
                    {route.kind === "created"
                      ? "新建歌单后，会同步到你的 QQ 音乐账号。"
                      : "在 QQ 音乐收藏歌单后，点击刷新即可读取。"}
                  </p>
                  {route.kind === "created" && (
                    <button
                      className="primary"
                      onClick={() => openDialog({ type: "create" })}
                    >
                      <Plus size={16} />
                      新建歌单
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {collection?.cover &&
                ["playlist", "album", "artist"].includes(route.kind) && (
                  <div className="collection-banner">
                    <Cover track={collection} />
                    <div>
                      <span className="eyebrow">
                        {route.kind === "artist"
                          ? "歌手 · 热门歌曲"
                          : route.kind === "album"
                            ? "专辑"
                            : neteaseRoute
                              ? "网易云音乐歌单"
                              : "QQ 音乐歌单"}
                      </span>
                      <p>{collection.total} 首歌曲</p>
                      {collection.description && (
                        <small>
                          {collection.description
                            .replace(/<[^>]*>/g, "")
                            .slice(0, 160)}
                        </small>
                      )}
                    </div>
                    {selectedPlaylist && (
                      <IconButton
                        label="删除此歌单"
                        onClick={() =>
                          openDialog({
                            type: "delete",
                            playlist: selectedPlaylist,
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </IconButton>
                    )}
                  </div>
                )}
              {tracks.length > 0 && (
                <div className="list-toolbar">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void playAll()}
                  >
                    <Play size={15} fill="currentColor" />
                    {route.kind === "search" ? "播放当前结果" : "播放全部"}
                  </button>
                  <span>
                    {route.kind === "local"
                      ? `${local.length} 首音乐 · 文件保留在原位置`
                      : route.kind === "search"
                        ? `已载入 ${tracks.length} / ${collection?.total || tracks.length} 首`
                        : `共 ${tracks.length} 首${collection?.skipped ? " · " + collection.skipped + " 首平台未提供曲目信息" : ""}`}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => {
                      player.setQueue((q) => [
                        ...new Map(
                          [...q, ...tracks].map((t) => [t.id, t]),
                        ).values(),
                      ]);
                      notify("当前列表已加入队列");
                    }}
                  >
                    <ListPlus size={16} />
                    加入队列
                  </button>
                </div>
              )}
              {error && (
                <div className="error-banner">
                  <span>{error}</span>
                  <button onClick={() => void load()}>
                    <RefreshCw size={14} />
                    重试
                  </button>
                </div>
              )}
              {tracks.length ? (
                renderTrackList()
              ) : !busy && !error ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    {route.kind === "local" ? (
                      <Disc3 size={32} />
                    ) : (
                      <Music2 size={30} />
                    )}
                  </div>
                  <h3>
                    {route.kind === "local"
                      ? "暂无本地音乐"
                      : route.kind === "search"
                        ? "没有找到相关歌曲"
                        : "这里还没有歌曲"}
                  </h3>
                  <p>
                    {route.kind === "local"
                      ? "支持 MP3、FLAC、M4A、WAV、OGG 等格式。\n同名 .lrc 文件可显示同步歌词。"
                      : route.kind === "search"
                        ? "换个歌曲名或歌手名试试。"
                        : "添加喜欢的歌曲后，刷新即可看到。"}
                  </p>
                  {route.kind === "local" && (
                    <button
                      className="primary"
                      disabled={importing}
                      onClick={() => void importMusic()}
                    >
                      <FolderPlus size={16} />
                      选择音乐文件
                    </button>
                  )}
                </div>
              ) : null}
              {busy && (
                <div className="loading-state">
                  <LoaderCircle size={20} className="spin" />
                  {loadingProgress
                    ? `正在读取全部歌曲：${loadingProgress.loaded}${loadingProgress.total !== null ? " / " + loadingProgress.total : ""} 首`
                    : "正在读取音乐"}
                </div>
              )}
              {route.kind === "search" && collection?.hasMore && !busy && (
                <button
                  className="load-more secondary"
                  onClick={() => void load(true)}
                >
                  载入更多 <ArrowDown size={15} />
                </button>
              )}
            </>
          )}
        </main>
      </div>
      <footer className="player-bar">
        <div className="now-playing">
          <button
            className="now-cover"
            onClick={() => setPlayerOpen(true)}
            title="打开播放页"
          >
            <Cover track={current} />
            <span>
              <Maximize2 size={16} />
            </span>
          </button>
          <div className="now-meta">
            <button disabled={!current} onClick={() => setPlayerOpen(true)}>
              {current?.title || "未在播放"}
            </button>
            <span>{current?.artist || "未选择歌曲"}</span>
          </div>
          {current?.source === "qq" && (
            <IconButton
              label={likedCurrent ? "取消喜欢" : "喜欢当前歌曲"}
              active={!!likedCurrent}
              disabled={likeBusy !== null || likedCurrent === undefined}
              onClick={() => void doLike(current)}
            >
              <Heart size={17} fill={likedCurrent ? "currentColor" : "none"} />
            </IconButton>
          )}
        </div>
        <div className="transport">
          <div className="transport-buttons">
            <IconButton
              label="随机播放"
              active={player.shuffle}
              onClick={player.toggleShuffle}
            >
              <Shuffle size={16} />
            </IconButton>
            <IconButton
              label="上一首"
              disabled={!player.queue.length}
              onClick={() => player.move(-1)}
            >
              <SkipBack size={19} fill="currentColor" />
            </IconButton>
            <button
              className="play-button"
              aria-label={player.playing ? "暂停" : "播放"}
              onClick={() => void player.toggle()}
              disabled={player.loading}
            >
              {player.loading ? (
                <LoaderCircle className="spin" size={20} />
              ) : player.playing ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <IconButton
              label="下一首"
              disabled={!player.queue.length}
              onClick={() => player.move(1)}
            >
              <SkipForward size={19} fill="currentColor" />
            </IconButton>
            <IconButton
              label={
                player.repeat === "one"
                  ? "单曲循环"
                  : player.repeat === "all"
                    ? "列表循环"
                    : "顺序播放"
              }
              active={player.repeat !== "off"}
              onClick={() =>
                player.setRepeat(
                  player.repeat === "all"
                    ? "one"
                    : player.repeat === "one"
                      ? "off"
                      : "all",
                )
              }
            >
              {player.repeat === "one" ? (
                <Repeat1 size={17} />
              ) : (
                <Repeat size={17} />
              )}
            </IconButton>
          </div>
          <div className="progress-row">
            <span>{time(player.position)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min="0"
              max={player.duration || 1}
              step="0.1"
              value={Math.min(player.position, player.duration || 1)}
              style={
                {
                  "--progress": `${player.duration ? (player.position / player.duration) * 100 : 0}%`,
                } as React.CSSProperties
              }
              onChange={(e) => player.seek(Number(e.target.value))}
              disabled={!current}
            />
            <span>{time(player.duration)}</span>
          </div>
        </div>
        <div className="player-extras">
          <button
            className="quality"
            title={player.quality || "设置在线偏好音质"}
            aria-label="设置在线偏好音质"
            onClick={() => openDialog({ type: "settings" })}
          >
            {player.quality && current
              ? player.quality.split(" · ")[0]
              : "音质"}
          </button>
          <IconButton label="歌词小窗" onClick={() => void api.window("mini")}>
            <PictureInPicture2 size={18} />
          </IconButton>
          <div className="volume-control">
            <IconButton
              label={player.volume === 0 ? "取消静音" : "静音"}
              onClick={() => player.setVolume(player.volume ? 0 : 0.75)}
            >
              {player.volume === 0 ? (
                <VolumeX size={17} />
              ) : (
                <Volume2 size={17} />
              )}
            </IconButton>
            <input
              aria-label="音量"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={player.volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
            />
          </div>
          <span className="extras-divider" />
          <IconButton
            label="播放队列"
            active={queueOpen}
            onClick={() => setQueueOpen(!queueOpen)}
          >
            <ListMusic size={21} />
          </IconButton>
        </div>
      </footer>
      {queueOpen && (
        <>
          <div
            className="drawer-backdrop"
            onClick={() => setQueueOpen(false)}
          />
          <aside className="queue-drawer">
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">UP NEXT</span>
                <h2>
                  播放队列 <small>{player.queue.length}</small>
                </h2>
              </div>
              <IconButton label="关闭队列" onClick={() => setQueueOpen(false)}>
                <X size={20} />
              </IconButton>
            </div>
            {player.queue.length > 0 && (
              <button
                className="text-button clear-queue"
                onClick={player.clear}
              >
                <Trash2 size={14} />
                清空队列
              </button>
            )}
            <div className="queue-list" ref={queueScrollRef}>
              <div ref={queueRowsRef}>
                {player.queue.length ? (
                  <>
                    {queueWindow.before > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: queueWindow.before }}
                      />
                    )}
                    {queueWindow.visible.map((track, visibleIndex) => {
                      const i = queueWindow.start + visibleIndex;
                      return (
                        <div
                          className={`queue-item ${current?.id === track.id ? "selected" : ""}`}
                          key={track.id}
                        >
                          <button
                            className="queue-track"
                            onClick={() => void player.play(track)}
                          >
                            <Cover track={track} />
                            <span>
                              <strong>{track.title}</strong>
                              <small>
                                {track.artist} · {sourceNames[track.source]}
                              </small>
                            </span>
                          </button>
                          <div className="queue-item-actions">
                            <IconButton
                              label={`上移 ${track.title}`}
                              disabled={i === 0}
                              onClick={() =>
                                player.setQueue((q) => {
                                  const next = [...q];
                                  [next[i - 1], next[i]] = [
                                    next[i],
                                    next[i - 1],
                                  ];
                                  return next;
                                })
                              }
                            >
                              <ArrowUp size={14} />
                            </IconButton>
                            <IconButton
                              label={`下移 ${track.title}`}
                              disabled={i === player.queue.length - 1}
                              onClick={() =>
                                player.setQueue((q) => {
                                  const next = [...q];
                                  [next[i], next[i + 1]] = [
                                    next[i + 1],
                                    next[i],
                                  ];
                                  return next;
                                })
                              }
                            >
                              <ArrowDown size={14} />
                            </IconButton>
                            <IconButton
                              label={`移除 ${track.title}`}
                              onClick={() => player.remove(track.id)}
                            >
                              <X size={15} />
                            </IconButton>
                          </div>
                        </div>
                      );
                    })}
                    {queueWindow.after > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: queueWindow.after }}
                      />
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <ListMusic size={32} />
                    <h3>播放队列为空</h3>
                    <p>将喜欢的歌曲加入队列。</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
      {playerOpen && (
        <section className="full-player">
          <div className="full-player-top">
            <span className="eyebrow">正在播放</span>
            <IconButton label="收起播放页" onClick={() => setPlayerOpen(false)}>
              <X size={22} />
            </IconButton>
          </div>
          <div className="full-player-body">
            <div className="full-artwork">
              <Cover track={current} />
              <h2>{current?.title || "未在播放"}</h2>
              <p>{current?.artist || "选择一首歌曲开始播放"}</p>
              <small>{current?.album || ""}</small>
            </div>
            <div className="lyrics-scroll" ref={lyricRef}>
              {player.lines.length ? (
                <div className="lyric-lines">
                  {player.lines.map((line, i) => (
                    <button
                      key={`${line.time}:${i}`}
                      className={`lyric-line ${i === player.lyricIndex ? "current" : ""}`}
                      onClick={() => player.seek(line.time)}
                    >
                      {line.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lyric-placeholder">
                  <span />
                  <p>{current ? "暂无同步歌词" : "未选择歌曲"}</p>
                  {current?.source === "local" && (
                    <small>将同名 .lrc 文件放在音乐文件旁即可读取</small>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onClick={() => !dialogBusy && setDialog(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2 id="dialog-title">
                {dialog.type === "create"
                  ? "新建歌单"
                  : dialog.type === "delete"
                    ? "删除歌单"
                    : dialog.type === "add"
                      ? "添加到歌单"
                      : "偏好与信息"}
              </h2>
              <IconButton
                label="关闭对话框"
                disabled={dialogBusy}
                onClick={() => setDialog(null)}
              >
                <X size={19} />
              </IconButton>
            </div>
            {dialog.type === "create" && (
              <>
                <p className="modal-description">
                  在 QQ 音乐创建一张仅自己可见的歌单。
                </p>
                <label className="field-label">
                  歌单名称
                  <input
                    autoFocus
                    maxLength={60}
                    placeholder="给这段音乐起个名字"
                    value={dialogName}
                    onChange={(e) => setDialogName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && dialogName.trim() && !dialogBusy)
                        void submitDialog();
                    }}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={dialogBusy}
                    onClick={() => setDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={!dialogName.trim() || dialogBusy}
                    onClick={() => void submitDialog()}
                  >
                    {dialogBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Plus size={16} />
                    )}
                    创建并同步
                  </button>
                </div>
              </>
            )}
            {dialog.type === "delete" && (
              <>
                <p className="modal-description">
                  删除「{dialog.playlist.name}」？
                  <br />
                  此操作会同步删除 QQ 音乐账号中的这张歌单。
                </p>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={dialogBusy}
                    onClick={() => setDialog(null)}
                  >
                    保留歌单
                  </button>
                  <button
                    className="danger"
                    disabled={dialogBusy}
                    onClick={() => void submitDialog()}
                  >
                    {dialogBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    删除并同步
                  </button>
                </div>
              </>
            )}
            {dialog.type === "add" && (
              <>
                <p className="modal-description">
                  将「{dialog.track.title}」添加到你的 QQ 音乐歌单。
                </p>
                <div className="dialog-playlists">
                  {library.created.length ? (
                    library.created.map((p) => (
                      <button
                        key={p.id}
                        disabled={dialogBusy}
                        onClick={() => void submitDialog(p.id)}
                      >
                        <Cover track={p} />
                        <span>{p.name}</span>
                        <Plus size={17} />
                      </button>
                    ))
                  ) : (
                    <p>先创建一张个人歌单。</p>
                  )}
                </div>
                {dialogBusy && (
                  <div className="loading-state">
                    <LoaderCircle size={17} className="spin" />
                    正在同步
                  </div>
                )}
              </>
            )}
            {dialog.type === "settings" && (
              <>
                <div className="settings-brand">
                  声间 <span>SOUNDROOM / {version}</span>
                </div>
                <div className="setting-row">
                  <span>在线偏好音质</span>
                  <select
                    aria-label="在线偏好音质"
                    value={player.preferredQuality}
                    onChange={(e) =>
                      player.changeQuality(e.target.value as QualityPreference)
                    }
                  >
                    <option value="standard">标准 · 128 kbps</option>
                    <option value="higher">较高 · 192 kbps</option>
                    <option value="high">HQ · 320 kbps</option>
                    <option value="lossless">无损 · FLAC</option>
                  </select>
                </div>
                <p className="settings-note">
                  优先播放所选音质，资源不可用时降到最接近的可用音质。
                </p>
                <div className="setting-row">
                  <span>关闭主窗口</span>
                  <strong>留在托盘，继续播放</strong>
                </div>
                <div className="setting-row">
                  <span>再次打开</span>
                  <strong>恢复队列与进度，手动播放</strong>
                </div>
                <div className="setting-row">
                  <span>主窗口空格键</span>
                  <strong>播放 / 暂停</strong>
                </div>
                {shortcuts.map((shortcut) => (
                  <div className="setting-row" key={shortcut.accelerator}>
                    <span>{shortcut.action}（全局）</span>
                    <strong>
                      {shortcut.label}
                      {!shortcut.registered && (
                        <small className="shortcut-conflict">
                          已被其他程序占用
                        </small>
                      )}
                    </strong>
                  </div>
                ))}
                <div className="setting-row">
                  <span>QQ 音乐账号</span>
                  <strong>
                    {account.loggedIn ? account.nickname : "尚未连接"}
                  </strong>
                </div>
                <p className="settings-note">
                  歌曲可用性取决于账号权益和所在地区。登录在 QQ
                  音乐官方页面完成，登录状态保存在本机。
                </p>
                <div className="modal-actions">
                  {account.loggedIn ? (
                    <button
                      className="secondary"
                      onClick={() =>
                        void api
                          .logout()
                          .then(() => {
                            applyAccount({ loggedIn: false });
                            setDialog(null);
                            notify("已退出 QQ 音乐账号");
                          })
                          .catch((e) => notify(e.message))
                      }
                    >
                      <LogOut size={15} />
                      退出账号
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() =>
                        void api.login().catch((e) => notify(e.message))
                      }
                    >
                      连接 QQ 音乐
                    </button>
                  )}
                  <button
                    className="primary"
                    onClick={() => void refreshAccount("qq")}
                  >
                    <RefreshCw size={15} />
                    刷新账号
                  </button>
                </div>
                <div className="setting-row">
                  <span>网易云音乐账号</span>
                  <strong>
                    {neteaseAccount.loggedIn
                      ? neteaseAccount.nickname
                      : "尚未连接"}
                  </strong>
                </div>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      const operation = neteaseAccount.loggedIn
                        ? api.logout("netease")
                        : api.login("netease");
                      void operation.catch((e) => notify(e.message));
                    }}
                  >
                    {neteaseAccount.loggedIn
                      ? "退出网易云账号"
                      : "连接网易云音乐"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void refreshAccount("netease")}
                  >
                    <RefreshCw size={15} />
                    刷新网易云账号
                  </button>
                </div>
                <button
                  className="quit-app"
                  onClick={() => void api.window("quit")}
                >
                  完全退出声间
                </button>
              </>
            )}
            {dialogError && <div className="dialog-error">{dialogError}</div>}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!initialized && (
        <div className="boot-screen">
          <span className="brand-symbol">
            声间
            <i />
          </span>
          <LoaderCircle size={20} className="spin" />
        </div>
      )}
    </div>
  );
}
