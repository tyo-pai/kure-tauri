import { useState } from 'react'
import type { AISearchSettings, VaultStatus } from '../../types'
import './SettingsView.css'

const DEFAULT_AI_SEARCH_SETTINGS: AISearchSettings = {
  embeddingModel: 'text-embedding-3-large',
  queryParser: 'openai',
  queryParserModel: 'gpt-5.4-mini',
  rerankModel: 'gpt-5.4-mini'
}

const EMBEDDING_MODEL_OPTIONS = [
  { value: 'text-embedding-3-large', label: 'embedding 3 large' },
  { value: 'text-embedding-3-small', label: 'embedding 3 small' }
]

const SEARCH_MODEL_OPTIONS = [
  { value: 'gpt-5.4-mini', label: 'gpt-5.4 mini' },
  { value: 'gpt-5.4', label: 'gpt-5.4' },
  { value: 'gpt-4o-mini', label: 'gpt-4o mini' }
]

const QUERY_PARSER_OPTIONS: Array<{ value: AISearchSettings['queryParser']; label: string }> = [
  { value: 'openai', label: 'openai' },
  { value: 'apple', label: 'apple on-device' },
  { value: 'off', label: 'off' }
]

interface SettingsViewProps {
  vaultStatus: VaultStatus | null
  hasAIKey: boolean
  aiSearchSettings: AISearchSettings | null
  onSetApiKey: (key: string) => void | Promise<void>
  onSetAISearchSettings: (settings: Partial<AISearchSettings>) => void | Promise<void>
  onPickVaultFolder: () => void | Promise<void>
}

export function SettingsView({
  vaultStatus,
  hasAIKey,
  aiSearchSettings,
  onSetApiKey,
  onSetAISearchSettings,
  onPickVaultFolder
}: SettingsViewProps) {
  const hasConfirmedVault = vaultStatus?.configured === true
  const searchSettings = aiSearchSettings || DEFAULT_AI_SEARCH_SETTINGS
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

      <section className="settings-section settings-section--compact">
        <div className="settings-card-header settings-card-header--stack">
          <div className="settings-card-copy">
            <div className="settings-card-eyebrow">smart search</div>
            <p className="settings-card-description">
              Use stronger OpenAI search models and keep local Apple parsing out unless you choose it.
            </p>
          </div>

          <div className="settings-model-grid">
            <label className="settings-model-field">
              <span>embedding</span>
              <select
                value={searchSettings.embeddingModel}
                onChange={(event) => void onSetAISearchSettings({ embeddingModel: event.target.value })}
                disabled={!hasAIKey}
              >
                {EMBEDDING_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-model-field">
              <span>query parser</span>
              <select
                value={searchSettings.queryParser}
                onChange={(event) => void onSetAISearchSettings({ queryParser: event.target.value as AISearchSettings['queryParser'] })}
                disabled={!hasAIKey}
              >
                {QUERY_PARSER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-model-field">
              <span>parser model</span>
              <select
                value={searchSettings.queryParserModel}
                onChange={(event) => void onSetAISearchSettings({ queryParserModel: event.target.value })}
                disabled={!hasAIKey || searchSettings.queryParser !== 'openai'}
              >
                {SEARCH_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-model-field">
              <span>reranker</span>
              <select
                value={searchSettings.rerankModel}
                onChange={(event) => void onSetAISearchSettings({ rerankModel: event.target.value })}
                disabled={!hasAIKey}
              >
                {SEARCH_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="settings-callout settings-callout--quiet">
            Changing the embedding model reindexes saved items in the background.
          </div>
        </div>
      </section>
    </div>
  )
}
