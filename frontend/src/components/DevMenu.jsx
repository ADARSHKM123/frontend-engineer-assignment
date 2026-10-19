import { useState } from "react";
import { useStore } from "../store.js";
import { inRegion } from "../regions.js";

// Dev-only menu. Each trigger uses the app's real failure path: the backend's
// ?fail= / ?latency=, a page without the agent, or a throw inside a region.
export default function DevMenu() {
  const [open, setOpen] = useState(false);
  const dev = useStore((s) => s.dev);
  const screens = useStore((s) => s.screens);
  const activeScreenId = useStore((s) => s.activeScreenId);
  const [screenId, setScreenId] = useState(null);
  const { setDev, loadScreens } = useStore.getState();

  const target = screenId ?? activeScreenId ?? screens[0]?.id ?? null;
  const crashing = (region, id = null) => dev.crash?.region === region && (dev.crash.screenId ?? null) === id;
  const toggleCrash = (region, id = null) => setDev({ crash: crashing(region, id) ? null : { region, screenId: id } });
  const selectionScreen = useStore((s) => s.selection.screenId);

  const resetAll = () =>
    setDev({
      layersDelayMs: 0,
      crash: null,
      failScreens: false,
      failDetails: false,
      detailsDelayMs: 0,
      brokenPreview: null,
      throwNext: null,
    });

  return (
    <div className="dev-menu">
      <button className="dev-menu-toggle" onClick={() => setOpen(!open)}>
        Dev {open ? "▴" : "▾"}
      </button>

      {open && (
        <div className="dev-menu-panel">
          <h4>Board</h4>
          <Check label="GET /screens fails" checked={dev.failScreens} onChange={(v) => setDev({ failScreens: v })} />
          <button onClick={loadScreens}>Reload screens</button>
          <Toggle label="Render crash: board" on={crashing("board")} onClick={() => toggleCrash("board")} />
          <button onClick={() => setDev({ throwNext: { region: "board" } })}>
            Next board click / wheel / key throws
          </button>

          <h4>Preview</h4>
          <label className="dev-row">
            Preview
            <select value={target ?? ""} onChange={(e) => setScreenId(e.target.value)}>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Check
            label="Can't connect (10 s)"
            checked={dev.brokenPreview === target}
            onChange={(v) => setDev({ brokenPreview: v ? target : null })}
          />
          <Toggle label="Render crash: this preview" on={crashing("preview", target)} onClick={() => toggleCrash("preview", target)} />
          <button onClick={() => setDev({ throwNext: { region: "preview", screenId: target } })}>
            Next message from it throws
          </button>

          <h4>Layers</h4>
          <Check
            label="Pages answer in 5 s (rows / search time out)"
            checked={dev.layersDelayMs > 0}
            onChange={(v) => setDev({ layersDelayMs: v ? 5000 : 0 })}
          />
          <Toggle label="Render crash: layers panel" on={crashing("layers")} onClick={() => toggleCrash("layers")} />
          <button onClick={() => setDev({ throwNext: { region: "layers" } })}>Next layers click / key throws</button>
          <button
            onClick={() =>
              setTimeout(
                inRegion("layers", activeScreenId, () => {
                  throw new Error("Simulated error in a timer");
                }),
                0,
              )
            }
          >
            Throw in a timer (layers)
          </button>

          <h4>Inspector</h4>
          <Check label="GET /elements/:key fails" checked={dev.failDetails} onChange={(v) => setDev({ failDetails: v })} />
          <Check
            label="GET /elements/:key takes 2 s"
            checked={dev.detailsDelayMs > 0}
            onChange={(v) => setDev({ detailsDelayMs: v ? 2000 : 0 })}
          />
          <Toggle label="Render crash: inspector" on={crashing("inspector")} onClick={() => toggleCrash("inspector")} />
          <Toggle
            label="Render crash: details"
            on={crashing("details", selectionScreen)}
            onClick={() => toggleCrash("details", selectionScreen)}
          />

          <button className="dev-reset" onClick={resetAll}>
            Reset everything
          </button>
        </div>
      )}
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="dev-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// A button that shows whether its crash is switched on.
function Toggle({ label, on, onClick }) {
  return (
    <button className={on ? "is-on" : ""} onClick={onClick}>
      {on ? "■ " : ""}
      {label}
    </button>
  );
}
