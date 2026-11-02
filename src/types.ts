export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  source: "qq" | "local";
  mid?: string;
  songId?: number;
  mediaMid?: string;
  albumMid?: string;
  artists?: { id: string; name: string }[];
};
export type Playlist = {
  id: string;
  name: string;
  cover: string;
  count: number;
  kind: "created" | "collected";
  dirId: number;
};
export type Account = {
  loggedIn: boolean;
  uin?: string;
  nickname?: string;
  avatar?: string;
};
export type LyricLine = { time: number; text: string };
export type SavedPlayer = {
  queue: Track[];
  currentId: string;
  position: number;
  volume: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
};
export type Playback = {
  track?: Track | null;
  playing?: boolean;
  position?: number;
  duration?: number;
  lyric?: string;
  nextLyric?: string;
  quality?: string;
  shuffle?: boolean;
};
export type Collection = {
  name: string;
  tracks: Track[];
  cover?: string;
  total: number;
  hasMore: boolean;
  owned?: boolean;
  dirId?: number;
  description?: string;
  complete?: boolean;
  skipped?: number;
};
export type Library = {
  created: Playlist[];
  collected: Playlist[];
  warnings: string[];
};
export interface DesktopAPI {
  bootstrap(): Promise<{
    local: Track[];
    player: SavedPlayer | null;
    account: Account;
    version: string;
    shortcuts: {
      action: string;
      accelerator: string;
      label: string;
      registered: boolean;
    }[];
  }>;
  login(): Promise<void>;
  logout(): Promise<void>;
  account(): Promise<Account>;
  library(): Promise<Library>;
  collection(kind: string, id: string, page?: number): Promise<Collection>;
  collectionAll(
    kind: string,
    id: string,
    requestId: string,
  ): Promise<Collection>;
  cancelCollection(requestId: string): Promise<void>;
  search(
    query: string,
    page?: number,
  ): Promise<{ tracks: Track[]; total: number; hasMore: boolean }>;
  playUrl(track: Track): Promise<{ url: string; quality: string }>;
  lyric(track: Track): Promise<LyricLine[]>;
  importLocal(): Promise<{ tracks: Track[]; skipped: string[] }>;
  removeLocal(id: string): Promise<Track[]>;
  savePlayer(player: SavedPlayer): Promise<boolean>;
  like(track: Track, liked: boolean): Promise<{ liked: boolean }>;
  likeStatus(mids: string[]): Promise<Record<string, boolean>>;
  createPlaylist(name: string): Promise<{ id: string; name: string }>;
  deletePlaylist(id: string): Promise<void>;
  editPlaylist(
    id: string,
    track: Track,
    action: "add" | "remove",
  ): Promise<void>;
  window(action: string): Promise<boolean | void>;
  getPlayback(): Promise<Playback>;
  resizeMini(size: { width: number; height: number }): Promise<void>;
  publish(data: Playback): void;
  command(name: string, value?: number): void;
  subscribe(
    channel:
      | "playback"
      | "command"
      | "account"
      | "library"
      | "collection-progress",
    callback: (data: any) => void,
  ): () => void;
}
declare global {
  interface Window {
    soundroom: DesktopAPI;
  }
}
