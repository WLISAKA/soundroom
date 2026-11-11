import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { Theme } from "./types";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
}>({ theme: "classic", setTheme: async () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("classic");
  useEffect(() => {
    const api = window.soundroom;
    if (!api) return;
    let active = true;
    let changed = false;
    const unsubscribe = api.subscribe("theme", (value: Theme) => {
      changed = true;
      updateTheme(value);
    });
    void api
      .getTheme()
      .then((value) => {
        if (active && !changed) updateTheme(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = async (value: Theme) => {
    await window.soundroom.setTheme(value);
  };
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
