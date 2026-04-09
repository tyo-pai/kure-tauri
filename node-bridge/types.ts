export type ItemType = 'bookmark' | 'note' | 'image' | 'wishlist'
export type ItemStatus = 'unread' | 'archived' | 'favorite'

/** Remote bookmark attachments (e.g. X/Twitter multi-photo / video). */
export type BookmarkMediaKind = 'image' | 'video'

export interface BookmarkMediaItem {
  kind: BookmarkMediaKind
  /** Still image URL, or video poster / thumb */
  url: string
  /** MP4 when kind is video */
  video_url?: string | null
}

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
  /** Multiple images / videos for one URL (e.g. X thread media) */
  bookmark_media?: BookmarkMediaItem[] | null
  /** Direct MP4 URL (e.g. X/Twitter video or animated GIF transcoded to video) */
  preview_video_url?: string | null
  /** Hidden social creator label used to improve bookmark AI context. */
  bookmark_author?: string | null
  /** Hidden social post/caption text used to improve bookmark AI context. */
  bookmark_post_text?: string | null
  favicon_url: string | null
  price: string | null
  store_name: string | null
  status: ItemStatus
  created_at: string
  updated_at: string
  colors?: { hex: string; name: string }[]
  ai_description?: string
  /** Extracted text (e.g. from thumbnails) — optional on some code paths */
  ocr_text?: string
  tags?: Tag[]
}

export interface Tag {
  id: string
  name: string
}

export interface CreateItemData {
  type: ItemType
  folder?: string | null
  title: string
  url?: string
  description?: string
  body?: string
  thumbnail?: string
  /** Serialized on bookmark markdown as YAML */
  bookmark_media?: BookmarkMediaItem[]
  preview_video_url?: string
  bookmark_author?: string
  bookmark_post_text?: string
  favicon_url?: string
  price?: string
  store_name?: string
}

export interface ItemFilters {
  type?: string
  folder?: string
  tag?: string
  search?: string
  status?: string
  color?: string
}

export type { UrlMetadata } from '@stash/url-metadata'
