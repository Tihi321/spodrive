import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { boot, useSession } from "./lib/session";
import { AlbumPage, ArtistPage, FolderPage, PlaylistPage } from "./pages/Details";
import { ConnectScreen, Splash } from "./pages/Gate";
import { Home } from "./pages/Home";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Shell } from "./ui/Shell";
import { Toasts } from "./ui/Toasts";

export function App() {
  const phase = useSession((s) => s.phase);
  useEffect(() => {
    void boot();
  }, []);

  let screen;
  switch (phase) {
    case "booting":
      screen = <Splash />;
      break;
    case "signedOut":
      screen = <ConnectScreen />;
      break;
    case "ready":
      screen = (
        <Shell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/album/:id" element={<AlbumPage />} />
            <Route path="/artist/:id" element={<ArtistPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/folder/:id" element={<FolderPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      );
      break;
  }
  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
