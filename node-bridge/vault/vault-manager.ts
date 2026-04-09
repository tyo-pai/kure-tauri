import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { BookmarkMediaItem, Item, Tag, CreateItemData, ItemFilters } from '../types'
import { RESERVED_VAULT_DIRS } from './types'
import type { IndexedItem } from './types'
import { startWatcher, stopWatcher, markSelfWrite } from './file-watcher'
import {
  initSearch,
  rebuildSearchIndex,
  addToSearchIndex,
  removeFromSearchIndex,
  search as miniSearch,
  shutdownSearch
} from './search'
import { itemMatchesColorFilter } from '../../src/lib/colorMatch'

let vaultPath = ''
const index = new Map<string, IndexedItem>()

let onExternalChange: (() => void) | null = null
const LLM_VAULT_GUIDE_NAME = 'STASH_FOR_LLMS.md'

function seedLlmVaultGuideIfMissing(): void {
  const dest = path.join(vaultPath, LLM_VAULT_GUIDE_NAME)
  if (fs.existsSync(dest)) return

  const candidates = [
    path.join(__dirname, '../../docs/stash-vault-for-llms.md'),
    path.join(process.resourcesPath ?? '', 'docs/stash-vault-for-llms.md')
  ]

  for (const src of candidates) {
    if (!src) continue
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest)
        return
      }
    } catch (err) {
      console.warn('[vault] Could not copy LLM vault guide:', err)
    }
  }
}

const ROOT_FOLDER_FILTER = '__root__'
const ROOT_ASSETS_DIR = '_assets'
const LEGACY_IMAGES_DIR = 'images'

function sanitizeBookmarkMedia(raw: unknown): BookmarkMediaItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: BookmarkMediaItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const kind = o.kind === 'video' ? 'video' : 'image'
    const url = typeof o.url === 'string' ? o.url : null
    if (!url) continue
    if (kind === 'video') {
      const video_url = typeof o.video_url === 'string' ? o.video_url : null
      if (video_url) out.push({ kind: 'video', url, video_url })
    } else {
      out.push({ kind: 'image', url })
    }
  }
  return out.length > 0 ? out : null
}

export function setExternalChangeListener(fn: () => void): void {
  onExternalChange = fn
}

export async function initVault(chosenPath: string): Promise<void> {
  vaultPath = chosenPath

  const dirs = [
    vaultPath,
    path.join(vaultPath, '.stash'),
    path.join(vaultPath, '.stash', 'cache')
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }

  seedLlmVaultGuideIfMissing()

  buildIndex()
  migrateLegacyThumbnails()

  initSearch()
  rebuildSearchIndex(index.values())

  startWatcher(vaultPath, (filePath, event) => {
    if (event === 'refresh') {
      onExternalChange?.()
      return
    }

    if (event === 'unlink') {
      for (const [id, item] of index) {
        if (item.filePath === filePath) {
          index.delete(id)
          removeFromSearchIndex(id)
          break
        }
      }
    } else {
      const parsed = parseFile(filePath)
      if (parsed) {
        index.set(parsed.id, parsed)
        addToSearchIndex(parsed)
      }
    }
    onExternalChange?.()
  })
}

export function getVaultBasePath(): string {
  return vaultPath
}

export function shutdownVault(): void {
  stopWatcher()
  shutdownSearch()
  index.clear()
}

