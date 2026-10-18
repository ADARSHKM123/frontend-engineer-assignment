import { useStore } from "../store.js";
import { retryDetails } from "../detailsSync.js";

const NONE = [];

// Browsers report "no background" as rgba(0, 0, 0, 0); show it as a word.
function readableColour(colour) {
  return colour === "rgba(0, 0, 0, 0)" ? "transparent" : colour;
}

// The Live fields (R5.1), in display order. Each one reads its value from an
// element's box: box.name, plus box.info, which the page re-sends whenever the
// element changes. Both the single view and the "N elements" view use this list.
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

// The inspector (R5): what's selected, read live from the page, plus its Details from the API.
export default function Inspector() {
  const ids = useStore((s) => s.selection.ids);
  const boxes = useStore((s) => (s.selection.ids.length ? s.selectionBoxes : NONE));
  const selectionGone = useStore((s) => s.selectionGone);

  if (ids.length === 0) {
    return (
      <section className="inspector">
        {/* R3.7: the selected element disappeared from its page. */}
        <p className="inspector-message">
          {selectionGone ? "This element no longer exists" : "Select an element to inspect it"}
        </p>
      </section>
    );
  }

  // The boxes of the selected elements we've heard about from the page so far.
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

      {/* Details only for a single element (R5.2). */}
      {ids.length === 1 && <DetailsSection />}
    </section>
  );
}

// One element: its values. Several: the value they all share, or "Mixed" (R5.2).
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

// Details from GET /elements/:key, with every state R5.1 and R6.2 ask for.
function DetailsSection() {
  const details = useStore((s) => s.details);

  let body;
  if (details.status === "none") body = <p className="inspector-message">No details</p>;
  else if (details.status === "notFound") body = <p className="inspector-message">No details for this element</p>;
  else if (details.status === "error") {
    body = (
      <div className="inspector-error" role="alert">
        <p>Couldn't load details.</p>
        <p className="muted">{details.error}</p>
        <button onClick={retryDetails}>Retry</button>
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
