import { memo, useEffect, useState } from "react";
import { useStore } from "../store.js";
import { startConnecting, stopConnecting, pageLoaded } from "../previewSync.js";
import Outline from "./Outline.jsx";
import { inRegion } from "../regions.js";
import { PAGES_ORIGIN } from "../config.js";

// Dev menu: a page without the agent, so it never says "ready".
const BROKEN_PAGE_URL = `${PAGES_ORIGIN}/this-page-does-not-exist.html`;

const NONE = []; // stable, so previews without a selection don't re-render

// A press on a button inside the board must not start a pan, which would swallow the click.
const keepPressHere = (event) => event.stopPropagation();

// memo: the board re-renders on every pan or zoom step; previews don't need to.
function Preview({ screen }) {
  // Each selector returns something only for this preview, so the other 23 don't re-render.
  const hover = useStore((s) => (s.hover?.screenId === screen.id ? s.hover : null));
  const isActive = useStore((s) => s.activeScreenId === screen.id);
  // Interact mode keeps the selection but hides it.
  const boxes = useStore((s) =>
    s.mode === "select" && s.selection.screenId === screen.id ? s.selectionBoxes : NONE,
  );
  const connection = useStore((s) => s.connections[screen.id]);
  const broken = useStore((s) => s.dev.brokenPreview === screen.id);
  const pageError = useStore((s) => s.pageErrors[screen.id]);

  // Retry gives the iframe a new key, so React creates a fresh one that loads again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    startConnecting(screen.id);
    return () => stopConnecting(screen.id);
  }, [screen.id, attempt]);

  const showHover = hover && !boxes.some((box) => box.id === hover.id);

  return (
    <div className="preview">
      <div className="preview-name">
        {screen.name}
        {pageError && <PageErrorBadge message={pageError} />}
      </div>
      <div className={isActive ? "preview-frame is-active" : "preview-frame"}>
        {connection === "failed" ? (
          <div className="preview-failed" role="alert" onPointerDown={keepPressHere}>
            <p>Couldn't connect to this preview</p>
            <button onClick={inRegion("preview", screen.id, () => setAttempt((n) => n + 1))}>Retry</button>
          </div>
        ) : (
          <>
            <iframe
              key={attempt}
              src={broken ? BROKEN_PAGE_URL : screen.url}
              title={screen.name}
              width="1280"
              height="800"
              data-screen-id={screen.id}
              onLoad={inRegion("preview", screen.id, () => pageLoaded(screen.id))}
            />
            {/* hidden = scrolled out of a scroll area inside the page: still selected, no outline. */}
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
