import type { ItemType } from '../types'

export const TYPE_COLORS: Record<ItemType, string> = {
  note: '#888888',
  bookmark: '#4a9eff',
  image: '#22c55e',
  wishlist: '#f59e0b'
}

export const TYPE_LABELS: Record<string, string> = {
  everything: 'everything',
  bookmark: 'bookmarks',
  note: 'notes',
  image: 'images',
  wishlist: 'wishlist'
}

export const ALL_FOLDERS_KEY = '__all__'
export const ROOT_FOLDER_KEY = '__root__'
export const FOLDER_LABELS: Record<string, string> = {
  [ALL_FOLDERS_KEY]: 'everything',
  [ROOT_FOLDER_KEY]: 'root'
}

export const TYPE_FILTERS = ['everything', 'bookmark', 'note', 'image', 'wishlist'] as const
