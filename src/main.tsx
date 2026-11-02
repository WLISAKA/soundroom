import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Auxiliary } from "./Auxiliary";
import "./styles.css";
import "./mini.css";
const mode = location.hash.slice(1);
if (mode === "mini" || mode === "lyrics") document.title = "歌词小窗";
createRoot(document.getElementById("root")!).render(
  mode === "mini" || mode === "lyrics" ? <Auxiliary /> : <App />,
);
