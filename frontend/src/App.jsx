import { useStore } from "./store.js";
import Board from "./components/Board.jsx";

// App shell: toolbar on top, board in the middle, layers and inspector on the side.
// Layers and inspector are placeholders for now.
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
      </header>

      <Board />

      <aside className="sidebar">
        <section className="layers">Layers</section>
        <section className="inspector">Inspector</section>
      </aside>
    </div>
  );
}
