import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { PAGES_ORIGIN } from "../config.js";
import Preview from "./Preview.jsx";

// How fast the wheel zooms. One mouse-wheel notch (deltaY ≈ 100) zooms about 18%.
const ZOOM_SPEED = 0.002;

// Wheel deltas can be in pixels, lines or pages (deltaMode 0, 1, 2). Convert to pixels.
function toPixels(delta, deltaMode) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

// The board: loads the screens and lays out one preview per screen in a grid (R1.1).
// Drag or wheel over empty space pans it (R1.2). Ctrl/Cmd + wheel zooms it (R1.3).
export default function Board() {
  const screens = useStore((s) => s.screens);
  const status = useStore((s) => s.screensStatus);
  const error = useStore((s) => s.screensError);
  const camera = useStore((s) => s.camera);
  const loadScreens = useStore((s) => s.loadScreens);
  const cancelScreens = useStore((s) => s.cancelScreens);

  const boardRef = useRef(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    loadScreens();
    return cancelScreens;
  }, [loadScreens, cancelScreens]);

  // Wheel over the board itself (empty space and screen names).
  // Added by hand because React's onWheel is passive, and passive listeners
  // cannot call preventDefault() to stop the browser zooming the whole app.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    function onWheel(event) {
      event.preventDefault();
      const { panBy, zoomAt } = useStore.getState();
      const dx = toPixels(event.deltaX, event.deltaMode);
      const dy = toPixels(event.deltaY, event.deltaMode);

      if (event.ctrlKey || event.metaKey) {
        const rect = board.getBoundingClientRect();
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-dy * ZOOM_SPEED));
      } else {
        panBy(-dx, -dy);
      }
    }

    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [status]); // the board element is only rendered once status is "ready"

  // Ctrl/Cmd + wheel over a preview arrives from that page's agent script (R1.3).
  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== PAGES_ORIGIN) return; // only trust the preview pages
      if (event.data?.source !== "figr-agent" || event.data.type !== "zoom-wheel") return;

      // Find which preview sent it, so we know where that page sits on screen.
      const iframe = [...document.querySelectorAll(".preview iframe")].find(
        (frame) => frame.contentWindow === event.source,
      );
      const board = boardRef.current;
      if (!iframe || !board) return;

      // The page reports the pointer in page pixels. On screen, the page is scaled by zoom.
      const { zoom } = useStore.getState().camera;
      const frameRect = iframe.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const px = frameRect.left - boardRect.left + event.data.x * zoom;
      const py = frameRect.top - boardRect.top + event.data.y * zoom;
      const dy = toPixels(event.data.deltaY, event.data.deltaMode);

      useStore.getState().zoomAt(px, py, Math.exp(-dy * ZOOM_SPEED));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Drag on empty board space pans (R1.2). Pointer capture keeps the drag going
  // even when the pointer moves over an iframe or outside the window.
  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onPointerMove(event) {
    if (!panning) return;
    useStore.getState().panBy(event.movementX, event.movementY);
  }

  function stopPanning() {
    setPanning(false);
  }

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
    <div
      ref={boardRef}
      className={panning ? "board is-panning" : "board"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopPanning}
      onPointerCancel={stopPanning}
    >
      {/* The "world": everything on the board moves together when the camera changes.
          --zoom lets CSS keep the screen names the same size at every zoom level. */}
      <div
        className="board-world"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          "--zoom": camera.zoom,
        }}
      >
        {screens.map((screen) => (
          <Preview key={screen.id} screen={screen} />
        ))}
      </div>
    </div>
  );
}
