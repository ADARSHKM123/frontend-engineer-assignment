import { memo } from "react";

// One preview on the board: the screen name above a 1280×800 iframe (R1.1).
// The iframe shows a page from http://localhost:4001, a different origin from the app,
// so the app cannot read the page directly. It talks to the page's agent script instead.
//
// memo: the board re-renders on every pan/zoom step, but a preview only needs to
// re-render when its screen changes. This keeps panning smooth with 24 iframes.
function Preview({ screen }) {
  return (
    <div className="preview">
      <div className="preview-name">{screen.name}</div>
      <div className="preview-frame">
        <iframe src={screen.url} title={screen.name} width="1280" height="800" />
      </div>
    </div>
  );
}

export default memo(Preview);
