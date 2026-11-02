import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Music2,
  Pause,
  Play,
  ListMusic,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import type { Playback } from "./types";

const formatTime = (seconds = 0) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function Auxiliary() {
  const [state, setState] = useState<Playback>({});
  const [coverFailed, setCoverFailed] = useState(false);
  const resizeStart = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    void window.soundroom.getPlayback().then(setState);
    return window.soundroom.subscribe("playback", setState);
  }, []);
  useEffect(() => setCoverFailed(false), [state.track?.cover]);
  const progress = state.duration
    ? ((state.position || 0) / state.duration) * 100
    : 0;

  return (
    <div className="aux drag">
      <div className="mini-cover" aria-label="专辑封面">
        {state.track?.cover && !coverFailed ? (
          <img
            src={state.track.cover}
            alt=""
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <Music2 size={44} strokeWidth={1} />
        )}
      </div>
      <div className="mini-content">
        <div className="mini-meta">
          <strong title={state.track?.title}>
            {state.track?.title || "未在播放"}
          </strong>
          <span>{state.track?.artist || "未选择歌曲"}</span>
        </div>
        <div className="desktop-lyric" aria-live="off">
          <strong title={state.lyric}>
            {state.lyric || (state.track ? "暂无同步歌词" : "—")}
          </strong>
          <span>{state.nextLyric || "\u00a0"}</span>
        </div>
        <div className="mini-bottom">
          <div className="mini-controls">
            <button
              className={`mini-mode ${state.shuffle ? "is-active" : ""}`}
              title={
                state.shuffle
                  ? "随机播放 · 点击切换顺序播放"
                  : "顺序播放 · 点击切换随机播放"
              }
              aria-label="切换随机播放"
              aria-pressed={!!state.shuffle}
              onClick={() => window.soundroom.command("toggleShuffle")}
            >
              {state.shuffle ? <Shuffle size={16} /> : <ListMusic size={16} />}
            </button>
            <button
              title="上一首"
              aria-label="上一首"
              onClick={() => window.soundroom.command("previous")}
            >
              <SkipBack size={17} fill="currentColor" />
            </button>
            <button
              className="mini-play"
              title={state.playing ? "暂停" : "播放"}
              aria-label={state.playing ? "暂停" : "播放"}
              onClick={() => window.soundroom.command("toggle")}
            >
              {state.playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
            </button>
            <button
              title="下一首"
              aria-label="下一首"
              onClick={() => window.soundroom.command("next")}
            >
              <SkipForward size={17} fill="currentColor" />
            </button>
          </div>
          <span className="mini-time">
            {formatTime(state.position)} <i>/</i> {formatTime(state.duration)}
          </span>
        </div>
        <input
          className="mini-progress"
          aria-label="小窗播放进度"
          type="range"
          min="0"
          max={state.duration || 1}
          step="0.1"
          value={Math.min(state.position || 0, state.duration || 1)}
          disabled={!state.track}
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
          onChange={(event) =>
            window.soundroom.command("seek", Number(event.target.value))
          }
        />
      </div>
      <div className="mini-window-actions no-drag">
        <button
          title="打开主窗口"
          aria-label="打开主窗口"
          onClick={() => void window.soundroom.window("show")}
        >
          <ArrowUpRight size={14} />
        </button>
        <button
          title="关闭小窗"
          aria-label="关闭小窗"
          onClick={() => void window.soundroom.window("close-mini")}
        >
          <X size={14} />
        </button>
      </div>
      <button
        className="mini-resize no-drag"
        aria-label="调整小窗大小"
        title="拖动调整大小"
        onPointerDown={(event) => {
          event.preventDefault();
          resizeStart.current = {
            x: event.screenX,
            y: event.screenY,
            width: window.outerWidth,
            height: window.outerHeight,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeStart.current;
          if (!start) return;
          void window.soundroom.resizeMini({
            width: start.width + event.screenX - start.x,
            height: start.height + event.screenY - start.y,
          });
        }}
        onPointerUp={(event) => {
          resizeStart.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          resizeStart.current = null;
        }}
        onKeyDown={(event) => {
          if (
            event.ctrlKey ||
            event.altKey ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          void window.soundroom.resizeMini({
            width:
              window.outerWidth +
              (event.key === "ArrowRight"
                ? 10
                : event.key === "ArrowLeft"
                  ? -10
                  : 0),
            height:
              window.outerHeight +
              (event.key === "ArrowDown"
                ? 10
                : event.key === "ArrowUp"
                  ? -10
                  : 0),
          });
        }}
      />
    </div>
  );
}
