import chokidar from 'chokidar'
import path from 'path'

export type FileChangeCallback = (filePath: string, event: 'add' | 'change' | 'unlink' | 'refresh') => void

let watcher: chokidar.FSWatcher | null = null

// Track files we just wrote so we can ignore our own changes
const recentWrites = new Map<string, number>()
const SELF_WRITE_TTL = 1000 // ms

export function markSelfWrite(filePath: string): void {
  recentWrites.set(filePath, Date.now())
}

function isSelfWrite(filePath: string): boolean {
  const ts = recentWrites.get(filePath)
  if (!ts) return false
  if (Date.now() - ts > SELF_WRITE_TTL) {
    recentWrites.delete(filePath)
    return false
  }
  return true
}

export function startWatcher(vaultPath: string, onChange: FileChangeCallback): void {
  if (watcher) {
    watcher.close()
  }

  watcher = chokidar.watch(vaultPath, {
    cwd: vaultPath,
    ignored: ['.stash/**', '**/_assets/**', '**/images/**', '**/node_modules/**'],
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  })

  const handle = (event: 'add' | 'change' | 'unlink') => (relativePath: string) => {
    const fullPath = path.join(vaultPath, relativePath)
    if (isSelfWrite(fullPath)) return
    onChange(fullPath, event)
  }

  watcher.on('add', (relativePath) => {
    if (relativePath.endsWith('.md')) handle('add')(relativePath)
  })
  watcher.on('change', (relativePath) => {
    if (relativePath.endsWith('.md')) handle('change')(relativePath)
  })
  watcher.on('unlink', (relativePath) => {
    if (relativePath.endsWith('.md')) handle('unlink')(relativePath)
  })
  watcher.on('addDir', (relativePath) => {
    if (!relativePath.includes(path.sep)) {
      onChange(path.join(vaultPath, relativePath), 'refresh')
    }
  })
  watcher.on('unlinkDir', (relativePath) => {
    if (!relativePath.includes(path.sep)) {
      onChange(path.join(vaultPath, relativePath), 'refresh')
    }
  })
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
