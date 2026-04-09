import type { BookmarkMediaItem, Item } from '../types'
import { getItemAssetUrl } from './assets'

interface BookmarkMediaUrlOptions {
  width?: number
}

export function isRemoteMediaUrl(u: string | null | undefined): boolean {
  return !!u && /^https?:\/\//i.test(u)
}

/** True when any bookmark attachment still points at http(s) URLs (not yet in vault `_assets`). */
export function itemHasRemoteBookmarkAssets(item: Item): boolean {
  if (item.type !== 'bookmark' && item.type !== 'wishlist') return false
  if (item.bookmark_media && item.bookmark_media.length > 0) {
    for (const m of item.bookmark_media) {
      if (isRemoteMediaUrl(m.url)) return true
      if (m.kind === 'video' && isRemoteMediaUrl(m.video_url)) return true
    }
  }
  if (isRemoteMediaUrl(item.thumbnail)) return true
  if (isRemoteMediaUrl(item.preview_video_url)) return true
  return false
}

export function normalizeBookmarkMedia(item: Item): BookmarkMediaItem[] {
  if (item.bookmark_media && item.bookmark_media.length > 0) {
    return item.bookmark_media
  }
  if (!item.thumbnail) return []
  if (item.preview_video_url) {
    return [{ kind: 'video', url: item.thumbnail, video_url: item.preview_video_url }]
  }
  return [{ kind: 'image', url: item.thumbnail }]
}

/** Still frame URL for a media slot (poster or image). */
export function displayStillUrl(item: Item, m: BookmarkMediaItem, options?: BookmarkMediaUrlOptions): string {
  const url = m.url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return getItemAssetUrl({ ...item, thumbnail: url }, options) || url
}

/** URL for `<video src>` or `<img src>` in grid / lightbox. */
export function displayUrlForBookmarkMedia(item: Item, m: BookmarkMediaItem, options?: BookmarkMediaUrlOptions): string {
  if (m.kind === 'video' && m.video_url) {
    const vu = m.video_url
    if (vu.startsWith('http://') || vu.startsWith('https://')) return vu
    return getItemAssetUrl({ ...item, thumbnail: vu }, options) || vu
  }
  return displayStillUrl(item, m, options)
}

export function lightboxKindForMedia(m: BookmarkMediaItem): 'image' | 'video' {
  return m.kind === 'video' && m.video_url ? 'video' : 'image'
}
