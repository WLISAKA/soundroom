import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricLine, SavedPlayer, Track } from "./types";

const api = window.soundroom;
export function usePlayer(notify: (message: string) => void) {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const [queue, setQueue] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [repeat, setRepeat] = useState<SavedPlayer["repeat"]>("all");
  const [shuffle, setShuffle] = useState(false);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [quality, setQuality] = useState("HQ");
  const [ready, setReady] = useState(false);
  const request = useRef(0);
  const loadedId = useRef("");
  const seekOnLoad = useRef(0);
  const latest = useRef({ queue, current, position, volume, repeat, shuffle });
  latest.current = { queue, current, position, volume, repeat, shuffle };
  const play = useCallback(
    async (track: Track, list?: Track[], resume = 0, autoPlay = true) => {
      const token = ++request.current;
      audio.current.pause();
      loadedId.current = "";
      audio.current.removeAttribute("src");
      audio.current.load();
      if (list) setQueue([...new Map(list.map((t) => [t.id, t])).values()]);
      else if (!latest.current.queue.some((t) => t.id === track.id))
        setQueue((q) => [...q, track]);
      setCurrent(track);
      setPosition(resume);
      setDuration(track.duration || 0);
      setLines([]);
      setLoading(true);
      setPlaying(false);
      seekOnLoad.current = resume;
      api
        .lyric(track)
        .then((result) => {
          if (request.current === token) setLines(result);
        })
        .catch(() => {});
      try {
        const result = await api.playUrl(track);
        if (request.current !== token) return;
        setQuality(result.quality);
        audio.current.src = result.url;
        loadedId.current = track.id;
        audio.current.load();
        if (autoPlay) await audio.current.play();
      } catch (error) {
        if (request.current === token) notify((error as Error).message);
      } finally {
        if (request.current === token) setLoading(false);
      }
    },
    [notify],
  );
  const toggle = useCallback(async () => {
    const track = latest.current.current || latest.current.queue[0];
    if (!track) {
      notify("先选择一首歌曲，或添加本地音乐");
      return;
    }
    if (audio.current.paused) {
      if (loadedId.current !== track.id)
        await play(track, undefined, latest.current.position);
      else {
        try {
          await audio.current.play();
        } catch {
          notify("播放失败，请重新选择歌曲");
        }
      }
    } else audio.current.pause();
  }, [play, notify]);
  const move = useCallback(
    (direction: number, ended = false) => {
      const {
        queue: q,
        current: t,
        shuffle: random,
        repeat: mode,
      } = latest.current;
      if (!q.length) return;
      const index = q.findIndex((item) => item.id === t?.id);
      if (ended && mode === "one" && t) {
        void play(t);
        return;
      }
      let next = index + direction;
      if (random && q.length > 1) {
        const others = q.filter((item) => item.id !== t?.id);
        void play(others[Math.floor(Math.random() * others.length)]);
        return;
      }
      if (ended && next >= q.length && mode === "off") {
        setPlaying(false);
        return;
      }
      next = (next + q.length) % q.length;
      void play(q[next]);
    },
    [play],
  );
  const seek = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    const bounded = Math.max(
      0,
      Math.min(
        value,
        audio.current.duration || latest.current.current?.duration || 0,
      ),
    );
    if (loadedId.current) audio.current.currentTime = bounded;
    setPosition(bounded);
  }, []);
  const toggleShuffle = useCallback(() => {
    setShuffle((value) => !value);
    setRepeat((mode) => (mode === "one" ? "all" : mode));
  }, []);
  const restore = useCallback((saved: SavedPlayer | null) => {
    if (saved) {
      setQueue(saved.queue || []);
      setVolume(saved.volume ?? 0.75);
      setRepeat(saved.repeat || "all");
      setShuffle(!!saved.shuffle);
      const track = saved.queue?.find((t) => t.id === saved.currentId);
      if (track) {
        setCurrent(track);
        setPosition(saved.position || 0);
        setDuration(track.duration || 0);
      }
    }
    setReady(true);
  }, []);
  const remove = (id: string) => {
    if (latest.current.current?.id === id) {
      ++request.current;
      audio.current.pause();
      audio.current.removeAttribute("src");
      audio.current.load();
      loadedId.current = "";
      setCurrent(null);
      setPosition(0);
      setDuration(0);
      setLines([]);
      setLoading(false);
    }
    setQueue((q) => q.filter((t) => t.id !== id));
  };
  const clear = () => {
    ++request.current;
    audio.current.pause();
    audio.current.removeAttribute("src");
    audio.current.load();
    loadedId.current = "";
    setQueue([]);
    setCurrent(null);
    setPosition(0);
    setDuration(0);
    setLines([]);
    setLoading(false);
  };
  useEffect(() => {
    const a = audio.current;
    const update = () => {
      setPosition(a.currentTime || 0);
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const metadata = () => {
      if (seekOnLoad.current > 0) {
        a.currentTime = Math.min(
          seekOnLoad.current,
          Math.max(0, a.duration - 0.1),
        );
        seekOnLoad.current = 0;
      }
      update();
    };
    const onPlay = () => setPlaying(true),
      onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setLoading(false);
      if (a.getAttribute("src"))
        notify(
          "无法播放此资源。在线歌曲请检查账号与地区权限，本地歌曲请检查文件。",
        );
    };
    const ended = () => move(1, true);
    a.addEventListener("timeupdate", update);
    a.addEventListener("loadedmetadata", metadata);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    a.addEventListener("ended", ended);
    return () => {
      a.removeEventListener("timeupdate", update);
      a.removeEventListener("loadedmetadata", metadata);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
      a.removeEventListener("ended", ended);
    };
  }, [move, notify]);
  useEffect(() => {
    audio.current.volume = volume;
  }, [volume]);
  useEffect(
    () =>
      api.subscribe("command", (data) => {
        if (data.name === "toggle") void toggle();
        if (data.name === "next") move(1);
        if (data.name === "previous") move(-1);
        if (data.name === "seek") seek(data.value);
        if (data.name === "toggleShuffle") toggleShuffle();
      }),
    [toggle, move, seek, toggleShuffle],
  );
  useEffect(() => {
    if (!ready) return;
    const save = () => {
      const s = latest.current;
      void api
        .savePlayer({
          queue: s.queue,
          currentId: s.current?.id || "",
          position: s.position,
          volume: s.volume,
          repeat: s.repeat,
          shuffle: s.shuffle,
        })
        .catch(() => {});
    };
    save();
    const timer = setInterval(save, 3000);
    window.addEventListener("beforeunload", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", save);
    };
  }, [ready, queue, current, volume, repeat, shuffle]);
  const lyricIndex = lines.reduce(
    (found, line, i) => (line.time <= position ? i : found),
    -1,
  );
  const lyric = lines[lyricIndex]?.text || "";
  useEffect(() => {
    api.publish({
      track: current,
      playing,
      position,
      duration,
      lyric,
      nextLyric: lines[lyricIndex + 1]?.text || "",
      quality,
      shuffle,
    });
  }, [
    current,
    playing,
    position,
    duration,
    lyric,
    lines,
    lyricIndex,
    quality,
    shuffle,
  ]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (current)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: current.cover ? [{ src: current.cover }] : [],
      });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => {
      if (audio.current.paused) void toggle();
    });
    navigator.mediaSession.setActionHandler("pause", () =>
      audio.current.pause(),
    );
    navigator.mediaSession.setActionHandler("nexttrack", () => move(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => move(-1));
    navigator.mediaSession.setActionHandler("seekto", (details) =>
      seek(details.seekTime || 0),
    );
  }, [current, playing, toggle, move, seek]);
  return {
    queue,
    setQueue,
    current,
    playing,
    loading,
    position,
    duration,
    volume,
    setVolume,
    repeat,
    setRepeat,
    shuffle,
    setShuffle,
    toggleShuffle,
    lines,
    lyricIndex,
    quality,
    play,
    toggle,
    move,
    seek,
    restore,
    remove,
    clear,
  };
}
