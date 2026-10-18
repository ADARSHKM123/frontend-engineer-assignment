import { memo, useEffect, useState } from "react";
import { useStore } from "../store.js";
import { startConnecting, stopConnecting, pageLoaded } from "../previewSync.js";
import Outline from "./Outline.jsx";

// A stable empty array, so previews without a selection always get the same
// value from the store and don't re-render.
const NONE = [];

// Stops a press on a button inside the board from starting a board pan (R1.2),
// which would capture the pointer and swallow the button's click.
const keepPressHere = (event) => event.stopPropagation();

// One preview on the board: the screen name above a 1280×800 iframe (R1.1).
// The iframe shows a page from http://localhost:4001, a different origin from the app,
// so the app cannot read the page directly. It talks to the page's agent script instead.
//
// memo: the board re-renders on every pan/zoom step, but a preview only needs to
// re-render when its screen changes. This keeps panning smooth with 24 iframes.
function Preview({ screen }) {
  // Each selector returns a value only for this preview, so the other 23 don't re-render.
  const hover = useStore((s) => (s.hover?.screenId === screen.id ? s.hover : null));
  const isActive = useStore((s) => s.activeScreenId === screen.id);
  // Interact mode keeps the selection but hides it (R1.5).
  const boxes = useStore((s) =>
    s.mode === "select" && s.selection.screenId === screen.id ? s.selectionBoxes : NONE,
  );
  const connection = useStore((s) => s.connections[screen.id]);
  const pageError = useStore((s) => s.pageErrors[screen.id]);

  // Retry makes a brand-new iframe (a new `key`), which loads the page again.
  const [attempt, setAttempt] = useState(0);

  // Start the 10-second connection timer whenever a new iframe is created (R6.2),
  // and stop it when the preview goes away, so it can't fail afterwards (R6.6).
  useEffect(() => {
    startConnecting(screen.id);
    return () => stopConnecting(screen.id);
  }, [screen.id, attempt]);

  // Don't draw the hover outline on top of an element that is already selected.
  const showHover = hover && !boxes.some((box) => box.id === hover.id);

  return (
    <div className="preview">
      <div className="preview-name">
        {screen.name}
        {pageError && <PageErrorBadge message={pageError} />}
      </div>
      <div className={isActive ? "preview-frame is-active" : "preview-frame"}>
        {connection === "failed" ? (
          // This preview only (R6.2): the rest of the board keeps working.
          <div className="preview-failed" role="alert" onPointerDown={keepPressHere}>
            <p>Couldn't connect to this preview</p>
            <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
          </div>
        ) : (
          <>
            <iframe
              key={attempt}
              src={screen.url}
              title={screen.name}
              width="1280"
              height="800"
              data-screen-id={screen.id}
              onLoad={() => pageLoaded(screen.id)}
            />
            {/* hidden: scrolled fully out of a scroll area inside the page. Still selected, no outline (R3.4). */}
            {boxes.map((box) =>
              box.hidden ? null : <Outline key={box.id} rect={box.rect} name={box.name} kind="selected" />,
            )}
            {showHover && <Outline rect={hover.rect} name={hover.name} kind="hover" />}
          </>
        )}
      </div>
    </div>
  );
}

// R6.3: a small badge next to the screen name; hovering it shows the page's error.
function PageErrorBadge({ message }) {
  return (
    <span className="page-error-badge" onPointerDown={keepPressHere}>
      Page error
      <span className="page-error-message" role="tooltip">
        {message}
      </span>
    </span>
  );
}

export default memo(Preview);
