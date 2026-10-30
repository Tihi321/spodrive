import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { installFullscreenKeeper } from "./lib/fullscreen";
import { toast } from "./state/toasts";
import "./index.css";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast("A new version is available", { action: { label: "Reload", run: () => void updateSW(true) } });
  },
  onRegisterError(e) {
    console.warn("[spodrive] service worker registration failed", e);
  },
});

installFullscreenKeeper();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