function buildIndex(): void {
  index.clear()
  for (const filePath of collectMarkdownFiles(vaultPath)) {
    const parsed = parseFile(filePath)
    if (parsed) {
      index.set(parsed.id, parsed)
    }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/-$/, '')
    || 'untitled'
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function isReservedDirName(name: string): boolean {
  return RESERVED_VAULT_DIRS.includes(name as any)
}

function normalizeFolderSegment(segment: string): string {
  const cleaned = segment
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()

  if (!cleaned) return ''
  if (isReservedDirName(cleaned)) {
    return `${cleaned}-folder`
  }
  return cleaned
}

function normalizeFolderPath(folderPath: string | null | undefined): string | null {
  if (!folderPath) return null

  const segments = toPosixPath(folderPath)
    .split('/')
    .map(normalizeFolderSegment)
    .filter(Boolean)

  return segments.length > 0 ? segments.join('/') : null
}

function normalizeTopLevelFolderName(name: string | null | undefined): string | null {
  if (!name) return null
  return normalizeFolderSegment(name)
}

function deriveFolderPathFromPath(filePath: string): string | null {
  const relativeDir = path.relative(vaultPath, path.dirname(filePath))
  if (!relativeDir || relativeDir === '.') return null
  return normalizeFolderPath(relativeDir)
}

function deriveFolderFromFolderPath(folderPath: string | null): string | null {
  if (!folderPath) return null
  const [firstSegment] = folderPath.split('/')
  return normalizeTopLevelFolderName(firstSegment)
}

function replaceTopLevelFolder(folderPath: string | null, currentName: string, nextName: string): string | null {
  if (!folderPath) return folderPath
  const segments = folderPath.split('/')
  if (segments[0] !== currentName) return folderPath
  segments[0] = nextName
  return segments.join('/')
}

function normalizeEmbeddingFromFrontmatter(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const nums = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n))
  // text-embedding-3-small → 1536 dims; reject corrupted / truncated YAML
  if (nums.length < 256) return null
  return nums
}

function parseFile(filePath: string): IndexedItem | null {
  try {
    if (!filePath.endsWith('.md')) return null

    const raw = fs.readFileSync(filePath, 'utf-8')
    const { data, content } = matter(raw)

    if (!data.id || !data.type) return null

    const folderPath = deriveFolderPathFromPath(filePath)
    return {
      id: data.id,
      type: data.type,
      folderPath,
      folder: deriveFolderFromFolderPath(folderPath),
      title: data.title || '',
      url: data.url || null,
      description: data.description || '',
      body: content.trim(),
      thumbnail: typeof data.thumbnail === 'string' ? toPosixPath(data.thumbnail) : null,
      bookmark_media: sanitizeBookmarkMedia(data.bookmark_media),
      preview_video_url: typeof data.preview_video_url === 'string' ? data.preview_video_url : null,
      bookmark_author: typeof data.bookmark_author === 'string' ? data.bookmark_author : null,
      bookmark_post_text: typeof data.bookmark_post_text === 'string' ? data.bookmark_post_text : null,
      favicon_url: data.favicon_url || null,
      price: data.price || null,
      store_name: data.store_name || null,
      status: data.status || 'unread',
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
      tags: Array.isArray(data.tags) ? data.tags : [],
      embedding: normalizeEmbeddingFromFrontmatter(data.embedding),
      ai_summary: data.ai_summary || '',
      ai_description: data.ai_description || '',
      ocr_text: data.ocr_text || '',
      colors: Array.isArray(data.colors) ? data.colors : [],
      filePath
    }
  } catch (err) {
    console.error(`[vault] Failed to parse ${filePath}:`, err)
    return null
  }
}

function getFolderDir(folderPath: string | null): string {
  return folderPath ? path.join(vaultPath, folderPath) : vaultPath
}

