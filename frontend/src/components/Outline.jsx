import { useStore } from "../store.js";

// Label height on screen, in px. Must match .outline-label in styles.css.
const LABEL_HEIGHT = 16;

// An outline plus name label drawn on top of one element of a preview.
// It is rendered inside the preview's frame, so `rect` (the element's box in
// page pixels) can be used as-is: the board's pan/zoom transform moves and
// scales it together with the page, and the frame's overflow:hidden clips it
// to the preview's edges (R3.4).
//
// kind: "hover" (1px) or "selected" (2px, next milestone).
export default function Outline({ rect, name, kind }) {
  const zoom = useStore((s) => s.camera.zoom);

  // The label goes above the element, unless there's no room above it inside
  // the preview; then it goes below (R3.4). Its height in page pixels is
  // LABEL_HEIGHT / zoom, because the page is scaled by zoom on screen.
  const labelAbove = rect.y >= LABEL_HEIGHT / zoom;

  // If the element starts left of the preview, keep the label at the preview's edge.
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
