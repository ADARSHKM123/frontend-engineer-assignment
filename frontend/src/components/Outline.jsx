import { useStore } from "../store.js";

const LABEL_HEIGHT = 16; // must match .outline-label in styles.css

// Drawn inside the preview frame in page pixels, so the board's transform moves it
// with the page and the frame's overflow: hidden clips it.
export default function Outline({ rect, name, kind }) {
  const zoom = useStore((s) => s.camera.zoom);

  // Below the element when there's no room above it inside the preview.
  const labelAbove = rect.y >= LABEL_HEIGHT / zoom;

  const labelLeft = Math.max(0, -rect.x);

  return (
    <div
      className={`outline outline-${kind}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div className={`outline-label ${labelAbove ? "above" : "below"}`} style={{ left: labelLeft }}>
        {name}
      </div>
    </div>
  );
}