export function getFolderAssetsDir(folderPath: string | null): string {
  const dir = path.join(getFolderDir(folderPath), ROOT_ASSETS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getLegacyImagesDir(): string {
  return path.join(vaultPath, LEGACY_IMAGES_DIR)
}

function buildRelativeAssetPath(folderPath: string | null, assetPath: string): string {
  const normalizedAssetPath = toPosixPath(assetPath).replace(/^\.?\//, '')
  return folderPath ? `${folderPath}/${normalizedAssetPath}` : normalizedAssetPath
}

function isManagedThumbnail(thumbnail: string | null): thumbnail is string {
  return !!thumbnail && !thumbnail.startsWith('http://') && !thumbnail.startsWith('https://')
}

function isLegacyManagedThumbnail(thumbnail: string | null): thumbnail is string {
  return !!thumbnail && isManagedThumbnail(thumbnail) && !toPosixPath(thumbnail).includes('/')
}

export function resolveManagedAssetPath(assetPath: string, folderPath: string | null = null): string {
  const normalized = toPosixPath(assetPath).replace(/^\.?\//, '')
  if (isLegacyManagedThumbnail(normalized)) {
    const legacyPath = path.join(getLegacyImagesDir(), normalized)
    if (fs.existsSync(legacyPath)) {
      return legacyPath
    }
  }
  return path.join(getFolderDir(folderPath), normalized)
}

function getAvailableAssetRelativePath(folderPath: string | null, originalName: string): string {
  const parsed = path.parse(originalName)
  const safeBase = slugify(parsed.name || 'asset')
  const ext = parsed.ext || '.png'
  let candidate = `${ROOT_ASSETS_DIR}/${safeBase}${ext}`
  let counter = 1

  while (fs.existsSync(resolveManagedAssetPath(candidate, folderPath))) {
    candidate = `${ROOT_ASSETS_DIR}/${safeBase}-${counter}${ext}`
    counter += 1
  }

  return candidate
}

function removeEmptyDirsUpToVault(startDir: string): void {
  let current = startDir
  const root = path.resolve(vaultPath)

  while (path.resolve(current).startsWith(root) && path.resolve(current) !== root) {
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) break
    if (fs.readdirSync(current).length > 0) break
    fs.rmdirSync(current)
    current = path.dirname(current)
  }
}

function writeItemFile(item: IndexedItem): void {
  const frontmatter: Record<string, any> = {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at
  }

  if (item.url) frontmatter.url = item.url
  if (item.description) frontmatter.description = item.description
  if (item.thumbnail) frontmatter.thumbnail = item.thumbnail
  if (item.bookmark_media && item.bookmark_media.length > 0) {
    frontmatter.bookmark_media = item.bookmark_media
  }
  if (item.preview_video_url) frontmatter.preview_video_url = item.preview_video_url
  if (item.bookmark_author) frontmatter.bookmark_author = item.bookmark_author
  if (item.bookmark_post_text) frontmatter.bookmark_post_text = item.bookmark_post_text
  if (item.favicon_url) frontmatter.favicon_url = item.favicon_url
  if (item.price) frontmatter.price = item.price
  if (item.store_name) frontmatter.store_name = item.store_name
  if (item.tags.length > 0) frontmatter.tags = item.tags
  if (item.ai_summary) frontmatter.ai_summary = item.ai_summary
  if (item.ai_description) frontmatter.ai_description = item.ai_description
  if (item.ocr_text) frontmatter.ocr_text = item.ocr_text
  if (item.colors.length > 0) frontmatter.colors = item.colors
  if (item.embedding) frontmatter.embedding = item.embedding

  const fileContent = matter.stringify(item.body || '', frontmatter)

  fs.mkdirSync(path.dirname(item.filePath), { recursive: true })
  const tmpPath = item.filePath + '.tmp'
  markSelfWrite(item.filePath)
  fs.writeFileSync(tmpPath, fileContent, 'utf-8')
  fs.renameSync(tmpPath, item.filePath)
}

function deleteItemFile(item: IndexedItem): void {
  markSelfWrite(item.filePath)
  if (fs.existsSync(item.filePath)) {
    fs.unlinkSync(item.filePath)
  }
  removeEmptyDirsUpToVault(path.dirname(item.filePath))
}

function relocateManagedThumbnail(thumbnail: string | null, fromFolderPath: string | null, toFolderPath: string | null): string | null {
  if (!isManagedThumbnail(thumbnail)) return thumbnail
  if (fromFolderPath === toFolderPath) return thumbnail

  const sourcePath = resolveManagedAssetPath(thumbnail, fromFolderPath)
  if (!fs.existsSync(sourcePath)) return thumbnail

  const nextRelativePath = getAvailableAssetRelativePath(toFolderPath, path.basename(sourcePath))
  const targetPath = resolveManagedAssetPath(nextRelativePath, toFolderPath)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.renameSync(sourcePath, targetPath)
  removeEmptyDirsUpToVault(path.dirname(sourcePath))
  return nextRelativePath
}

function deleteManagedThumbnailIfUnused(item: IndexedItem): void {
  if (!isManagedThumbnail(item.thumbnail)) return

  const thumbnailPath = resolveManagedAssetPath(item.thumbnail, item.folderPath)
  const isReferencedElsewhere = Array.from(index.values()).some((other) => {
    if (other.id === item.id || !isManagedThumbnail(other.thumbnail)) return false
    return resolveManagedAssetPath(other.thumbnail, other.folderPath) === thumbnailPath
  })

  if (isReferencedElsewhere) return
  if (fs.existsSync(thumbnailPath)) {
    fs.unlinkSync(thumbnailPath)
    removeEmptyDirsUpToVault(path.dirname(thumbnailPath))
  }
}

function migrateLegacyThumbnails(): void {
  const legacyDir = getLegacyImagesDir()
  if (!fs.existsSync(legacyDir)) return

  const migratedLegacyFiles = new Set<string>()

  for (const item of index.values()) {
    if (!isLegacyManagedThumbnail(item.thumbnail)) continue

    const legacyPath = path.join(legacyDir, item.thumbnail)
    if (!fs.existsSync(legacyPath)) continue

    const nextRelativePath = getAvailableAssetRelativePath(item.folderPath, path.basename(item.thumbnail))
    const targetPath = resolveManagedAssetPath(nextRelativePath, item.folderPath)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(legacyPath, targetPath)
    item.thumbnail = nextRelativePath
    writeItemFile(item)
    migratedLegacyFiles.add(legacyPath)
  }

  for (const filePath of migratedLegacyFiles) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) {
    fs.rmdirSync(legacyDir)
  }
}

export function getFolders(): string[] {
  if (!vaultPath || !fs.existsSync(vaultPath)) return []

  return fs.readdirSync(vaultPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isReservedDirName(entry.name))
    .map((entry) => normalizeTopLevelFolderName(entry.name))
    .filter((folder): folder is string => !!folder)
    .sort((a, b) => a.localeCompare(b))
}

export function createFolder(name: string): string {
  const folder = normalizeTopLevelFolderName(name)
  if (!folder) {
    throw new Error('Folder name is required')
  }

  fs.mkdirSync(getFolderDir(folder), { recursive: true })
  return folder
}

export function renameFolder(currentName: string, nextName: string): string {
  const currentFolder = normalizeTopLevelFolderName(currentName)
  const renamedFolder = normalizeTopLevelFolderName(nextName)

  if (!currentFolder) throw new Error('Current folder name is required')
  if (!renamedFolder) throw new Error('New folder name is required')
  if (currentFolder === renamedFolder) return renamedFolder

  const currentDir = getFolderDir(currentFolder)
  const nextDir = getFolderDir(renamedFolder)

  if (!fs.existsSync(currentDir)) {
    throw new Error('Folder not found')
  }
  if (fs.existsSync(nextDir)) {
    throw new Error('A folder with that name already exists')
  }

  fs.renameSync(currentDir, nextDir)

  for (const item of index.values()) {
    if (deriveFolderFromFolderPath(item.folderPath) !== currentFolder) continue
    item.folderPath = replaceTopLevelFolder(item.folderPath, currentFolder, renamedFolder)
    item.folder = deriveFolderFromFolderPath(item.folderPath)
    item.filePath = path.join(nextDir, path.relative(currentDir, item.filePath))
    writeItemFile(item)
    addToSearchIndex(item)
  }

  return renamedFolder
}

export function deleteFolder(name: string): void {
  const folder = normalizeTopLevelFolderName(name)
  if (!folder) throw new Error('Folder name is required')

  const dir = getFolderDir(folder)
  if (!fs.existsSync(dir)) return

  const hasItems = Array.from(index.values()).some((item) => deriveFolderFromFolderPath(item.folderPath) === folder)
  if (hasItems || fs.readdirSync(dir).length > 0) {
    throw new Error('Folder must be empty before removal')
  }

  fs.rmdirSync(dir)
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isReservedDirName(entry.name)) continue
      files.push(...collectMarkdownFiles(fullPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath)
    }
  }
  return files
}

