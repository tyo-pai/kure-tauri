import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Toolbar } from './components/Toolbar/Toolbar'
import { CardGrid } from './components/CardGrid/CardGrid'
import { HomeOverview } from './components/HomeOverview/HomeOverview'
import { Preview } from './components/Preview/Preview'
import { SettingsView } from './components/SettingsView/SettingsView'
import { AddForm } from './components/AddForm/AddForm'
import { ShaderDebug } from './components/ShaderDebug/ShaderDebug'
import {
  BookmarkDownloadToast,
  type BookmarkMediaDownloadJob
} from './components/BookmarkDownloadToast/BookmarkDownloadToast'
import { useItems } from './hooks/useItems'
import { useTags } from './hooks/useTags'
import { useSelection } from './hooks/useSelection'
import { ALL_FOLDERS_KEY, ROOT_FOLDER_KEY } from './lib/constants'
import { itemMatchesColorFilter } from './lib/colorMatch'
import type { EnrichmentStage, Item, VaultStatus } from './types'

interface EnrichmentStageEvent {
  id: string
  stage: EnrichmentStage
}

const IMAGE_FILE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
  'tiff',
  'tif'
])
const DROP_DEDUPE_WINDOW_MS = 1200

function getDroppedUrl(dataTransfer: DataTransfer): string | null {
  const raw =
    dataTransfer.getData('text/uri-list') ||
    dataTransfer.getData('text/plain') ||
    ''
  const value = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))

  if (!value) return null
  return /^https?:\/\//i.test(value) ? value : null
}

function isImageLikeFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const filePath = ((file as any).path as string | undefined) || file.name
  const extension = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_FILE_EXTENSIONS.has(extension)
}

function getPathFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function isImageLikePath(filePath: string): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_FILE_EXTENSIONS.has(extension)
}

function createPathDropSignature(paths: string[]): string {
  return paths
    .map((path) => path.trim())
    .filter(Boolean)
    .sort()
    .join('\n')
}

