import crypto from 'crypto'

/** Subset of file-picker options used by handlers (bridge + Tauri `rfd` / legacy). */
export interface OpenDialogOptions {
  title?: string
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>
  filters?: { name: string; extensions: string[] }[]
}

function genId(): string {
  return crypto.randomBytes(12).toString('base64url')
}

import {
  getItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  getFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  getTags,
  createTag,
  addTagToItem,
  removeTagFromItem,
  getItemCounts,
  setItemColors,
  setItemEmbedding,
  setItemAIDescription,
  setItemAISummary,
  setItemOCRText,
  getItemIdsMissingEmbeddings,
  itemHasEmbedding
} from './vault/vault-manager'
import { runHybridSearch } from './services/hybrid-search'
import { fetchUrlMetadata } from './services/metadata-scraper'
import { saveImage, saveImageData, getImagePath } from './services/image-store'
import {
  collectRemoteDownloadTasks,
  persistBookmarkRemoteAssets
} from './services/bookmark-media-download'
import { extractColorPalette } from './services/color-palette'
import {
  generateEmbedding,
  generateTags,
  generateSummary,
  extractTextFromImage,
  describeImage,
  parseSearchQuery
} from './services/ai'
import { saveSetting, getOpenAIKey } from './services/settings'
import type { Item, ItemFilters, CreateItemData } from './types'

type EnrichmentStage =
  | 'starting'
  | 'reading'
  | 'seeing'
  | 'tagging'
  | 'indexing'
  | 'finishing'

let notifyImpl: (channel: string, ...args: unknown[]) => void = () => {}

let showOpenDialogImpl!: (
  opts: OpenDialogOptions
) => Promise<{ canceled: boolean; filePaths: string[] }>

export function configureHandlers(deps: {
  notify: (channel: string, ...args: unknown[]) => void
  showOpenDialog: (
    opts: OpenDialogOptions
  ) => Promise<{ canceled: boolean; filePaths: string[] }>
}) {
  notifyImpl = deps.notify
  showOpenDialogImpl = deps.showOpenDialog
}

function notifyRenderer(channel: string, ...args: unknown[]): void {
  notifyImpl(channel, ...args)
}

function notifyEnrichmentStage(id: string, stage: EnrichmentStage): void {
  notifyRenderer('items:enrich-stage', { id, stage })
}

function buildBookmarkAIContext(item: Item): string {
  if (item.type !== 'bookmark' && item.type !== 'wishlist') return ''
  const parts: string[] = []
  if (item.store_name) parts.push(`platform: ${item.store_name}`)
  if (item.bookmark_author) parts.push(`creator: ${item.bookmark_author}`)
  if (item.bookmark_post_text) parts.push(`post text: ${item.bookmark_post_text}`)
  return parts.join('\n')
}

function buildItemAIText(item: Item, imageDescription = '', includeAIDescription = false): string {
  const parts = [
    item.title,
    item.description,
    item.body,
    buildBookmarkAIContext(item),
    imageDescription,
    includeAIDescription ? item.ai_description : ''
  ]
  return parts.filter(Boolean).join('\n\n')
}

function getVisualEnrichmentImagePath(item: Item): string | null {
  if (!item.thumbnail) return null
  if (item.thumbnail.startsWith('http://') || item.thumbnail.startsWith('https://')) return null
  if (item.type !== 'image' && item.type !== 'bookmark' && item.type !== 'wishlist') return null
  return getImagePath(item.thumbnail, item.folder_path)
}

function scheduleVisualBookmarkEnrichment(item: Item | undefined): void {
  if (!item) return
  if (item.type !== 'bookmark' && item.type !== 'wishlist') return
  if (!getVisualEnrichmentImagePath(item)) return
  setTimeout(() => {
    enrichItem(item.id, { force: true }).catch((err) =>
      console.error('[ai] Bookmark visual enrichment error:', err)
    )
  }, 250)
}

type EnrichItemOptions = { force?: boolean }

/** Auto (non-forced) enrichments are skipped if any enrich finished recently for this id. */
const ENRICH_AUTO_COOLDOWN_MS = 2500
const lastEnrichEndAt = new Map<string, number>()

// --- AI enrichment pipeline ---

