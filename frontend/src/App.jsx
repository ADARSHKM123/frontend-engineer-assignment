import { useStore } from "./store.js";
import Board from "./components/Board.jsx";

// App shell: toolbar on top, board in the middle, layers and inspector on the side.
// Layers and inspector are placeholders for now.
export default function App() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const zoom = useStore((s) => s.camera.zoom);
  const selectionGone = useStore((s) => s.selectionGone && s.selection.ids.length === 0);

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
        {/* Placeholder until the inspector milestone (R5); R3.7's message already shows here. */}
        <section className="inspector">
          {selectionGone ? <p className="inspector-gone">This element no longer exists</p> : "Inspector"}
        </section>
      </aside>
    </div>
  );
}
