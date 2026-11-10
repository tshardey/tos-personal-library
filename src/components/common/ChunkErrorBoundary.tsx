import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Defaults to a full page reload, which fetches the current build's chunks. */
  onReload?: () => void;
}

/**
 * Catches a lazy route that fails to load (a chunk gone after a deploy, or offline) and offers a
 * reload instead of a blank page.
 */
export default class ChunkErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Page failed to load", error instanceof Error ? error.name : "unknown");
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <div className="p-6">
        <p role="alert" className="mb-3">
          This page couldn't load. Check your connection and reload.
        </p>
        <button type="button" onClick={reload} className="rounded bg-stone-800 px-3 py-2 text-white">
          Reload
        </button>
      </div>
    );
  }
}