function generateFilePath(folderPath: string | null, title: string, id: string): string {
  const slug = slugify(title)
  const shortId = id.slice(0, 6)
  return path.join(getFolderDir(folderPath), `${slug}-${shortId}.md`)
}

function toItem(indexed: IndexedItem): Item {
  return {
    id: indexed.id,
    type: indexed.type,
    folder_path: indexed.folderPath,
    folder: indexed.folder,
    title: indexed.title,
    url: indexed.url,
    description: indexed.description,
    body: indexed.body,
    thumbnail: indexed.thumbnail,
    bookmark_media: indexed.bookmark_media?.length ? indexed.bookmark_media : undefined,
    preview_video_url: indexed.preview_video_url || undefined,
    bookmark_author: indexed.bookmark_author || undefined,
    bookmark_post_text: indexed.bookmark_post_text || undefined,
    favicon_url: indexed.favicon_url,
    price: indexed.price,
    store_name: indexed.store_name,
    status: indexed.status as Item['status'],
    created_at: indexed.created_at,
    updated_at: indexed.updated_at,
    colors: indexed.colors.length > 0
      ? indexed.colors.map((c) => ({ hex: c.hex, name: c.name }))
      : undefined,
    ai_description: indexed.ai_description || undefined,
    ai_summary: indexed.ai_summary,
    ocr_text: indexed.ocr_text,
    tags: indexed.tags.map((name) => ({ id: name, name }))
  }
}

