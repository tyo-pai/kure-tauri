import { useState } from 'react'
import type { VaultStatus } from '../../types'
import './SettingsView.css'

interface SettingsViewProps {
  vaultStatus: VaultStatus | null
  hasAIKey: boolean
  onSetApiKey: (key: string) => void | Promise<void>
  onPickVaultFolder: () => void | Promise<void>
}

export function SettingsView({
  vaultStatus,
  hasAIKey,
  onSetApiKey,
  onPickVaultFolder
}: SettingsViewProps) {
  const hasConfirmedVault = vaultStatus?.configured === true
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyValue, setKeyValue] = useState('')

  const submitApiKey = async () => {
    const value = keyValue.trim()
    if (!value) return
    await onSetApiKey(value)
    setKeyValue('')
    setShowKeyInput(false)
  }

  return (
    <div className="settings-view scroll-area">
      <div className="settings-view-hero">
        <h1 className="settings-view-title">Settings</h1>
        <p className="settings-view-description">
          Choose where Stash stores your markdown notes, attachments, cache, and local search data.
          You can change this anytime without hunting through the menu bar.
        </p>
      </div>

      <section className="settings-section">
        <div className="settings-card-header">
          <div className="settings-card-copy">
            <div className="settings-card-eyebrow">vault folder</div>
            <p className="settings-card-description">
              {hasConfirmedVault
                ? 'Stash will read and write your library from this folder.'
                : 'No vault folder has been confirmed yet. Pick a vault folder before Stash starts reading your library.'}
            </p>

            <div className="settings-path-value">
              {vaultStatus?.path ?? 'Loading vault status...'}
            </div>

            {!hasConfirmedVault && vaultStatus?.path && (
              <div className="settings-callout">
                Stash is not using this path yet. It is only shown as a suggested or previously used location.
              </div>
            )}
          </div>

          <button
            type="button"
            className="settings-card-action"
            onClick={() => void onPickVaultFolder()}
          >
            {hasConfirmedVault ? 'change folder' : 'choose folder'}
          </button>
        </div>
      </section>

      <section className="settings-section settings-section--compact">
        <div className="settings-card-header">
          <div className="settings-card-copy">
            <div className="settings-card-eyebrow">Local AI Tools</div>
            <p className="settings-card-description">
              Enable semantic search, summaries, and automatic tagging with your OpenAI key.
            </p>
          </div>

          {hasAIKey ? (
            <div className="settings-status-pill">
              <span className="settings-status-dot" />
              <span>active</span>
            </div>
          ) : !showKeyInput ? (
            <button
              type="button"
              className="settings-card-action settings-card-action--secondary"
              onClick={() => setShowKeyInput(true)}
            >
              setup ai
            </button>
          ) : null}
        </div>

        {showKeyInput ? (
          <div className="settings-ai-form">
            <input
              className="settings-ai-input"
              type="password"
              placeholder="openai api key"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void submitApiKey()
                }
                if (e.key === 'Escape') {
                  setShowKeyInput(false)
                  setKeyValue('')
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="settings-card-action"
              onClick={() => void submitApiKey()}
              disabled={!keyValue.trim()}
            >
              save key
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
