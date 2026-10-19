import { useStore } from "./store.js";
import Board from "./components/Board.jsx";
import LayersPanel from "./components/LayersPanel.jsx";
import Inspector from "./components/Inspector.jsx";
import RegionBoundary from "./components/RegionBoundary.jsx";
import DevMenu from "./components/DevMenu.jsx";

// Board, layers panel and inspector are separate failure regions.
export default function App() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const zoom = useStore((s) => s.camera.zoom);

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Board Viewer</strong>
        <div className="mode-toggle">
          <button className={mode === "select" ? "active" : ""} onClick={() => setMode("select")}>
            Select (V)
          </button>
          <button className={mode === "interact" ? "active" : ""} onClick={() => setMode("interact")}>
            Interact (I)
          </button>
        </div>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        {/* Vite removes this from production builds. */}
        {import.meta.env.DEV && <DevMenu />}
      </header>

      <RegionBoundary region="board" label="the board" className="board">
        <Board />
      </RegionBoundary>

      <aside className="sidebar">
        <RegionBoundary region="layers" label="the layers panel" className="layers">
          <LayersPanel />
        </RegionBoundary>
        <RegionBoundary region="inspector" label="the inspector" className="inspector">
          <Inspector />
        </RegionBoundary>
      </aside>
    </div>
  );
}
