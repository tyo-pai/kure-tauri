import path from 'path'
import fs from 'fs'
import { getVaultBasePath } from '../vault/vault-manager'
import { getUserDataDir } from '../lib/user-data-path'

interface Settings {
  openaiApiKey?: string
  aiSearch?: Partial<AISearchSettings>
}

export interface AISearchSettings {
  embeddingModel: string
  queryParser: 'openai' | 'apple' | 'off'
  queryParserModel: string
  rerankModel: string
}

export const AI_SEARCH_DEFAULT_SETTINGS: AISearchSettings = {
  embeddingModel: 'text-embedding-3-large',
  queryParser: 'openai',
  queryParserModel: 'gpt-5.4-mini',
  rerankModel: 'gpt-5.4-mini'
}

function settingsPath(): string {
  const vault = getVaultBasePath()
  if (vault) {
    return path.join(vault, '.stash', 'config.json')
  }
  // Fallback before vault is initialized
  return path.join(getUserDataDir(), 'settings.json')
}

export function getSettings(): Settings {
  try {
    const p = settingsPath()
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return {}
}

export function saveSetting(key: string, value: string): void {
  const settings = getSettings()
  ;(settings as any)[key] = value
  saveSettings(settings)
}

function saveSettings(settings: Settings): void {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2))
}

export function getOpenAIKey(): string | undefined {
  return getSettings().openaiApiKey
}

function normalizeQueryParser(value: unknown): AISearchSettings['queryParser'] {
  return value === 'apple' || value === 'off' || value === 'openai' ? value : AI_SEARCH_DEFAULT_SETTINGS.queryParser
}

function normalizeModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function getAISearchSettings(): AISearchSettings {
  const raw = getSettings().aiSearch || {}

  return {
    embeddingModel: normalizeModel(raw.embeddingModel, AI_SEARCH_DEFAULT_SETTINGS.embeddingModel),
    queryParser: normalizeQueryParser(raw.queryParser),
    queryParserModel: normalizeModel(raw.queryParserModel, AI_SEARCH_DEFAULT_SETTINGS.queryParserModel),
    rerankModel: normalizeModel(raw.rerankModel, AI_SEARCH_DEFAULT_SETTINGS.rerankModel)
  }
}

export function saveAISearchSettings(next: Partial<AISearchSettings>): AISearchSettings {
  const settings = getSettings()
  const merged = {
    ...getAISearchSettings(),
    ...next
  }
  const normalized: AISearchSettings = {
    embeddingModel: normalizeModel(merged.embeddingModel, AI_SEARCH_DEFAULT_SETTINGS.embeddingModel),
    queryParser: normalizeQueryParser(merged.queryParser),
    queryParserModel: normalizeModel(merged.queryParserModel, AI_SEARCH_DEFAULT_SETTINGS.queryParserModel),
    rerankModel: normalizeModel(merged.rerankModel, AI_SEARCH_DEFAULT_SETTINGS.rerankModel)
  }

  settings.aiSearch = normalized
  saveSettings(settings)
  return normalized
}
