const PLAYER_SHORTCUTS = [
  {
    command: "toggle",
    action: "播放 / 暂停",
    accelerator: "Control+Alt+Space",
    label: "Ctrl + Alt + 空格",
  },
  {
    command: "previous",
    action: "上一首",
    accelerator: "Control+Alt+Left",
    label: "Ctrl + Alt + ←",
  },
  {
    command: "next",
    action: "下一首",
    accelerator: "Control+Alt+Right",
    label: "Ctrl + Alt + →",
  },
];

function registerPlayerShortcuts(globalShortcut, send) {
  const result = PLAYER_SHORTCUTS.map((shortcut) => {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcut.accelerator, () =>
        send(shortcut.command),
      );
    } catch {}
    return { ...shortcut, registered };
  });
  for (const [accelerator, command] of [
    ["MediaPlayPause", "toggle"],
    ["MediaNextTrack", "next"],
    ["MediaPreviousTrack", "previous"],
  ]) {
    try {
      globalShortcut.register(accelerator, () => send(command));
    } catch {}
  }
  return result;
}
module.exports = { PLAYER_SHORTCUTS, registerPlayerShortcuts };