async function enrichItem(id: string, opts?: EnrichItemOptions): Promise<void> {
  try {
    const item = getItem(id)
    if (!item) return

    const force = opts?.force === true
    if (
      !force &&
      (item.type === 'bookmark' || item.type === 'wishlist') &&
      collectRemoteDownloadTasks(item).length > 0
    ) {
      return
    }

    if (!force) {
      const prev = lastEnrichEndAt.get(id)
      if (prev !== undefined && Date.now() - prev < ENRICH_AUTO_COOLDOWN_MS) {
        return
      }
    }

    console.error(`[ai] Enriching item: ${item.title}`)
    notifyRenderer('items:enriching', id)
    notifyEnrichmentStage(id, 'starting')

    let imageDescription = ''

    const imagePath = getVisualEnrichmentImagePath(item)
    if (imagePath) {
      try {
        notifyEnrichmentStage(id, 'reading')
        const ocrText = await extractTextFromImage(imagePath)
        if (ocrText) {
          setItemOCRText(id, ocrText)
          console.error(`[ai] OCR extracted ${ocrText.length} chars`)
        }
      } catch (err) {
        console.error('[ai] OCR failed:', err)
      }

      try {
        notifyEnrichmentStage(id, 'seeing')
        imageDescription = await describeImage(imagePath)
        if (imageDescription) {
          setItemAIDescription(id, imageDescription)
          console.error(`[ai] Image described: ${imageDescription}`)
        }
      } catch (err) {
        console.error('[ai] Image description failed:', err)
      }
    } else {
      notifyEnrichmentStage(id, 'reading')
    }

    try {
      notifyEnrichmentStage(id, 'tagging')
      const tagBody = buildItemAIText(item, imageDescription)
      const tags = await generateTags(item.title, tagBody, item.type)
      if (tags.length > 0) {
        for (const tagName of tags) {
          addTagToItem(id, tagName)
        }
        console.error(`[ai] Auto-tagged: [${tags.join(', ')}]`)
      }
    } catch (err) {
      console.error('[ai] Auto-tag failed:', err)
    }

    if (getOpenAIKey()) {
      const textForEmbedding = buildItemAIText(item, imageDescription)
      if (textForEmbedding.trim()) {
        try {
          notifyEnrichmentStage(id, 'indexing')
          const embedding = await generateEmbedding(textForEmbedding)
          setItemEmbedding(id, embedding)
          console.error(`[ai] Embedding generated (${embedding.length} dims)`)
        } catch (err) {
          console.error('[ai] Embedding failed:', err)
        }
      }
    }

    notifyEnrichmentStage(id, 'finishing')
    console.error(`[ai] Enrichment complete: ${item.title}`)
    lastEnrichEndAt.set(id, Date.now())
    notifyRenderer('items:enriched', id)
  } catch (err) {
    console.error(`[ai] Enrichment failed for ${id}:`, err)
  }
}

/** Embedding-only (for backfill / semantic index) — matches enrichItem text bundle without re-running vision/OCR. */
async function indexEmbeddingForItem(id: string): Promise<void> {
  if (!getOpenAIKey() || itemHasEmbedding(id)) return
  const item = getItem(id)
  if (!item) return
  const textForEmbedding = buildItemAIText(item, '', true)
  if (!textForEmbedding.trim()) return
  const embedding = await generateEmbedding(textForEmbedding)
  setItemEmbedding(id, embedding)
  console.error(`[ai] Embedding indexed for ${id} (${embedding.length} dims)`)
}

const bookmarkMediaPersistInFlight = new Set<string>()

