import path from 'path'
import fs from 'fs'
import { getVaultBasePath } from '../vault/vault-manager'
import { getUserDataDir } from '../lib/user-data-path'

interface Settings {
  openaiApiKey?: string
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
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2))
}

export function getOpenAIKey(): string | undefined {
  return getSettings().openaiApiKey
}
