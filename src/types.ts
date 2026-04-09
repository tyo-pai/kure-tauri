export type ItemType = 'bookmark' | 'note' | 'image' | 'wishlist'
export type ItemStatus = 'unread' | 'archived' | 'favorite'

export type BookmarkMediaKind = 'image' | 'video'

export interface BookmarkMediaItem {
  kind: BookmarkMediaKind
  url: string
  video_url?: string | null
}
export type EnrichmentStage =
  | 'starting'
  | 'reading'
  | 'seeing'
  | 'tagging'
  | 'indexing'
  | 'finishing'

export interface Item {
  id: string
  type: ItemType
  folder_path: string | null
  folder: string | null
  title: string
  url: string | null
  description: string
  body: string
  thumbnail: string | null
  /** Multiple remote attachments for one bookmark URL (e.g. X multi-photo) */
  bookmark_media?: BookmarkMediaItem[] | null
  /** MP4 preview for video/GIF links (e.g. X syndication) */
  preview_video_url?: string | null
  bookmark_author?: string | null
  bookmark_post_text?: string | null
  favicon_url: string | null
  price: string | null
  store_name: string | null
  status: ItemStatus
  ai_summary: string
  ocr_text: string
  created_at: string
  updated_at: string
  colors?: { hex: string; name: string }[]
  ai_description?: string
  tags?: Tag[]
  relevance?: number
}

export interface Tag {
  id: string
  name: string
  count?: number
}

export interface VaultStatus {
  path: string
  configured: boolean
}

/** Desktop shell IPC for the Tauri app + Node bridge. */
export interface DesktopAPI {
  /** `darwin` | `win32` | `linux` */
  platform: string
  items: {
    list: (filters?: { type?: string; folder?: string; tag?: string; search?: string; status?: string; color?: string }) => Promise<Item[]>
    get: (id: string) => Promise<Item>
    create: (data: Record<string, unknown>) => Promise<Item>
    update: (id: string, data: Record<string, unknown>) => Promise<Item>
    delete: (id: string) => Promise<{ success: boolean }>
  }
  folders: {
    list: () => Promise<string[]>
    create: (name: string) => Promise<{ name: string }>
    rename: (currentName: string, nextName: string) => Promise<{ name: string }>
    remove: (name: string) => Promise<{ success: boolean }>
    delete: (name: string) => Promise<{ success: boolean }>
  }
  tags: {
    list: () => Promise<Tag[]>
    create: (name: string) => Promise<Tag>
    addToItem: (itemId: string, tagId: string) => Promise<{ success: boolean }>
    removeFromItem: (itemId: string, tagId: string) => Promise<{ success: boolean }>
  }
  metadata: {
    fetch: (url: string) => Promise<{
      title: string
      description: string
      image: string | null
      mediaUrl: string | null
      mediaItems: BookmarkMediaItem[]
      author: string | null
      postText: string | null
      favicon: string | null
      siteName: string | null
      price: string | null
    }>
  }
  images: {
    save: (filePath: string, folderPath?: string | null) => Promise<string | null>
    saveData: (data: ArrayBuffer, name: string, folderPath?: string | null) => Promise<string>
  }
  ai: {
    setApiKey: (key: string) => Promise<{ success: boolean }>
    hasApiKey: () => Promise<boolean>
    semanticSearch: (query: string) => Promise<{ items: Item[]; semantic: boolean; error?: string }>
    hybridSearch: (payload: {
      query: string
      filters?: { type?: string; folder?: string; tag?: string; color?: string }
    }) => Promise<{ items: Item[]; ok: boolean; error?: string }>
    backfillEmbeddings: () => Promise<{ scheduled: number }>
    parseQuery: (query: string) => Promise<{ keywords: string; type?: string; timeRange?: string; intent?: string }>
    enrichItem: (id: string) => Promise<Item | { error: string }>
    summarize: (id: string) => Promise<{ summary?: string; error?: string }>
  }
  bookmarkMedia: {
    persist: (id: string) => Promise<
      | { ok: true; skipped?: boolean; changed?: boolean }
      | { ok: false; error: string }
    >
  }
  system: {
    openUrl: (url: string) => Promise<void>
  }
  vault: {
    getStatus: () => Promise<VaultStatus>
    pickFolder: () => Promise<void>
  }
}

declare global {
  interface Window {
    desktopAPI: DesktopAPI & {
      _send?: (channel: string, ...args: unknown[]) => void
      _on?: (channel: string, callback: (...args: unknown[]) => void) => void | (() => void)
    }
  }
}
