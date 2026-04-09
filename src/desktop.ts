import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DesktopAPI, Item } from './types'

function hostPlatform(): string {
  if (typeof navigator === 'undefined') return 'darwin'
  if (/Mac/i.test(navigator.userAgent)) return 'darwin'
  if (/Win/i.test(navigator.userAgent)) return 'win32'
  return 'linux'
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

async function ipc(method: string, params: unknown[] = []): Promise<unknown> {
  return invoke('invoke_ipc', { method, params })
}

function createTauriDesktopAPI(): DesktopAPI & {
  _send?: (channel: string, ...args: unknown[]) => void
  _on?: (channel: string, callback: (...args: unknown[]) => void) => () => void
} {
  const api: DesktopAPI & {
    _send?: (channel: string, ...args: unknown[]) => void
    _on?: (channel: string, callback: (...args: unknown[]) => void) => () => void
  } = {
    platform: hostPlatform(),
    items: {
      list: (filters) => ipc('items:list', [filters ?? null]) as Promise<Item[]>,
      get: (id) => ipc('items:get', [id]) as Promise<Item>,
      create: (data) => ipc('items:create', [data]) as Promise<Item>,
      update: (id, data) => ipc('items:update', [id, data]) as Promise<Item>,
      delete: (id) => ipc('items:delete', [id]) as Promise<{ success: boolean }>
    },
    folders: {
      list: () => ipc('folders:list', []) as Promise<string[]>,
      create: (name) => ipc('folders:create', [name]) as Promise<{ name: string }>,
      rename: (currentName, nextName) =>
        ipc('folders:rename', [currentName, nextName]) as Promise<{ name: string }>,
      remove: (name) => ipc('folders:delete', [name]) as Promise<{ success: boolean }>,
      delete: (name) => ipc('folders:delete', [name]) as Promise<{ success: boolean }>
    },
    tags: {
      list: () => ipc('tags:list', []) as Promise<import('./types').Tag[]>,
      create: (name) => ipc('tags:create', [name]) as Promise<import('./types').Tag>,
      addToItem: (itemId, tagId) =>
        ipc('tags:add-to-item', [itemId, tagId]) as Promise<{ success: boolean }>,
      removeFromItem: (itemId, tagId) =>
        ipc('tags:remove-from-item', [itemId, tagId]) as Promise<{ success: boolean }>
    },
    metadata: {
      fetch: (url) => ipc('metadata:fetch', [url]) as ReturnType<DesktopAPI['metadata']['fetch']>
    },
    images: {
      save: (filePath, folderPath) =>
        ipc('images:save', [filePath, folderPath ?? null]) as Promise<string | null>,
      saveData: (data, name, folderPath) =>
        ipc('images:save-data', [arrayBufferToBase64(data), name, folderPath ?? null]) as Promise<string>
    },
    ai: {
      setApiKey: (key) => ipc('ai:set-api-key', [key]) as Promise<{ success: boolean }>,
      hasApiKey: () => ipc('ai:has-api-key', []) as Promise<boolean>,
      semanticSearch: (query) =>
        ipc('ai:semantic-search', [query]) as ReturnType<DesktopAPI['ai']['semanticSearch']>,
      hybridSearch: (payload) =>
        ipc('ai:hybrid-search', [payload]) as ReturnType<DesktopAPI['ai']['hybridSearch']>,
      backfillEmbeddings: () =>
        ipc('ai:backfill-embeddings', []) as Promise<{ scheduled: number }>,
      parseQuery: (query) =>
        ipc('ai:parse-query', [query]) as ReturnType<DesktopAPI['ai']['parseQuery']>,
      enrichItem: (id) => ipc('ai:enrich-item', [id]) as ReturnType<DesktopAPI['ai']['enrichItem']>,
      summarize: (id) => ipc('ai:summarize', [id]) as ReturnType<DesktopAPI['ai']['summarize']>
    },
    bookmarkMedia: {
      persist: (id) =>
        ipc('bookmark-media:persist', [id]) as ReturnType<DesktopAPI['bookmarkMedia']['persist']>
    },
    system: {
      openUrl: (url) => invoke('open_external_url', { url }) as Promise<void>
    },
    vault: {
      getStatus: () => invoke('vault_get_status') as ReturnType<DesktopAPI['vault']['getStatus']>,
      pickFolder: () => invoke('vault_pick_folder') as ReturnType<DesktopAPI['vault']['pickFolder']>
    }
  }

  api._send = (channel, ..._args) => {
    if (channel === 'tray:item-added' || channel === 'tray:close') {
      void invoke('tray_chrome', { channel })
    }
  }

  api._on = (channel, callback) => {
    let unlisten: (() => void) | undefined
    const p = listen(channel, (event) => {
      const p = event.payload
      if (p === undefined || p === null) {
        callback()
      } else {
        callback(p as unknown)
      }
    }).then((u) => {
      unlisten = u
    })
    return () => {
      void p.then(() => unlisten?.())
    }
  }

  return api
}

/** True when running inside the Tauri webview (IPC available). Not build-time env — `TAURI_PLATFORM` is only set with the official Vite plugin; this works with plain Vite + `tauri dev`. */
export function isTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function initDesktopShell(): void {
  if (!isTauriShell()) return
  window.desktopAPI = createTauriDesktopAPI()
}