export function getItems(filters?: ItemFilters): Item[] {
  let items = Array.from(index.values())
  /** MiniSearch relevance order (lower index = better match); only set when search filter is active */
  let searchRank: Map<string, number> | null = null
  const folderFilter = filters?.folder

  if (folderFilter === ROOT_FOLDER_FILTER) {
    items = items.filter((item) => !item.folderPath)
  } else if (folderFilter) {
    items = items.filter((item) => item.folder === folderFilter)
  }

  if (filters?.type && filters.type !== 'everything') {
    items = items.filter((item) => item.type === filters.type)
  }

  if (filters?.tag) {
    const tagName = filters.tag.toLowerCase()
    items = items.filter((item) => item.tags.some((tag) => tag.toLowerCase() === tagName))
  }

  if (filters?.search) {
    const matchingIds = miniSearch(filters.search)
    if (matchingIds.length > 0) {
      const rank = new Map<string, number>()
      matchingIds.forEach((id, i) => {
        if (!rank.has(id)) rank.set(id, i)
      })
      searchRank = rank
      const idSet = new Set(matchingIds)
      items = items.filter((item) => idSet.has(item.id))
    } else {
      items = []
    }
  }

  if (filters?.color) {
    items = items.filter((item) => itemMatchesColorFilter(item, filters.color!))
  }

  if (filters?.status) {
    items = items.filter((item) => item.status === filters.status)
  }

  if (searchRank) {
    const rank = searchRank
    items.sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  } else {
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }
  return items.map(toItem)
}

export function getItem(id: string): Item | undefined {
  const indexed = index.get(id)
  if (!indexed) return undefined
  return toItem(indexed)
}

export function createItem(id: string, data: CreateItemData): Item {
  const now = new Date().toISOString()
  const folderPath = normalizeFolderPath(data.folder)
  const filePath = generateFilePath(folderPath, data.title || 'untitled', id)

  const bookmark_media = sanitizeBookmarkMedia(data.bookmark_media)
  const thumbnailFromMedia = bookmark_media?.[0]?.url ?? null
  const previewFromMedia =
    bookmark_media?.[0]?.kind === 'video' && bookmark_media[0].video_url
      ? bookmark_media[0].video_url
      : null

  const indexed: IndexedItem = {
    id,
    type: data.type,
    folderPath,
    folder: deriveFolderFromFolderPath(folderPath),
    title: data.title || '',
    url: data.url || null,
    description: data.description || '',
    body: data.body || '',
    thumbnail:
      typeof data.thumbnail === 'string'
        ? toPosixPath(data.thumbnail)
        : thumbnailFromMedia
          ? toPosixPath(thumbnailFromMedia)
          : null,
    bookmark_media,
    preview_video_url:
      typeof data.preview_video_url === 'string' ? data.preview_video_url : previewFromMedia,
    bookmark_author: data.bookmark_author || null,
    bookmark_post_text: data.bookmark_post_text || null,
    favicon_url: data.favicon_url || null,
    price: data.price || null,
    store_name: data.store_name || null,
    status: 'unread',
    created_at: now,
    updated_at: now,
    tags: [],
    embedding: null,
    ai_summary: '',
    ai_description: '',
    ocr_text: '',
    colors: [],
    filePath
  }

  writeItemFile(indexed)
  index.set(id, indexed)
  addToSearchIndex(indexed)
  return toItem(indexed)
}

