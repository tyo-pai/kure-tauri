import type { BookmarkMediaItem, CreateItemData, Item } from '../types'
import { saveImageData } from './image-store'

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

function twitterHeaders(url: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
  if (/twimg\.com|video\.twimg\.com/i.test(url)) {
    h['Referer'] = 'https://x.com/'
    h['Origin'] = 'https://x.com'
  }
  return h
}

function extFromContentType(ct: string): string | null {
  if (!ct) return null
  if (/image\/jpe?g/i.test(ct)) return '.jpg'
  if (ct.includes('image/png')) return '.png'
  if (ct.includes('image/webp')) return '.webp'
  if (ct.includes('image/gif')) return '.gif'
  if (ct.includes('video/mp4')) return '.mp4'
  return null
}

function extFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\.([a-z0-9]+)$/i)
    if (m) {
      const ext = '.' + m[1].toLowerCase()
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.m4v'].includes(ext)) {
        return ext === '.jpeg' ? '.jpg' : ext
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

function pickExt(url: string, contentType: string, kind: 'still' | 'video'): string {
  return extFromContentType(contentType) || extFromUrl(url) || (kind === 'video' ? '.mp4' : '.jpg')
}

const MAX_BYTES = 100 * 1024 * 1024

async function downloadToBuffer(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const headers = twitterHeaders(url)
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) })
  if (!res.ok) {
    console.warn('[bookmark-media] fetch failed', res.status, url.slice(0, 120))
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    console.warn('[bookmark-media] skip oversize', buf.length, url.slice(0, 80))
    return null
  }
  return { buffer: buf, contentType: res.headers.get('content-type') || '' }
}

async function downloadOnce(
  url: string,
  folderPath: string | null,
  kind: 'still' | 'video',
  cache: Map<string, string>
): Promise<string | null> {
  if (!isHttpUrl(url)) return url
  const cached = cache.get(url)
  if (cached) return cached

  const result = await downloadToBuffer(url)
  if (!result) return null

  const ext = pickExt(url, result.contentType, kind)
  const name = `bm-${kind}${ext}`
  const relativePath = saveImageData(result.buffer, name, folderPath)
  cache.set(url, relativePath)
  return relativePath
}

export type BookmarkMediaDownloadProgress = {
  step: number
  total: number
  label: string
}

/** Unique remote URLs to fetch, in stable order (deduped). */
export function collectRemoteDownloadTasks(item: Item): { url: string; kind: 'still' | 'video'; label: string }[] {
  const tasks: { url: string; kind: 'still' | 'video'; label: string }[] = []
  const seen = new Set<string>()
  const add = (url: string | null | undefined, kind: 'still' | 'video', label: string) => {
    if (!url || !isHttpUrl(url) || seen.has(url)) return
    seen.add(url)
    tasks.push({ url, kind, label })
  }

  if (item.bookmark_media && item.bookmark_media.length > 0) {
    item.bookmark_media.forEach((m, i) => {
      add(m.url, 'still', `still ${i + 1}`)
      if (m.kind === 'video' && m.video_url) add(m.video_url, 'video', `video ${i + 1}`)
    })
  }
  add(item.thumbnail, 'still', 'thumbnail')
  add(item.preview_video_url, 'video', 'preview')
  return tasks
}

function buildPatchFromCache(item: Item, cache: Map<string, string>): Partial<CreateItemData> | null {
  let changed = false
  const patch: Partial<CreateItemData> = {}

  let nextMedia: BookmarkMediaItem[] | null =
    item.bookmark_media && item.bookmark_media.length > 0
      ? item.bookmark_media.map((m) => ({ ...m }))
      : null

  if (nextMedia?.length) {
    for (let i = 0; i < nextMedia.length; i++) {
      const m = nextMedia[i]
      let url = m.url
      let video_url = m.video_url

      if (isHttpUrl(url)) {
        const local = cache.get(url)
        if (local) {
          url = local
          changed = true
        }
      }
      if (m.kind === 'video' && video_url && isHttpUrl(video_url)) {
        const local = cache.get(video_url)
        if (local) {
          video_url = local
          changed = true
        }
      }
      nextMedia[i] = { ...m, url, video_url: video_url ?? undefined }
    }
    if (changed) {
      patch.bookmark_media = nextMedia
      const first = nextMedia[0]
      patch.thumbnail = first.url
      if (first.kind === 'video' && first.video_url) {
        patch.preview_video_url = first.video_url
      }
    }
  }

  let thumb = patch.thumbnail ?? item.thumbnail
  if (thumb && isHttpUrl(thumb)) {
    const local = cache.get(thumb)
    if (local) {
      patch.thumbnail = local
      changed = true
    }
  }

  let pv = patch.preview_video_url ?? item.preview_video_url
  if (pv && isHttpUrl(pv)) {
    const local = cache.get(pv)
    if (local) {
      patch.preview_video_url = local
      changed = true
    }
  }

  return changed ? patch : null
}

/**
 * Downloads remote bookmark images/videos into the vault `_assets` folder and returns
 * fields to merge via `updateItem`. Leaves URLs unchanged when a download fails.
 */
export async function persistBookmarkRemoteAssets(
  item: Item,
  onProgress?: (p: BookmarkMediaDownloadProgress) => void
): Promise<Partial<CreateItemData> | null> {
  const folderPath = item.folder_path
  const cache = new Map<string, string>()
  const tasks = collectRemoteDownloadTasks(item)

  if (tasks.length === 0) {
    return null
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    onProgress?.({ step: i + 1, total: tasks.length, label: t.label })
    await downloadOnce(t.url, folderPath, t.kind, cache)
  }

  return buildPatchFromCache(item, cache)
}
