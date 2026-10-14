import { useEffect } from "react";
import { useStore } from "../store.js";
import Preview from "./Preview.jsx";

// Fixed view for now: 25% zoom, small offset, so the whole grid fits on screen.
// Panning and zooming (R1.2, R1.3) will make this camera change.
const camera = { x: 40, y: 40, zoom: 0.25 };

// The board: loads the screens and lays out one preview per screen in a grid (R1.1).
export default function Board() {
  const screens = useStore((s) => s.screens);
  const status = useStore((s) => s.screensStatus);
  const error = useStore((s) => s.screensError);
  const loadScreens = useStore((s) => s.loadScreens);
  const cancelScreens = useStore((s) => s.cancelScreens);

  useEffect(() => {
    loadScreens();
    return cancelScreens;
  }, [loadScreens, cancelScreens]);

  if (status === "loading") {
    return <div className="board board-message">Loading screens…</div>;
  }

  if (status === "error") {
    return (
      <div className="board board-message" role="alert">
        <p>Couldn't load the screens.</p>
        <p className="muted">{error}</p>
        <button onClick={loadScreens}>Retry</button>
      </div>
    );
  }

  return (
    <div className="board">
      {/* The "world": everything on the board moves together when the camera changes. */}
      <div
        className="board-world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {screens.map((screen) => (
          <Preview key={screen.id} screen={screen} />
        ))}
      </div>
    </div>
  );
}
