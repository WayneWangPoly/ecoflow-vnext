import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; workspace: string };
type State = { error: Error | null };

export class WorkspaceRuntimeBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[EcoFlow workspace render failure]', this.props.workspace, error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.workspace !== this.props.workspace && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" data-workspace-runtime-failed={this.props.workspace}>
        <h1>Workspace unavailable</h1>
        <p>This workspace hit a rendering error. Other application areas remain available.</p>
        <p>{this.state.error.message || 'Unknown runtime error.'}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>Retry workspace</button>
      </section>
    );
  }
}
