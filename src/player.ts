import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricLine, QualityPreference, SavedPlayer, Track } from "./types";

const api = window.soundroom;
const lowerTier = {
  lossless: "high",
  high: "higher",
  higher: "standard",
  standard: undefined,
} as const;

function waitForAudio(audio: HTMLAudioElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", cancelled);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("无法读取音频"));
    const cancelled = () =>
      finish(new DOMException("已取消播放", "AbortError"));
    const timeout = setTimeout(failed, 12000);
    audio.addEventListener("loadedmetadata", ready);
    audio.addEventListener("error", failed);
    signal.addEventListener("abort", cancelled);
  });
}
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
  const [quality, setQuality] = useState("");
  const [preferredQuality, setPreferredQuality] =
    useState<QualityPreference>("high");
  const [ready, setReady] = useState(false);
  const request = useRef(0);
  const loadedId = useRef("");
  const loadedTier = useRef<QualityPreference | undefined>(undefined);
  const playbackAttempt = useRef<AbortController | null>(null);
  const pending = useRef<{ autoPlay: boolean; resume: number } | null>(null);
  const seekOnLoad = useRef(0);
  const latest = useRef({
    queue,
    current,
    position,
    volume,
    repeat,
    shuffle,
    preferredQuality,
  });
  latest.current = {
    queue,
    current,
    position,
    volume,
    repeat,
    shuffle,
    preferredQuality,
  };
  const play = useCallback(
    async (
      track: Track,
      list?: Track[],
      resume = 0,
      autoPlay = true,
      ceiling?: QualityPreference,
    ) => {
      const token = ++request.current;
      playbackAttempt.current?.abort();
      const attempt = new AbortController();
      playbackAttempt.current = attempt;
      pending.current = { autoPlay, resume };
      audio.current.pause();
      loadedId.current = "";
      loadedTier.current = undefined;
      audio.current.removeAttribute("src");
      audio.current.load();
      if (list) setQueue([...new Map(list.map((t) => [t.id, t])).values()]);
      else if (!latest.current.queue.some((t) => t.id === track.id))
        setQueue((q) => [...q, track]);
      setCurrent(track);
      setPosition(resume);
      setDuration(track.duration || 0);
      if (!ceiling) setLines([]);
      setLoading(true);
      setQuality("");
      setPlaying(false);
      seekOnLoad.current = resume;
      if (!ceiling)
        api
          .lyric(track)
          .then((result) => {
            if (request.current === token) setLines(result);
          })
          .catch(() => {});
      try {
        let preference: QualityPreference | undefined =
          ceiling ?? latest.current.preferredQuality;
        const player = audio.current;
        while (preference && request.current === token) {
          const result = await api.playUrl(track, preference);
          if (request.current !== token) return;
          const position = pending.current?.resume ?? resume;
          seekOnLoad.current = position;
          const metadata = waitForAudio(player, attempt.signal);
          player.src = result.url;
          player.load();
          try {
            await metadata;
            if (request.current !== token) return;
            if (autoPlay) await player.play();
          } catch (error) {
            if (request.current !== token) return;
            player.removeAttribute("src");
            player.load();
            preference =
              track.source !== "local" && result.qualityLevel
                ? lowerTier[result.qualityLevel]
                : undefined;
            if (!preference || (error as Error).name === "NotAllowedError")
              throw error;
            continue;
          }
          if (request.current !== token) return;
          loadedId.current = track.id;
          loadedTier.current = result.qualityLevel;
          setQuality(result.quality);
          return;
        }
      } catch (error) {
        if (request.current === token) notify((error as Error).message);
      } finally {
        if (request.current === token) {
          pending.current = null;
          playbackAttempt.current = null;
          setLoading(false);
        }
      }
    },
    [notify],
  );
  const changeQuality = (value: QualityPreference) => {
    const { current: track, position, preferredQuality } = latest.current;
    if (value === preferredQuality) return;
    latest.current.preferredQuality = value;
    setPreferredQuality(value);
    if (
      track &&
      track.source !== "local" &&
      (loadedId.current || pending.current)
    ) {
      void play(
        track,
        undefined,
        pending.current?.resume ?? position,
        pending.current?.autoPlay ?? !audio.current.paused,
      );
    }
  };
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
    else if (pending.current) {
      pending.current.resume = bounded;
      seekOnLoad.current = bounded;
    }
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
      setPreferredQuality(saved.preferredQuality ?? "high");
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
      playbackAttempt.current?.abort();
      pending.current = null;
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
    playbackAttempt.current?.abort();
    pending.current = null;
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
      if (pending.current || !a.getAttribute("src")) return;
      const { current: track, position } = latest.current;
      const tier = loadedTier.current;
      const resumePlaying = !a.paused;
      loadedId.current = "";
      loadedTier.current = undefined;
      if (track && tier && lowerTier[tier]) {
        void play(track, undefined, position, resumePlaying, lowerTier[tier]);
        return;
      }
      setPlaying(false);
      setQuality("");
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
  }, [move, notify, play]);
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
          preferredQuality: s.preferredQuality,
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
  }, [ready, queue, current, volume, repeat, shuffle, preferredQuality]);
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
      lyricIndex,
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
    preferredQuality,
    changeQuality,
    play,
    toggle,
    move,
    seek,
    restore,
    remove,
    clear,
  };
}
