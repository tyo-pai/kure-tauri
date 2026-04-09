import fs from 'fs'
import os from 'os'
import path from 'path'
import { getUserDataDir } from '../lib/user-data-path'

const configPath = () => path.join(getUserDataDir(), 'vault-config.json')

export function getVaultPath(): string | null {
  try {
    if (fs.existsSync(configPath())) {
      const config = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
      if (config.vaultPath && fs.existsSync(config.vaultPath)) {
        return config.vaultPath
      }
    }
  } catch {
    // ignore
  }
  return null
}

export function setVaultPath(vaultPath: string): void {
  fs.writeFileSync(configPath(), JSON.stringify({ vaultPath }, null, 2))
}

/** Default vault path on first launch. */
export function getDefaultVaultPath(): string {
  return path.join(os.homedir(), 'Stash')
}
