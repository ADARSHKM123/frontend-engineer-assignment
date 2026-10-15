import { memo } from "react";
import { useStore } from "../store.js";
import Outline from "./Outline.jsx";

// One preview on the board: the screen name above a 1280×800 iframe (R1.1).
// The iframe shows a page from http://localhost:4001, a different origin from the app,
// so the app cannot read the page directly. It talks to the page's agent script instead.
//
// memo: the board re-renders on every pan/zoom step, but a preview only needs to
// re-render when its screen changes. This keeps panning smooth with 24 iframes.
function Preview({ screen }) {
  // Only the preview that owns the hover gets it; the other 23 get null and don't re-render.
  const hover = useStore((s) => (s.hover?.screenId === screen.id ? s.hover : null));

  return (
    <div className="preview">
      <div className="preview-name">{screen.name}</div>
      <div className="preview-frame">
        <iframe
          src={screen.url}
          title={screen.name}
          width="1280"
          height="800"
          data-screen-id={screen.id}
        />
        {hover && <Outline rect={hover.rect} name={hover.name} kind="hover" />}
      </div>
    </div>
  );
}

export default memo(Preview);
