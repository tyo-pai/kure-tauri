import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { listen } from '@tauri-apps/api/event'
import { initDesktopShell, isTauriShell } from './desktop'

initDesktopShell()

interface RootErrorBoundaryState {
  error: Error | null
}

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Root render failed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-boot-error">
          <div className="app-boot-error__eyebrow">startup error</div>
          <h1 className="app-boot-error__title">Stash couldn&apos;t finish loading</h1>
          <p className="app-boot-error__message">{this.state.error.message}</p>
        </div>
      )
    }

    return this.props.children
  }
}

if (isTauriShell()) {
  void listen('toggle-shader-debug', () => {
    window.dispatchEvent(new CustomEvent('toggle-shader-debug'))
  })
}

if (window.desktopAPI?.platform) {
  document.documentElement.dataset.platform = window.desktopAPI.platform
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
)
