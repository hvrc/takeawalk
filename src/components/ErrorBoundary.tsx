import { Component, type ReactNode } from 'react'

/** If anything crashes while drawing the app, show a way out instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('app crashed', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="splash">
        <h1 className="wordmark">take a walk</h1>
        <div className="error-box">
          Something went wrong on this page.
          <br />
          <small>{this.state.error.message}</small>
        </div>
        <button className="btn btn-accent" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
