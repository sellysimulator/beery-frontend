import { Component, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches a render-time crash so one broken screen does not blank the whole
 * app. React offers no hook equivalent, so this stays a class component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-ink-muted">
          This screen could not be displayed. The game itself is unaffected — the server
          holds all of the state, so reloading will pick it up again.
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-md border border-border-strong px-4 py-2 text-sm hover:border-brand hover:text-brand"
        >
          Try again
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
