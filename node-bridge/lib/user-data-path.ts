import os from 'os'
import path from 'path'

/**
 * Historical desktop support path for package name `stash`.
 * Tauri sets `STASH_USER_DATA_DIR`; the Node bridge uses this when unset.
 */
export function getUserDataDir(): string {
  if (process.env.STASH_USER_DATA_DIR) {
    return process.env.STASH_USER_DATA_DIR
  }
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library/Application Support/stash')
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA
    if (base) return path.join(base, 'stash')
    return path.join(home, 'AppData/Roaming/stash')
  }
  return path.join(home, '.config/stash')
}
