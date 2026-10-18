import { Component } from "react";
import { useStore } from "../store.js";
import { report } from "../../report.js";

// A failure region (R6.1). If anything inside it throws while rendering, React
// stops at the nearest boundary and shows ITS fallback instead; everything outside
// keeps working (R6.2). The error is reported exactly once (R6.4).
//
// Error boundaries must be class components: React only offers the
// "catch an error from my children" hooks (getDerivedStateFromError and
// componentDidCatch) on classes.
//
// Props:
//   region    "board" | "preview" | "layers" | "inspector"   (passed to report())
//   screenId  the preview this region belongs to, or null
//   label     what to call it in the message, e.g. "the inspector"
//   className so the fallback takes the region's place in the layout
export default class RegionBoundary extends Component {
  state = { error: null };

  // Step 1, during rendering: remember the error, so render() shows the fallback.
  static getDerivedStateFromError(error) {
    return { error };
  }

  // Step 2, after rendering: report it. React calls this once per caught error.
  componentDidCatch(error) {
    report(error, { region: this.props.region, screenId: this.props.screenId ?? null });
  }

  // Retry: forget the error and draw the children again. If they throw again,
  // that's a new failure, caught and reported again (R6.4).
  retry = () => this.setState({ error: null });

  render() {
    const { region, screenId, label, className, children } = this.props;

    if (this.state.error) {
      return (
        // stopPropagation: inside the board, pressing Retry must not start a board pan.
        <div
          className={`region-error ${className ?? ""}`}
          role="alert"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p>Something went wrong in {label}.</p>
          <p className="muted">{String(this.state.error.message)}</p>
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
