export type ItemType = 'bookmark' | 'note' | 'image' | 'wishlist'

/** Match desktop `slugify` in `node-bridge/vault/vault-manager.ts`. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80)
      .replace(/-$/, '') || 'untitled'
  )
}

function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Match desktop `genId` in `node-bridge/ipc-handlers.ts`:
 * `crypto.randomBytes(12).toString('base64url')`
 */
export function genId(): string {
  const c = globalThis.crypto
  if (!c?.getRandomValues) {
    throw new Error('crypto.getRandomValues is not available (import react-native-get-random-values in the app entry)')
  }
  const buf = new Uint8Array(12)
  c.getRandomValues(buf)
  return toBase64Url(buf)
}

/** Match `generateFilePath` in vault-manager: slug + '-' + id.slice(0,6) + '.md' */
export function bookmarkFileName(title: string, id: string): string {
  return `${slugify(title || 'untitled')}-${id.slice(0, 6)}.md`
}

export interface BookmarkMedia {
  kind: 'image' | 'video'
  url: string
  video_url?: string | null
}

export interface BookmarkInput {
  title: string
  url: string
  description?: string
  body?: string
  favicon_url?: string | null
  thumbnail?: string | null
  store_name?: string | null
  bookmark_media?: BookmarkMedia[]
  preview_video_url?: string | null
  bookmark_author?: string | null
  bookmark_post_text?: string | null
  price?: string | null
  tags?: string[]
  ai_summary?: string
  /** OpenAI text-embedding-3-small only — omit when not using OpenAI (keeps desktop semantic search compatible). */
  embedding?: number[] | null
}

export interface BookmarkBuildResult {
  id: string
  markdown: string
  fileName: string
}

function serializeFrontmatterValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value)
  }
  return JSON.stringify(String(value))
}

function stringifyFrontmatter(
  body: string,
  frontmatter: Record<string, unknown>
): string {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${serializeFrontmatterValue(value)}`
  )

  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

/** Match optional keys written by `writeItemFile` for bookmarks (minimal share-save path). */
export function buildBookmarkMarkdown(input: BookmarkInput): BookmarkBuildResult {
  const id = genId()
  const now = new Date().toISOString()
  const frontmatter: Record<string, unknown> = {
    id,
    type: 'bookmark' as ItemType,
    title: input.title,
    status: 'unread',
    created_at: now,
    updated_at: now,
    url: input.url
  }

  const desc = input.description?.trim() ?? ''
  if (desc) frontmatter.description = desc

  const fav = input.favicon_url
  if (fav) frontmatter.favicon_url = fav

  const thumb = input.thumbnail
  if (thumb) frontmatter.thumbnail = thumb

  const store = input.store_name
  if (store) frontmatter.store_name = store

  if (input.bookmark_media && input.bookmark_media.length > 0) {
    frontmatter.bookmark_media = input.bookmark_media
  }
  if (input.preview_video_url) frontmatter.preview_video_url = input.preview_video_url
  if (input.bookmark_author) frontmatter.bookmark_author = input.bookmark_author
  if (input.bookmark_post_text) frontmatter.bookmark_post_text = input.bookmark_post_text
  if (input.price) frontmatter.price = input.price
  if (input.tags && input.tags.length > 0) frontmatter.tags = input.tags
  if (input.ai_summary) frontmatter.ai_summary = input.ai_summary
  if (input.embedding && input.embedding.length > 0) frontmatter.embedding = input.embedding

  const body = (input.body ?? desc).trim()
  const markdown = stringifyFrontmatter(body, frontmatter)

  return {
    id,
    markdown,
    fileName: bookmarkFileName(input.title, id)
  }
}
