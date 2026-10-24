import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error("FitLens UI error", error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="container stack" style={{ padding: "60px 16px" }}>
          <h2>Something went wrong</h2>
          <p className="muted">Your saved looks are safe. Reload the page to continue.</p>
          <div>
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