function handleItemsCreate(args: unknown[]): Item {
  const data = args[0] as CreateItemData
  const id = genId()
  const item = createItem(id, data)

  if (data.thumbnail) {
    extractColorPalette(data.thumbnail, item.folder_path)
      .then((colors) => {
        if (colors.length > 0) {
          setItemColors(id, colors)
          console.error(`[colors] Extracted ${colors.length} colors for: ${data.title}`)
          notifyRenderer('items:refresh')
        }
      })
      .catch((err) => console.error('[colors] Extraction failed:', err))
  }

  const bookmarkLike = item.type === 'bookmark' || item.type === 'wishlist'
  const bookmarkRemoteTasks = bookmarkLike ? collectRemoteDownloadTasks(item) : []

  if (bookmarkLike) {
    void persistBookmarkRemoteAssets(item)
      .then((patch) => {
        if (!patch) {
          if (bookmarkRemoteTasks.length > 0) {
            setTimeout(() => {
              enrichItem(id, { force: true }).catch((err) =>
                console.error('[ai] Enrichment error:', err)
              )
            }, 500)
          }
          return
        }
        const updated = updateItem(id, patch)
        if (!updated) return
        if (updated.thumbnail && !updated.thumbnail.startsWith('http')) {
          extractColorPalette(updated.thumbnail, updated.folder_path)
            .then((colors) => {
              if (colors.length > 0) {
                setItemColors(id, colors)
              }
            })
            .catch(() => {})
        }
        scheduleVisualBookmarkEnrichment(updated)
        notifyRenderer('items:refresh')
      })
      .catch((err) => {
        console.error('[bookmark-media] persist failed:', err)
        if (bookmarkRemoteTasks.length > 0) {
          setTimeout(() => {
            enrichItem(id, { force: true }).catch((e) => console.error('[ai] Enrichment error:', e))
          }, 500)
        }
      })
  }

  if (!bookmarkLike || bookmarkRemoteTasks.length === 0) {
    setTimeout(() => {
      enrichItem(id).catch((err) => console.error('[ai] Enrichment error:', err))
    }, 500)
  }

  return item
}