export function updateItem(id: string, data: Partial<CreateItemData>): Item | undefined {
  const existing = index.get(id)
  if (!existing) return undefined

  const updated: IndexedItem = { ...existing, updated_at: new Date().toISOString() }

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue

    if (key === 'folder') {
      updated.folderPath = normalizeFolderPath(value as string | null | undefined)
      updated.folder = deriveFolderFromFolderPath(updated.folderPath)
      continue
    }

    if (key === 'thumbnail') {
      updated.thumbnail = typeof value === 'string' ? toPosixPath(value) : null
      continue
    }

    if (key === 'bookmark_media') {
      updated.bookmark_media = sanitizeBookmarkMedia(value)
      continue
    }

    ;(updated as any)[key] = value
  }

  if ('folder' in data && existing.folderPath !== updated.folderPath) {
    updated.thumbnail = relocateManagedThumbnail(existing.thumbnail, existing.folderPath, updated.folderPath)
  }

  if (
    (data.title && data.title !== existing.title) ||
    ('folder' in data && updated.folderPath !== existing.folderPath)
  ) {
    deleteItemFile(existing)
    updated.filePath = generateFilePath(updated.folderPath, updated.title, updated.id)
  }

  writeItemFile(updated)
  index.set(id, updated)
  addToSearchIndex(updated)
  return toItem(updated)
}

export function deleteItem(id: string): void {
  const existing = index.get(id)
  if (!existing) return
  deleteItemFile(existing)
  deleteManagedThumbnailIfUnused(existing)
  index.delete(id)
  removeFromSearchIndex(id)
}

export function getTags(): (Tag & { count: number })[] {
  const tagCounts = new Map<string, number>()

  for (const item of index.values()) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }

  return Array.from(tagCounts.entries())
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createTag(_id: string, name: string): Tag {
  return { id: name, name }
}

export function addTagToItem(itemId: string, tagId: string): void {
  const item = index.get(itemId)
  if (!item) return

  if (!item.tags.includes(tagId)) {
    item.tags.push(tagId)
    item.updated_at = new Date().toISOString()
    writeItemFile(item)
    addToSearchIndex(item)
  }
}

export function removeTagFromItem(itemId: string, tagId: string): void {
  const item = index.get(itemId)
  if (!item) return

  const idx = item.tags.indexOf(tagId)
  if (idx !== -1) {
    item.tags.splice(idx, 1)
    item.updated_at = new Date().toISOString()
    writeItemFile(item)
    addToSearchIndex(item)
  }
}

export function setItemColors(id: string, colors: { hex: string; name: string; population: number }[]): void {
  const item = index.get(id)
  if (!item) return
  item.colors = colors
  writeItemFile(item)
}

export function getItemsNeedingColors(): { id: string; thumbnail: string; folderPath: string | null }[] {
  const results: { id: string; thumbnail: string; folderPath: string | null }[] = []
  for (const item of index.values()) {
    if (item.thumbnail && item.colors.length === 0) {
      results.push({ id: item.id, thumbnail: item.thumbnail, folderPath: item.folderPath })
    }
  }
  return results
}

export function setItemEmbedding(id: string, embedding: number[]): void {
  const item = index.get(id)
  if (!item) return
  item.embedding = embedding
  writeItemFile(item)
}

export function setItemAIDescription(id: string, description: string): void {
  const item = index.get(id)
  if (!item) return
  item.ai_description = description
  writeItemFile(item)
}

export function setItemAISummary(id: string, summary: string): void {
  const item = index.get(id)
  if (!item) return
  item.ai_summary = summary
  writeItemFile(item)
}

export function setItemOCRText(id: string, ocrText: string): void {
  const item = index.get(id)
  if (!item) return
  item.ocr_text = ocrText
  writeItemFile(item)
}

export function getAllEmbeddings(): { id: string; embedding: number[] }[] {
  const results: { id: string; embedding: number[] }[] = []
  for (const item of index.values()) {
    if (item.embedding && item.embedding.length > 0) {
      results.push({ id: item.id, embedding: item.embedding })
    }
  }
  return results
}

export function getItemIdsMissingEmbeddings(): string[] {
  const ids: string[] = []
  for (const item of index.values()) {
    if (!item.embedding || item.embedding.length === 0) ids.push(item.id)
  }
  return ids
}

export function itemHasEmbedding(id: string): boolean {
  const item = index.get(id)
  return !!(item?.embedding && item.embedding.length > 0)
}

export function getItemCounts(): Record<string, number> {
  const counts: Record<string, number> = { everything: 0 }
  for (const item of index.values()) {
    counts[item.type] = (counts[item.type] || 0) + 1
    const folderKey = item.folder || ROOT_FOLDER_FILTER
    counts[folderKey] = (counts[folderKey] || 0) + 1
    counts.everything += 1
  }
  return counts
}

export function getCacheDir(): string {
  const dir = path.join(vaultPath, '.stash', 'cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
