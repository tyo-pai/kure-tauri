import type { BookmarkMediaItem, ItemType } from '../types'

export const RESERVED_VAULT_DIRS = ['.stash', '_assets', 'images'] as const

export interface VaultConfig {
  vaultPath: string
  version: number
}

export interface IndexedItem {
  id: string
  type: ItemType
  folderPath: string | null
  folder: string | null
  title: string
  url: string | null
  description: string
  body: string
  thumbnail: string | null
  bookmark_media: BookmarkMediaItem[] | null
  preview_video_url: string | null
  bookmark_author: string | null
  bookmark_post_text: string | null
  favicon_url: string | null
  price: string | null
  store_name: string | null
  status: string
  created_at: string
  updated_at: string
  tags: string[]
  embedding: number[] | null
  ai_summary: string
  ai_description: string
  ocr_text: string
  colors: { hex: string; name: string; population: number }[]
  filePath: string
}