const ipcHandlers: Record<string, (args: unknown[]) => unknown | Promise<unknown>> = {
  'items:list': (args) => getItems(args[0] as ItemFilters | undefined),
  'items:get': (args) => getItem(args[0] as string),
  'items:create': (args) => handleItemsCreate(args),
  'items:update': (args) => updateItem(args[0] as string, args[1] as Partial<CreateItemData>),
  'items:delete': (args) => {
    deleteItem(args[0] as string)
    lastEnrichEndAt.delete(args[0] as string)
    return { success: true }
  },
  'folders:list': () => getFolders(),
  'folders:create': (args) => {
    const folder = createFolder(args[0] as string)
    notifyRenderer('items:refresh')
    return { name: folder }
  },
  'folders:rename': (args) => {
    const folder = renameFolder(args[0] as string, args[1] as string)
    notifyRenderer('items:refresh')
    return { name: folder }
  },
  'folders:delete': (args) => {
    deleteFolder(args[0] as string)
    notifyRenderer('items:refresh')
    return { success: true }
  },
  'tags:list': () => getTags(),
  'tags:create': (args) => createTag(genId(), args[0] as string),
  'tags:add-to-item': (args) => {
    addTagToItem(args[0] as string, args[1] as string)
    return { success: true }
  },
  'tags:remove-from-item': (args) => {
    removeTagFromItem(args[0] as string, args[1] as string)
    return { success: true }
  },
  'metadata:fetch': async (args) => {
    const url = args[0] as string
    console.error('[metadata:fetch] Fetching URL:', url)
    const result = await fetchUrlMetadata(url)
    console.error(
      '[metadata:fetch] Result:',
      JSON.stringify({
        title: result.title?.slice(0, 50),
        price: result.price,
        siteName: result.siteName,
        hasMedia: !!result.mediaUrl,
        mediaCount: result.mediaItems?.length ?? 0
      })
    )
    if (result.mediaUrl) {
      try {
        const u = new URL(result.mediaUrl)
        console.error('[kure:video] metadata:fetch mediaUrl', u.hostname, u.pathname.slice(0, 72))
      } catch {
        console.error('[kure:video] metadata:fetch mediaUrl (raw)', String(result.mediaUrl).slice(0, 120))
      }
    }
    return result
  },
  'images:save': async (args) => {
    const filePath = args[0] as string
    const folderPath = (args[1] as string | null | undefined) ?? null
    if (filePath) {
      return saveImage(filePath, folderPath)
    }
    const result = await showOpenDialogImpl({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    })
    if (!result.canceled && result.filePaths[0]) {
      return saveImage(result.filePaths[0], folderPath)
    }
    return null
  },
  'images:save-data': (args) => {
    const raw = args[0]
    const name = args[1] as string
    const folderPath = (args[2] as string | null | undefined) ?? null
    const buf =
      typeof raw === 'string'
        ? Buffer.from(raw, 'base64')
        : Buffer.from(raw as ArrayBuffer)
    return saveImageData(buf, name, folderPath)
  },
  'items:counts': () => getItemCounts(),
  'ai:set-api-key': (args) => {
    saveSetting('openaiApiKey', args[0] as string)
    return { success: true }
  },
  'ai:has-api-key': () => !!getOpenAIKey(),
  'ai:semantic-search': async (args) => {
    try {
      const items = await runHybridSearch(args[0] as string, {})
      return { items, semantic: items.length > 0 }
    } catch (err) {
      console.error('[ai] Semantic search failed:', err)
      return { items: [], semantic: false, error: String(err) }
    }
  },
  'ai:hybrid-search': async (args) => {
    try {
      const payload = args[0] as { query: string; filters?: ItemFilters }
      const q = typeof payload?.query === 'string' ? payload.query : ''
      const filters = payload?.filters && typeof payload.filters === 'object' ? payload.filters : {}
      const items = await runHybridSearch(q, filters)
      return { items, ok: true as const }
    } catch (err) {
      console.error('[ai] Hybrid search failed:', err)
      return { items: [], ok: false as const, error: String(err) }
    }
  },
  'ai:backfill-embeddings': async () => {
    if (!getOpenAIKey()) return { scheduled: 0 }
    const ids = getItemIdsMissingEmbeddings()
    if (ids.length === 0) return { scheduled: 0 }

    void (async () => {
      for (const id of ids) {
        try {
          await indexEmbeddingForItem(id)
        } catch (err) {
          console.error('[ai] Backfill embedding failed:', id, err)
        }
        await new Promise((r) => setTimeout(r, 110))
      }
      notifyRenderer('items:refresh')
    })()

    return { scheduled: ids.length }
  },
  'ai:parse-query': async (args) => {
    try {
      const query = args[0] as string
      if (!getOpenAIKey()) return { keywords: query }
      return await parseSearchQuery(query)
    } catch {
      return { keywords: args[0] as string }
    }
  },
  'ai:enrich-item': async (args) => {
    await enrichItem(args[0] as string, { force: true })
    return { success: true }
  },
  'ai:summarize': async (args) => {
    try {
      if (!getOpenAIKey()) return {}
      const id = args[0] as string
      const item = getItem(id)
      if (!item) return {}
      const summary = await generateSummary(
        item.title,
        item.body || item.description || '',
        item.type
      )
      if (summary) {
        setItemAISummary(id, summary)
      }
      return { summary }
    } catch (err) {
      console.error('[ai] Summarize failed:', err)
      return {}
    }
  },
  'bookmark-media:persist': async (args) => {
    const id = args[0] as string
    if (bookmarkMediaPersistInFlight.has(id)) {
      return { ok: false as const, error: 'in progress' }
    }
    const item = getItem(id)
    if (!item || (item.type !== 'bookmark' && item.type !== 'wishlist')) {
      return { ok: false as const, error: 'invalid item' }
    }
    const tasks = collectRemoteDownloadTasks(item)
    if (tasks.length === 0) {
      return { ok: true as const, skipped: true }
    }
    bookmarkMediaPersistInFlight.add(id)
    notifyRenderer('bookmark-media-download', {
      type: 'start',
      id,
      title: item.title,
      total: tasks.length
    })
    try {
      const patch = await persistBookmarkRemoteAssets(item, (p) => {
        notifyRenderer('bookmark-media-download', { type: 'progress', id, ...p })
      })
      if (patch) {
        const updated = updateItem(id, patch)
        if (updated?.thumbnail && !updated.thumbnail.startsWith('http')) {
          extractColorPalette(updated.thumbnail, updated.folder_path)
            .then((colors) => {
              if (colors.length > 0) {
                setItemColors(id, colors)
              }
            })
            .catch(() => {})
        }
        scheduleVisualBookmarkEnrichment(updated)
        notifyRenderer('items:refresh')
      }
      notifyRenderer('bookmark-media-download', { type: 'done', id, success: true })
      return { ok: true as const, changed: !!patch }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[bookmark-media] persist failed:', err)
      notifyRenderer('bookmark-media-download', { type: 'done', id, success: false, error: msg })
      return { ok: false as const, error: msg }
    } finally {
      bookmarkMediaPersistInFlight.delete(id)
    }
  }
}

export async function invokeHandler(method: string, args: unknown[]): Promise<unknown> {
  const fn = ipcHandlers[method]
  if (!fn) {
    throw new Error(`Unknown IPC method: ${method}`)
  }
  return fn(args)
}
