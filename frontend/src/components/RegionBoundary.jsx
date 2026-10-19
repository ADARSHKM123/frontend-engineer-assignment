import { Component } from "react";
import { useStore } from "../store.js";
import { failRegion, regionKey } from "../regions.js";

// A failure region: shows its error and Retry for a render error, or for a
// failure regions.js recorded from a handler, timer or message.
export default function RegionBoundary(props) {
  // Class components can't use hooks, so this wrapper reads the store for it.
  const key = regionKey(props.region, props.screenId);
  const storeError = useStore((s) => s.regionErrors[key]);
  return <Boundary {...props} storeError={storeError} errorKey={key} />;
}

// Error boundaries must be classes: React only offers getDerivedStateFromError
// and componentDidCatch on class components.
class Boundary extends Component {
  state = { renderError: null };

  static getDerivedStateFromError(renderError) {
    return { renderError };
  }

  componentDidCatch(error) {
    const { region, screenId, elementKey } = this.props;
    failRegion(region, screenId, error, elementKey ? { elementKey } : {});
  }

  retry = () => {
    this.setState({ renderError: null });
    useStore.getState().clearRegionError(this.props.errorKey);
  };

  render() {
    const { region, screenId, label, className, children, storeError } = this.props;
    const error = this.state.renderError ?? storeError;

    if (error) {
      return (
        // Inside the board, pressing Retry must not start a board pan.
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

// Dev menu: throws while rendering when a crash is switched on for this region.
function DevCrashSwitch({ region, screenId }) {
  const crash = useStore((s) => s.dev.crash);
  if (crash?.region === region && (crash.screenId ?? null) === (screenId ?? null)) {
    throw new Error(`Simulated render error in ${region}`);
  }
  return null;
}