export default function App() {
  const [activeView, setActiveView] = useState<'browse' | 'settings'>('browse')
  const [activeType, setActiveType] = useState('everything')
  const [activeFolder, setActiveFolder] = useState(ALL_FOLDERS_KEY)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addFormType, setAddFormType] = useState<'bookmark' | 'note' | 'image' | 'wishlist'>('bookmark')
  const [fabOpen, setFabOpen] = useState(false)
  const viewMode = 'grid' as const
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticResults, setSemanticResults] = useState<Item[] | null>(null)
  const [hasAIKey, setHasAIKey] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [dismissLightbox, setDismissLightbox] = useState(false)
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set())
  const [enrichmentStages, setEnrichmentStages] = useState<Record<string, EnrichmentStage>>({})
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set())
  const [showShaderDebug, setShowShaderDebug] = useState(false)
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  /** Synced with preview filmstrip + lightbox for multi-attachment bookmarks */
  const [bookmarkAttachmentIndex, setBookmarkAttachmentIndex] = useState(0)
  const [bookmarkMediaJobs, setBookmarkMediaJobs] = useState<BookmarkMediaDownloadJob[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('stash-sidebar-open') === 'true')
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [appDragging, setAppDragging] = useState(false)
  const autoOpenedSettingsRef = useRef(false)
  const autoPromptedVaultPickerRef = useRef(false)
  const awaitingVaultSelectionRef = useRef(false)
  const previousVaultPathRef = useRef<string | null>(null)
  const appDragDepthRef = useRef(0)
  const lastNativeDropRef = useRef<{ signature: string; at: number }>({ signature: '', at: 0 })

  useEffect(() => {
    localStorage.setItem('stash-sidebar-open', sidebarOpen ? 'true' : 'false')
  }, [sidebarOpen])

  const fetchVaultStatus = useCallback(async () => {
    try {
      const next = await window.desktopAPI.vault.getStatus()
      setVaultStatus(next)
    } catch (err) {
      console.error('Failed to fetch vault status:', err)
    }
  }, [])

  useEffect(() => {
    void fetchVaultStatus()
  }, [fetchVaultStatus])

  const hasConfiguredVault = vaultStatus?.configured === true

  const folderFilter =
    activeFolder === ALL_FOLDERS_KEY || activeFolder === ROOT_FOLDER_KEY ? undefined : activeFolder
  const currentFolder = activeFolder === ALL_FOLDERS_KEY || activeFolder === ROOT_FOLDER_KEY ? undefined : activeFolder

  /** Passed to hybrid search so results respect sidebar scope (type / folder / tag / color). */
  const hybridSearchFilters = useMemo(
    () => ({
      type: activeType !== 'everything' ? activeType : undefined,
      folder: folderFilter,
      tag: activeTag || undefined,
      color: colorFilter || undefined
    }),
    [activeType, folderFilter, activeTag, colorFilter]
  )

  const hybridFilterKey = `${activeType}|${activeFolder}|${activeTag ?? ''}|${colorFilter ?? ''}`

  const { items, loading, typeCounts, folderCounts, folders, refresh } = useItems({
    enabled: hasConfiguredVault,
    type: activeType,
    folder: folderFilter,
    tag: activeTag || undefined,
    search: searchQuery || undefined,
    color: colorFilter || undefined
  })
  const { tags, createTag, refresh: refreshTags } = useTags(hasConfiguredVault)
  const { selectedItem, select } = useSelection()
  const shouldShowVaultSetupShell = vaultStatus === null || vaultStatus.configured === false

  // Hybrid / legacy "semantic" results when available; otherwise keyword list from the vault
  const displayItems = useMemo(() => {
    const base = semanticMode && semanticResults ? semanticResults : items
    if (!colorFilter) return base
    if (semanticMode && semanticResults) {
      return base.filter((item) => itemMatchesColorFilter(item, colorFilter))
    }
    return base
  }, [semanticMode, semanticResults, items, colorFilter])

  const isHomeView =
    activeFolder === ROOT_FOLDER_KEY &&
    activeType === 'everything' &&
    !activeTag &&
    !searchQuery &&
    !semanticMode &&
    !colorFilter

  // Check if AI key is configured
  useEffect(() => {
    if (!hasConfiguredVault) {
      setHasAIKey(false)
      return
    }

    window.desktopAPI.ai.hasApiKey().then(setHasAIKey).catch(() => setHasAIKey(false))
  }, [hasConfiguredVault])

  // Generate embeddings for items that were created before indexing / without a key (semantic search needs these)
  useEffect(() => {
    if (!hasAIKey) return
    void window.desktopAPI.ai.backfillEmbeddings()
  }, [hasAIKey])

  useEffect(() => {
    if (
      activeFolder !== ALL_FOLDERS_KEY &&
      activeFolder !== ROOT_FOLDER_KEY &&
      !folders.includes(activeFolder)
    ) {
      setActiveFolder(ALL_FOLDERS_KEY)
      setActiveType('everything')
      setActiveTag(null)
    }
  }, [activeFolder, folders])

  useEffect(() => {
    if (selectedItem && !displayItems.some((item) => item.id === selectedItem.id)) {
      select(null)
      setPreviewExpanded(false)
    }
  }, [displayItems, selectedItem, select])

  useEffect(() => {
    setBookmarkAttachmentIndex(0)
  }, [selectedItem?.id])

  // Shader debug toggle from View menu (Cmd+Shift+D)
  useEffect(() => {
    const handler = () => setShowShaderDebug((prev) => !prev)
    window.addEventListener('toggle-shader-debug', handler)
    return () => window.removeEventListener('toggle-shader-debug', handler)
  }, [])

  // Stable refs so IPC subscriptions stay mounted once (avoids duplicate listeners when `refresh` identity changes)
  const refreshRef = useRef(refresh)
  const refreshTagsRef = useRef(refreshTags)
  const selectRef = useRef(select)
  refreshRef.current = refresh
  refreshTagsRef.current = refreshTags
  selectRef.current = select

  const ipcRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const refreshAll = () => {
      void fetchVaultStatus()
      if (!hasConfiguredVault) return
      refreshRef.current()
      refreshTagsRef.current()
    }

    const timers = [300, 1200, 3000].map((delay) => window.setTimeout(refreshAll, delay))
    const handleWindowFocus = () => refreshAll()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAll()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchVaultStatus, hasConfiguredVault])

  // Listen for tray / vault / back-end updates. Must unsubscribe: `_on` was never cleaned up before,
  // so every `refresh` change stacked duplicate listeners → one event could refresh the grid many times (glitchy).
  useEffect(() => {
    const scheduleRefresh = () => {
      if (ipcRefreshDebounceRef.current) clearTimeout(ipcRefreshDebounceRef.current)
      ipcRefreshDebounceRef.current = setTimeout(() => {
        refreshRef.current()
        refreshTagsRef.current()
        ipcRefreshDebounceRef.current = undefined
      }, 250)
    }

    const offRefresh = window.desktopAPI._on?.('items:refresh', scheduleRefresh)
    const offVaultChanged = window.desktopAPI._on?.('vault:changed', () => {
      void fetchVaultStatus()
      scheduleRefresh()
    })
    const offEnriching = window.desktopAPI._on?.('items:enriching', (enrichingId: unknown) => {
      if (typeof enrichingId === 'string') {
        setEnrichingIds((prev) => new Set(prev).add(enrichingId))
        setEnrichmentStages((prev) => ({ ...prev, [enrichingId]: prev[enrichingId] || 'starting' }))
      }
    })
    const offStage = window.desktopAPI._on?.('items:enrich-stage', (payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'id' in payload &&
        'stage' in payload &&
        typeof (payload as EnrichmentStageEvent).id === 'string' &&
        typeof (payload as EnrichmentStageEvent).stage === 'string'
      ) {
        const { id, stage } = payload as EnrichmentStageEvent
        setEnrichingIds((prev) => new Set(prev).add(id))
        setEnrichmentStages((prev) => ({ ...prev, [id]: stage }))
      }
    })
    const offEnriched = window.desktopAPI._on?.('items:enriched', (enrichedId: unknown) => {
      refreshRef.current()
      refreshTagsRef.current()
      if (typeof enrichedId === 'string') {
        setEnrichingIds((prev) => {
          const next = new Set(prev)
          next.delete(enrichedId)
          return next
        })
        setEnrichmentStages((prev) => {
          const next = { ...prev }
          delete next[enrichedId]
          return next
        })
        setNewCardIds((prev) => {
          const next = new Set(prev)
          next.delete(enrichedId)
          return next
        })
        window.desktopAPI.items.get(enrichedId).then((updated) => {
          if (updated) selectRef.current(updated)
        })
      }
    })

    return () => {
      offRefresh?.()
      offVaultChanged?.()
      offEnriching?.()
      offStage?.()
      offEnriched?.()
      if (ipcRefreshDebounceRef.current) clearTimeout(ipcRefreshDebounceRef.current)
    }
  }, [fetchVaultStatus])

  useEffect(() => {
    const off = window.desktopAPI._on?.('bookmark-media-download', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        type: string
        id: string
        title?: string
        total?: number
        step?: number
        label?: string
        success?: boolean
        error?: string
      }
      if (p.type === 'start') {
        setBookmarkMediaJobs((prev) => [
          ...prev.filter((j) => j.id !== p.id),
          {
            id: p.id,
            title: p.title ?? '',
            step: 0,
            total: p.total ?? 1,
            label: '',
            status: 'running'
          }
        ])
      }
      if (p.type === 'progress') {
        setBookmarkMediaJobs((prev) => {
          if (!prev.some((j) => j.id === p.id)) return prev
          return prev.map((j) =>
            j.id === p.id
              ? {
                  ...j,
                  step: p.step ?? j.step,
                  total: p.total ?? j.total,
                  label: p.label ?? ''
                }
              : j
          )
        })
      }
      if (p.type === 'done') {
        setBookmarkMediaJobs((prev) => {
          if (!prev.some((j) => j.id === p.id)) return prev
          return prev.map((j) =>
            j.id === p.id
              ? { ...j, status: p.success ? 'done' : 'error', error: p.error }
              : j
          )
        })
        const delay = p.success ? 4500 : 8000
        window.setTimeout(() => {
          setBookmarkMediaJobs((prev) => prev.filter((j) => j.id !== p.id))
        }, delay)
      }
    })
    return () => off?.()
  }, [])

  const dismissBookmarkMediaJob = useCallback((id: string) => {
    setBookmarkMediaJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  const bookmarkMediaDownloading = useMemo(
    () => bookmarkMediaJobs.some((j) => j.id === selectedItem?.id && j.status === 'running'),
    [bookmarkMediaJobs, selectedItem?.id]
  )

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query)

      if (hasAIKey && query.trim().length >= 2) {
        try {
          const result = await window.desktopAPI.ai.hybridSearch({
            query: query.trim(),
            filters: hybridSearchFilters
          })
          if (result.ok && result.items.length > 0) {
            setSemanticMode(true)
            setSemanticResults(result.items)
            return
          }
        } catch {
          // fall through to keyword search
        }
      }

      setSemanticMode(false)
      setSemanticResults(null)
    },
    [hasAIKey, hybridSearchFilters]
  )

  const searchQueryRef = useRef(searchQuery)
  searchQueryRef.current = searchQuery

  /** Re-run hybrid when folder / type / tag / color changes while a query is active */
  useEffect(() => {
    if (!hasAIKey || searchQueryRef.current.trim().length < 2) return
    void handleSearch(searchQueryRef.current)
  }, [hybridFilterKey, hasAIKey, handleSearch])

  const hadApiKeyRef = useRef(false)
  useEffect(() => {
    if (hasAIKey && !hadApiKeyRef.current && searchQuery.length >= 2) {
      void handleSearch(searchQuery)
    }
    hadApiKeyRef.current = hasAIKey
  }, [hasAIKey, searchQuery, handleSearch])

  const handleSave = useCallback(
    async (data: Record<string, unknown>, tagIds: string[]) => {
      const item = await window.desktopAPI.items.create(data)
      for (const tagId of tagIds) {
        await window.desktopAPI.tags.addToItem(item.id, tagId)
      }
      // AI enrichment happens automatically in the backend
      // Mark as enriching immediately so overlay shows without a flash
      if (hasAIKey) {
        setEnrichingIds((prev) => new Set(prev).add(item.id))
        setEnrichmentStages((prev) => ({ ...prev, [item.id]: 'starting' }))
        setNewCardIds((prev) => new Set(prev).add(item.id))
      }
      refresh()
      refreshTags()
      // Poll for auto-tags: check at 3s, 6s, 10s for AI enrichment to complete
      if (hasAIKey) {
        const pollEnrichment = (delay: number) => {
          setTimeout(async () => {
            const updated = await window.desktopAPI.items.get(item.id)
            refresh()
            refreshTags()
            if (updated && selectedItem?.id === item.id) {
              select(updated)
            }
          }, delay)
        }
        pollEnrichment(3000)
        pollEnrichment(6000)
        pollEnrichment(10000)
      }
    },
    [refresh, refreshTags, hasAIKey, selectedItem, select]
  )

  const handleUpdate = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      const updated = await window.desktopAPI.items.update(id, data)
      if (selectedItem?.id === id) select(updated)
      refresh()
    },
    [selectedItem, select, refresh]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await window.desktopAPI.items.delete(id)
      setEnrichmentStages((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (selectedItem?.id === id) {
        select(null)
        setPreviewExpanded(false)
        if (lightboxOpen) {
          setDismissLightbox(true)
          setTimeout(() => setDismissLightbox(false), 350)
        }
      }
      refresh()
      refreshTags()
    },
    [selectedItem, select, refresh, refreshTags, lightboxOpen]
  )

  const handleSelect = useCallback(
    (item: Item) => {
      setActiveView('browse')
      if (item.id === selectedItem?.id) {
        select(null)
        setPreviewExpanded(false)
      } else {
        select(item)
      }
    },
    [selectedItem, select]
  )

  const handleHomeItemSelect = useCallback(
    (item: Item) => {
      setActiveView('browse')
      if (item.id === selectedItem?.id) {
        select(null)
        setPreviewExpanded(false)
      } else {
        select(item)
        setPreviewExpanded(false)
      }
    },
    [selectedItem, select]
  )

  const handleClosePreview = useCallback(() => {
    select(null)
    setPreviewExpanded(false)
    if (lightboxOpen) {
      setDismissLightbox(true)
      setTimeout(() => setDismissLightbox(false), 350)
    }
  }, [select, lightboxOpen])

  const openSettingsView = useCallback(() => {
    setActiveView('settings')
    setShowAddForm(false)
    setFabOpen(false)
    select(null)
    setPreviewExpanded(false)
    if (lightboxOpen) {
      setDismissLightbox(true)
      setTimeout(() => setDismissLightbox(false), 350)
    }
  }, [select, lightboxOpen])

  useEffect(() => {
    if (!vaultStatus || vaultStatus.configured || autoOpenedSettingsRef.current) return
    autoOpenedSettingsRef.current = true
    awaitingVaultSelectionRef.current = true
    openSettingsView()
  }, [vaultStatus, openSettingsView])

  useEffect(() => {
    if (!vaultStatus || vaultStatus.configured || autoPromptedVaultPickerRef.current) return
    autoPromptedVaultPickerRef.current = true
    void window.desktopAPI.vault.pickFolder().catch((err) => {
      console.error('Failed to prompt for vault folder:', err)
      autoPromptedVaultPickerRef.current = false
    })
  }, [vaultStatus])

  useEffect(() => {
    if (!vaultStatus?.path) return

    const previousVaultPath = previousVaultPathRef.current
    const vaultChanged = previousVaultPath !== null && previousVaultPath !== vaultStatus.path
    previousVaultPathRef.current = vaultStatus.path

    if (vaultChanged) {
      setActiveFolder(ALL_FOLDERS_KEY)
      setActiveType('everything')
      setActiveTag(null)
      setSearchQuery('')
      setSemanticMode(false)
      setSemanticResults(null)
      setColorFilter(null)
      select(null)
      setPreviewExpanded(false)
      if (lightboxOpen) {
        setDismissLightbox(true)
        setTimeout(() => setDismissLightbox(false), 350)
      }
    }

    if (vaultStatus.configured && awaitingVaultSelectionRef.current) {
      awaitingVaultSelectionRef.current = false
      autoPromptedVaultPickerRef.current = false
      setActiveView('browse')
    }

    refreshRef.current()
    refreshTagsRef.current()
  }, [vaultStatus?.path, vaultStatus?.configured])

  const handleLightboxChange = useCallback((open: boolean) => {
    setLightboxOpen(open)
    if (!open) {
      select(null)
      setPreviewExpanded(false)
    }
  }, [select])

  const handlePrevItem = useCallback(() => {
    if (!selectedItem) return
    const idx = displayItems.findIndex((i) => i.id === selectedItem.id)
    for (let j = idx - 1; j >= 0; j--) {
      const item = displayItems[j]
      if (lightboxOpen && item.type === 'note') continue
      select(item)
      return
    }
  }, [selectedItem, displayItems, select, lightboxOpen])

  const handleNextItem = useCallback(() => {
    if (!selectedItem) return
    const idx = displayItems.findIndex((i) => i.id === selectedItem.id)
    for (let j = idx + 1; j < displayItems.length; j++) {
      const item = displayItems[j]
      if (lightboxOpen && item.type === 'note') continue
      select(item)
      return
    }
  }, [selectedItem, displayItems, select, lightboxOpen])

  const handleAddTag = useCallback(
    async (itemId: string, tagId: string) => {
      await window.desktopAPI.tags.addToItem(itemId, tagId)
      const updated = await window.desktopAPI.items.get(itemId)
      if (selectedItem?.id === itemId) select(updated)
      refresh()
      refreshTags()
    },
    [selectedItem, select, refresh, refreshTags]
  )

  const handleRemoveTag = useCallback(
    async (itemId: string, tagId: string) => {
      await window.desktopAPI.tags.removeFromItem(itemId, tagId)
      const updated = await window.desktopAPI.items.get(itemId)
      if (selectedItem?.id === itemId) select(updated)
      refresh()
      refreshTags()
    },
    [selectedItem, select, refresh, refreshTags]
  )

  const finalizeNewItems = useCallback(
    (createdIds: string[]) => {
      if (hasAIKey && createdIds.length > 0) {
        setEnrichingIds((prev) => {
          const next = new Set(prev)
          for (const id of createdIds) next.add(id)
          return next
        })
        setEnrichmentStages((prev) => {
          const next = { ...prev }
          for (const id of createdIds) next[id] = 'starting'
          return next
        })
        setNewCardIds((prev) => {
          const next = new Set(prev)
          for (const id of createdIds) next.add(id)
          return next
        })
      }
      refresh()
      if (hasAIKey) {
        setTimeout(() => {
          refresh()
          refreshTags()
        }, 3000)
        setTimeout(() => {
          refresh()
          refreshTags()
        }, 6000)
        setTimeout(() => {
          refresh()
          refreshTags()
        }, 10000)
      }
    },
    [hasAIKey, refresh, refreshTags]
  )

  const handleDrop = useCallback(
    async (files: File[]) => {
      const nativePathSignature = createPathDropSignature(
        files
          .map((file) => ((file as any).path as string | undefined) || '')
          .filter(Boolean)
      )
      if (
        nativePathSignature &&
        lastNativeDropRef.current.signature === nativePathSignature &&
        Date.now() - lastNativeDropRef.current.at < DROP_DEDUPE_WINDOW_MS
      ) {
        return
      }

      const createdIds: string[] = []
      for (const file of files) {
        if (file.type === 'text/uri-list') {
          const url = await file.text()
          const meta = await window.desktopAPI.metadata.fetch(url)
          const item = await window.desktopAPI.items.create({
            type: 'bookmark',
            folder: currentFolder,
            title: meta.title || url,
            url,
            description: meta.description || '',
            body: meta.description || '',
            thumbnail: meta.image || undefined,
            preview_video_url: meta.mediaUrl || undefined,
            ...(meta.mediaItems?.length ? { bookmark_media: meta.mediaItems } : {}),
            bookmark_author: meta.author || undefined,
            bookmark_post_text: meta.postText || undefined,
            favicon_url: meta.favicon || undefined,
            store_name: meta.siteName || undefined
          })
          createdIds.push(item.id)
        } else if (isImageLikeFile(file)) {
          let filename: string | null = null
          const filePath = (file as any).path
          if (filePath) {
            filename = await window.desktopAPI.images.save(filePath, currentFolder || null)
          } else {
            const buffer = await file.arrayBuffer()
            filename = await window.desktopAPI.images.saveData(buffer, file.name, currentFolder || null)
          }
          if (filename) {
            const item = await window.desktopAPI.items.create({
              type: 'image',
              folder: currentFolder,
              title: file.name,
              thumbnail: filename,
              description: '',
              body: ''
            })
            createdIds.push(item.id)
          }
        } else {
          const item = await window.desktopAPI.items.create({
            type: 'note',
            folder: currentFolder,
            title: file.name,
            description: `dropped file: ${file.name} (${file.type})`,
            body: ''
          })
          createdIds.push(item.id)
        }
      }
      finalizeNewItems(createdIds)
    },
    [currentFolder, finalizeNewItems]
  )

  const handleNativePathDrop = useCallback(
    async (paths: string[]) => {
      const signature = createPathDropSignature(paths)
      if (
        signature &&
        lastNativeDropRef.current.signature === signature &&
        Date.now() - lastNativeDropRef.current.at < DROP_DEDUPE_WINDOW_MS
      ) {
        return
      }
      lastNativeDropRef.current = { signature, at: Date.now() }

      const createdIds: string[] = []
      for (const filePath of paths) {
        const filename = getPathFileName(filePath)

        if (isImageLikePath(filePath)) {
          const savedFilename = await window.desktopAPI.images.save(filePath, currentFolder || null)
          if (savedFilename) {
            const item = await window.desktopAPI.items.create({
              type: 'image',
              folder: currentFolder,
              title: filename,
              thumbnail: savedFilename,
              description: '',
              body: ''
            })
            createdIds.push(item.id)
          }
          continue
        }

        const item = await window.desktopAPI.items.create({
          type: 'note',
          folder: currentFolder,
          title: filename,
          description: `dropped file: ${filename}`,
          body: ''
        })
        createdIds.push(item.id)
      }

      finalizeNewItems(createdIds)
    },
    [currentFolder, finalizeNewItems]
  )

  const handleAppDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (activeView !== 'browse' || showAddForm) return
    e.preventDefault()
    appDragDepthRef.current += 1
    setAppDragging(true)
  }, [activeView, showAddForm])

  const handleAppDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (activeView !== 'browse' || showAddForm) return
    e.preventDefault()
    if (!appDragging) {
      setAppDragging(true)
    }
  }, [activeView, appDragging, showAddForm])

  const handleAppDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (activeView !== 'browse' || showAddForm) return
    e.preventDefault()
    appDragDepthRef.current = Math.max(0, appDragDepthRef.current - 1)
    if (appDragDepthRef.current === 0) {
      setAppDragging(false)
    }
  }, [activeView, showAddForm])

  const handleAppDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    if (activeView !== 'browse' || showAddForm) return
    e.preventDefault()
    appDragDepthRef.current = 0
    setAppDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      await handleDrop(files)
      return
    }

    const url = getDroppedUrl(e.dataTransfer)
    if (url) {
      await handleDrop([new File([url], 'url.txt', { type: 'text/uri-list' })])
    }
  }, [activeView, handleDrop, showAddForm])

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], .cm-editor, .cm-content'
        )
      ) {
        return
      }

      const cd = e.clipboardData
      if (!cd) return

      const imageFiles: File[] = []
      for (const item of cd.items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) {
            const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')
            const safeExt = ext || 'png'
            const name =
              f.name && f.name.length > 0 && f.name !== 'image.png' && f.name !== 'blob'
                ? f.name
                : `clipboard-${Date.now()}.${safeExt}`
            imageFiles.push(new File([f], name, { type: f.type }))
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        await handleDrop(imageFiles)
        return
      }

      const text = cd.getData('text/plain').trim()
      if (!text) return

      if (/^https?:\/\//i.test(text)) {
        e.preventDefault()
        await handleDrop([new File([text], 'url.txt', { type: 'text/uri-list' })])
        return
      }

      e.preventDefault()
      const firstLine = text.split('\n')[0] || ''
      const title = (firstLine.trim() || 'pasted note').slice(0, 200)
      const item = await window.desktopAPI.items.create({
        type: 'note',
        folder: currentFolder,
        title,
        body: text,
        description: ''
      })
      finalizeNewItems([item.id])
    },
    [currentFolder, handleDrop, finalizeNewItems]
  )

  const handleSetApiKey = useCallback(async (key: string) => {
    await window.desktopAPI.ai.setApiKey(key)
    setHasAIKey(true)
  }, [])

  const handlePickVaultFolder = useCallback(async () => {
    await window.desktopAPI.vault.pickFolder()
  }, [])

  const handleCreateFolder = useCallback(async (name: string) => {
    await window.desktopAPI.folders.create(name)
    refresh()
  }, [refresh])

  const handleRenameFolder = useCallback(async (currentName: string, nextName: string) => {
    const { name } = await window.desktopAPI.folders.rename(currentName, nextName)
    if (activeFolder === currentName) {
      setActiveFolder(name)
    }
    refresh()
    return name
  }, [activeFolder, refresh])

  const handleDeleteFolder = useCallback(async (name: string) => {
    await window.desktopAPI.folders.remove(name)
    if (activeFolder === name) {
      setActiveFolder(ALL_FOLDERS_KEY)
      setActiveType('everything')
    }
    refresh()
  }, [activeFolder, refresh])

  // Paste from clipboard (same behavior as drop: image → image item, URL → bookmark, plain text → note)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      void handlePaste(e)
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [handlePaste])

  useEffect(() => {
    if (!window.desktopAPI) return

    let unlisten: (() => void) | undefined
    void getCurrentWindow()
      .onDragDropEvent(({ payload }) => {
        if (activeView !== 'browse' || showAddForm) return

        if (payload.type === 'enter' || payload.type === 'over') {
          setAppDragging(true)
          return
        }

        if (payload.type === 'leave') {
          setAppDragging(false)
          return
        }

        if (payload.type === 'drop') {
          setAppDragging(false)
          if (payload.paths.length > 0) {
            void handleNativePathDrop(payload.paths)
          }
        }
      })
      .then((dispose) => {
        unlisten = dispose
      })

    return () => {
      unlisten?.()
    }
  }, [activeView, handleNativePathDrop, showAddForm])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 'n') {
        e.preventDefault()
        setFabOpen((prev) => !prev)
      } else if (meta && e.key === ',') {
        e.preventDefault()
        openSettingsView()
      } else if (meta && e.key === 'f') {
        if (activeView === 'settings') return
        e.preventDefault()
        const input = document.querySelector('.toolbar-search input') as HTMLInputElement
        input?.focus()
      } else if (meta && e.key === '1') {
        e.preventDefault()
        setActiveView('browse')
        setActiveType('everything')
      } else if (meta && e.key === '2') {
        e.preventDefault()
        setActiveView('browse')
        setActiveType('bookmark')
      } else if (meta && e.key === '3') {
        e.preventDefault()
        setActiveView('browse')
        setActiveType('note')
      } else if (meta && e.key === '4') {
        e.preventDefault()
        setActiveView('browse')
        setActiveType('image')
      } else if (meta && e.key === '5') {
        e.preventDefault()
        setActiveView('browse')
        setActiveType('wishlist')
      } else if (e.key === 'Escape') {
        if (showShaderDebug) setShowShaderDebug(false)
        else if (showAddForm) setShowAddForm(false)
        else if (fabOpen) setFabOpen(false)
        else if (activeView === 'settings') setActiveView('browse')
        else if (previewExpanded) setPreviewExpanded(false)
        else if (selectedItem) { select(null); setPreviewExpanded(false) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeView, fabOpen, openSettingsView, previewExpanded, select, selectedItem, showAddForm, showShaderDebug])

  if (shouldShowVaultSetupShell) {
    return (
      <div className="app-layout app-layout--vault-setup">
        <div className="app-main">
          <SettingsView
            vaultStatus={vaultStatus}
            hasAIKey={hasAIKey}
            onSetApiKey={handleSetApiKey}
            onPickVaultFolder={handlePickVaultFolder}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`app-layout${sidebarOpen ? '' : ' app-layout--sidebar-collapsed'}`}>
      <div className="app-sidebar-shell">
        <Sidebar
          activeView={activeView}
          activeType={activeType}
          activeFolder={activeFolder}
          activeTag={activeTag}
          onOpenSettings={openSettingsView}
          onTypeChange={(type) => {
            setActiveView('browse')
            setActiveType(type)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
          onFolderChange={(folder) => {
            setActiveView('browse')
            setActiveFolder(folder)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
          onTagChange={(t) => {
            setActiveView('browse')
            setActiveTag(t)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
          typeCounts={typeCounts}
          folderCounts={folderCounts}
          folders={folders}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          tags={tags}
        />
      </div>

      <div
        className={`app-main${appDragging ? ' card-grid-dragging' : ''}`}
        onDragEnter={handleAppDragEnter}
        onDragOver={handleAppDragOver}
        onDragLeave={handleAppDragLeave}
        onDrop={handleAppDrop}
      >
        {appDragging && activeView === 'browse' && !showAddForm && (
          <div className="card-grid-drop-zone">
            <div className="card-grid-drop-label">drop to save</div>
          </div>
        )}
        <Toolbar
          activeView={activeView}
          onSearch={handleSearch}
          semanticMode={semanticMode}
          colorFilter={colorFilter}
          onColorFilterChange={setColorFilter}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onOpenSettings={openSettingsView}
          activeType={activeType}
          activeFolder={activeFolder}
          activeTag={activeTag}
          folders={folders}
          tags={tags}
          typeCounts={typeCounts}
          folderCounts={folderCounts}
          onNavTypeChange={(type) => {
            setActiveView('browse')
            setActiveType(type)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
          onNavFolderChange={(folder) => {
            setActiveView('browse')
            setActiveFolder(folder)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
          onNavTagChange={(t) => {
            setActiveView('browse')
            setActiveTag(t)
            setSemanticMode(false)
            setSemanticResults(null)
          }}
        />

        {activeView === 'settings' ? (
          <SettingsView
            vaultStatus={vaultStatus}
            hasAIKey={hasAIKey}
            onSetApiKey={handleSetApiKey}
            onPickVaultFolder={handlePickVaultFolder}
          />
        ) : isHomeView ? (
          <HomeOverview
            items={items}
            folders={folders}
            folderCounts={folderCounts}
            loading={loading}
            selectedId={selectedItem?.id || null}
            previewExpanded={previewExpanded}
            onFolderSelect={(folder) => {
              setActiveView('browse')
              setActiveFolder(folder)
              setActiveType('everything')
              setActiveTag(null)
              setSemanticMode(false)
              setSemanticResults(null)
            }}
            onItemSelect={handleHomeItemSelect}
            onEverythingSelect={() => {
              setActiveView('browse')
              setActiveFolder(ALL_FOLDERS_KEY)
              setActiveType('everything')
              setActiveTag(null)
              setSemanticMode(false)
              setSemanticResults(null)
            }}
            onDrop={handleDrop}
            onLightboxChange={handleLightboxChange}
            dismissLightbox={dismissLightbox}
            bookmarkAttachmentIndex={bookmarkAttachmentIndex}
            onBookmarkAttachmentChange={setBookmarkAttachmentIndex}
          />
        ) : (
          <CardGrid
            items={displayItems}
            selectedId={selectedItem?.id || null}
            onSelect={handleSelect}
            loading={loading}
            viewMode={viewMode}
            onDrop={handleDrop}
            onLightboxChange={handleLightboxChange}
            dismissLightbox={dismissLightbox}
            enrichingIds={enrichingIds}
            enrichmentStages={enrichmentStages}
            newCardIds={newCardIds}
            previewExpanded={previewExpanded}
            bookmarkAttachmentIndex={bookmarkAttachmentIndex}
            onBookmarkAttachmentChange={setBookmarkAttachmentIndex}
          />
        )}

        {activeView === 'browse' && (
          <div className="fab-container">
            <div className={`fab-backdrop${fabOpen ? ' fab-backdrop--visible' : ''}`} onClick={() => fabOpen && setFabOpen(false)} style={{ pointerEvents: fabOpen ? 'auto' : 'none' }} />
            {[
              { type: 'bookmark' as const, label: 'bookmark' },
              { type: 'image' as const, label: 'image' },
              { type: 'note' as const, label: 'note' },
              { type: 'wishlist' as const, label: 'wishlist' },
            ].map((item, i) => (
              <button
                key={item.type}
                className={`fab-item${fabOpen ? ' fab-item--open' : ''}`}
                style={{ '--fab-i': i } as React.CSSProperties}
                onClick={() => {
                  setAddFormType(item.type)
                  setShowAddForm(true)
                  setFabOpen(false)
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              className={`fab-add${fabOpen ? ' fab-add--open' : ''}`}
              onClick={() => setFabOpen(!fabOpen)}
              title="Add item"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {showAddForm && (
        <AddForm
          onClose={() => setShowAddForm(false)}
          onSave={handleSave}
          folders={folders}
          tags={tags}
          onCreateTag={createTag}
          initialTab={addFormType}
          initialFolder={currentFolder || null}
        />
      )}

      {activeView === 'browse' && (
        <Preview
          item={selectedItem}
          folders={folders}
          tags={tags}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onCreateTag={createTag}
          onRefresh={refresh}
          expanded={previewExpanded}
          onExpand={() => setPreviewExpanded(true)}
          onCollapse={() => setPreviewExpanded(false)}
          onClose={handleClosePreview}
          onPrev={handlePrevItem}
          onNext={handleNextItem}
          bookmarkAttachmentIndex={bookmarkAttachmentIndex}
          onBookmarkAttachmentChange={setBookmarkAttachmentIndex}
          bookmarkMediaDownloading={bookmarkMediaDownloading}
        />
      )}

      <BookmarkDownloadToast jobs={bookmarkMediaJobs} onDismiss={dismissBookmarkMediaJob} />

      {showShaderDebug && <ShaderDebug onClose={() => setShowShaderDebug(false)} />}
    </div>
  )
}
