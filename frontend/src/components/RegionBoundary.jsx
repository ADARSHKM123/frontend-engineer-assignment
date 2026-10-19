import { Component } from "react";
import { useStore } from "../store.js";
import { failRegion, regionKey } from "../regions.js";

// A failure region (R6.1). Its error and Retry replace the region, while
// everything outside keeps working (R6.2). It shows an error in two cases:
//   1. something inside it threw WHILE RENDERING (React catches that for us)
//   2. regions.js recorded a failure for it from a handler, timer, message or
//      response (R6.5): store.regionErrors
// Both go through failRegion(), so both are reported exactly once (R6.4).
//
// Props:
//   region     "board" | "preview" | "layers" | "inspector" | "details"
//   screenId   the preview this region belongs to, or null
//   elementKey optional, passed on to report() (for Details)
//   label      what to call it in the message, e.g. "the inspector"
//   className  so the fallback takes the region's place in the layout
export default function RegionBoundary(props) {
  // Class components can't use hooks, so this small wrapper reads the store for it.
  const key = regionKey(props.region, props.screenId);
  const storeError = useStore((s) => s.regionErrors[key]);
  return <Boundary {...props} storeError={storeError} errorKey={key} />;
}

// Error boundaries must be class components: React only offers the "catch an
// error from my children" methods (getDerivedStateFromError, componentDidCatch)
// on classes.
class Boundary extends Component {
  state = { renderError: null };

  // During rendering: remember the error, so render() shows the fallback.
  static getDerivedStateFromError(renderError) {
    return { renderError };
  }

  // After rendering: record and report it, the same way as every other failure.
  componentDidCatch(error) {
    const { region, screenId, elementKey } = this.props;
    failRegion(region, screenId, error, elementKey ? { elementKey } : {});
  }

  // Retry: forget the error and draw the children again. If they fail again,
  // that's a new failure, reported again (R6.4).
  retry = () => {
    this.setState({ renderError: null });
    useStore.getState().clearRegionError(this.props.errorKey);
  };

  render() {
    const { region, screenId, label, className, children, storeError } = this.props;
    const error = this.state.renderError ?? storeError;

    if (error) {
      return (
        // stopPropagation: inside the board, pressing Retry must not start a board pan.
        <div
          className={`region-error ${className ?? ""}`}
          role="alert"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p>Something went wrong in {label}.</p>
          <p className="muted">{String(error.message ?? error)}</p>
          <button onClick={this.retry}>Retry</button>
        </div>
      );
    }

    return (
      <>
        <DevCrashSwitch region={region} screenId={screenId} />
        {children}
      </>
    );
  }
}

// Dev-only (R6.7): throws while rendering when the dev menu has switched on a
// crash for this region, so the boundary above can be shown working.
function DevCrashSwitch({ region, screenId }) {
  const crash = useStore((s) => s.dev.crash);
  if (crash?.region === region && (crash.screenId ?? null) === (screenId ?? null)) {
    throw new Error(`Simulated render error in ${region}`);
  }
  return null;
}
