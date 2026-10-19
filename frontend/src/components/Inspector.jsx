import { useStore } from "../store.js";
import { retryDetails } from "../detailsSync.js";
import { inRegion } from "../regions.js";
import RegionBoundary from "./RegionBoundary.jsx";

const NONE = [];

// Browsers report "no background" as rgba(0, 0, 0, 0).
function readableColour(colour) {
  return colour === "rgba(0, 0, 0, 0)" ? "transparent" : colour;
}

// Read from the selection boxes, which the page re-sends whenever the element changes.
const LIVE_FIELDS = [
  { label: "Name", value: (box) => box.name },
  { label: "Tag", value: (box) => box.info.tag },
  { label: "ID", value: (box) => box.info.elementId || "—" },
  { label: "Classes", value: (box) => box.info.classes || "—" },
  { label: "Size", value: (box) => `${box.info.width} × ${box.info.height}` },
  { label: "Position", value: (box) => `${box.info.x}, ${box.info.y}` },
  { label: "Text", value: (box) => box.info.text || "—" },
  { label: "Text colour", value: (box) => readableColour(box.info.color), colour: true },
  { label: "Background", value: (box) => readableColour(box.info.background), colour: true },
  { label: "Font", value: (box) => box.info.fontFamily },
  { label: "Font size", value: (box) => box.info.fontSize },
  { label: "Font weight", value: (box) => box.info.fontWeight },
];

export default function Inspector() {
  const ids = useStore((s) => s.selection.ids);
  const screenId = useStore((s) => s.selection.screenId);
  const boxes = useStore((s) => (s.selection.ids.length ? s.selectionBoxes : NONE));
  const selectionGone = useStore((s) => s.selectionGone);

  if (ids.length === 0) {
    return (
      <section className="inspector">
        <p className="inspector-message">
          {selectionGone ? "This element no longer exists" : "Select an element to inspect it"}
        </p>
      </section>
    );
  }

  const selected = boxes.filter((box) => ids.includes(box.id) && box.info);

  return (
    <section className="inspector">
      <h3 className="inspector-title">{ids.length === 1 ? selected[0]?.name ?? "…" : `${ids.length} elements`}</h3>

      <h4 className="inspector-heading">Live</h4>
      {selected.length === 0 ? (
        <p className="inspector-message">Reading the element…</p>
      ) : (
        <LiveFields boxes={selected} />
      )}

      {/* Its own failure region: if Details break, Live values still show. */}
      {ids.length === 1 && (
        <RegionBoundary
          region="details"
          screenId={screenId}
          elementKey={selected[0]?.info.key ?? undefined}
          label="the details"
        >
          <DetailsSection screenId={screenId} />
        </RegionBoundary>
      )}
    </section>
  );
}

// With several elements, each field shows the shared value or "Mixed".
function LiveFields({ boxes }) {
  return (
    <dl className="inspector-fields">
      {LIVE_FIELDS.map((field) => {
        const values = boxes.map(field.value);
        const shared = values.every((v) => v === values[0]);
        const value = shared ? values[0] : "Mixed";
        return (
          <div className="inspector-field" key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {field.colour && shared && <span className="swatch" style={{ background: value }} />}
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function DetailsSection({ screenId }) {
  const details = useStore((s) => s.details);

  let body;
  if (details.status === "none") body = <p className="inspector-message">No details</p>;
  else if (details.status === "notFound") body = <p className="inspector-message">No details for this element</p>;
  else if (details.status === "error") {
    body = (
      <div className="inspector-error" role="alert">
        <p>Couldn't load details.</p>
        <p className="muted">{details.error}</p>
        <button onClick={inRegion("details", screenId, retryDetails)}>Retry</button>
      </div>
    );
  } else if (details.status === "ready") {
    body = (
      <dl className="inspector-fields">
        {["component", "description", "status", "owner"].map((field) => (
          <div className="inspector-field" key={field}>
            <dt>{field[0].toUpperCase() + field.slice(1)}</dt>
            <dd>{details.data[field]}</dd>
          </div>
        ))}
      </dl>
    );
  } else {
    body = <p className="inspector-message">Loading details…</p>;
  }

  return (
    <>
      <h4 className="inspector-heading">Details</h4>
      {body}
    </>
  );
}
