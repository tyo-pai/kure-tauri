/**
 * Tauri Node sidecar: stdio JSON protocol (see src-tauri/src/lib.rs).
 * Bundles ipc-handlers + vault for the desktop shell.
 */
import * as readline from 'readline'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { initVault, setExternalChangeListener, getItemsNeedingColors, setItemColors } from './vault/vault-manager'
import { migrateFromSqlite } from './vault/migrate-from-sqlite'
import { configureHandlers, invokeHandler } from './ipc-handlers'
import { extractColorPalette } from './services/color-palette'

const pendingDialogs = new Map<string, (result: unknown) => void>()

function emitEvent(channel: string, payload: unknown) {
  process.stdout.write(JSON.stringify({ type: 'event', channel, payload }) + '\n')
}

async function main() {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    console.error('bridge: VAULT_PATH is required')
    process.exit(1)
  }

  fs.mkdirSync(vaultPath, { recursive: true })
  fs.mkdirSync(path.join(vaultPath, '.stash'), { recursive: true })
  fs.mkdirSync(path.join(vaultPath, '.stash', 'cache'), { recursive: true })

  let resolveVaultReady!: () => void
  const vaultReady = new Promise<void>((resolve) => {
    resolveVaultReady = resolve
  })

  // First line on stdout must be `ready` — emit ASAP so Rust does not block on a full vault scan
  // (initVault + search rebuild + chokidar) before the Tauri window can finish loading.
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n')

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

  rl.on('line', async (line) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    if (msg.type === 'dialog_response') {
      const requestId = msg.requestId as string
      const fn = pendingDialogs.get(requestId)
      if (fn) {
        pendingDialogs.delete(requestId)
        fn(msg.result)
      }
      return
    }

    if (msg.type !== 'invoke') return

    await vaultReady

    const id = msg.id as number
    const method = msg.method as string
    const params = (msg.params as unknown[]) ?? []

    try {
      const result = await invokeHandler(method, params)
      process.stdout.write(JSON.stringify({ type: 'response', id, result }) + '\n')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stdout.write(JSON.stringify({ type: 'error', id, message }) + '\n')
    }
  })

  try {
    await initVault(vaultPath)
    const { migrated, errors } = await migrateFromSqlite(vaultPath)
    if (migrated > 0) {
      await initVault(vaultPath)
    }
    if (errors.length > 0) {
      console.error('[startup] Migration errors:', errors)
    }

    configureHandlers({
      notify: (channel, ...args) => {
        const payload = args.length === 0 ? null : args.length === 1 ? args[0] : args
        emitEvent(channel, payload)
      },
      showOpenDialog: async (opts) => {
        const requestId = crypto.randomBytes(16).toString('hex')
        return new Promise((resolve) => {
          pendingDialogs.set(requestId, (r: unknown) => resolve(r))
          process.stdout.write(
            JSON.stringify({ type: 'dialog_request', requestId, options: opts }) + '\n'
          )
        })
      }
    })

    setExternalChangeListener(() => {
      emitEvent('items:refresh', null)
    })

    resolveVaultReady()

    // Defer so stdin/IPC is serviced before heavy work; never log to stdout here (breaks JSON protocol).
    setImmediate(() => {
      const needsColors = getItemsNeedingColors()
      if (needsColors.length === 0) return
      console.error(`[colors] Backfilling ${needsColors.length} items...`)
      for (const { id, thumbnail, folderPath } of needsColors) {
        extractColorPalette(thumbnail, folderPath)
          .then((colors) => {
            if (colors.length > 0) {
              setItemColors(id, colors)
            }
          })
          .catch((err: unknown) => console.error(`[colors] Backfill failed for ${id}:`, err))
      }
    })
  } catch (e) {
    console.error('bridge fatal:', e)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('bridge fatal:', e)
  process.exit(1)
})
