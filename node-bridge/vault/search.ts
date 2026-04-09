import MiniSearch from 'minisearch'
import type { IndexedItem } from './types'

let engine: MiniSearch | null = null

export function initSearch(): void {
  engine = new MiniSearch({
    fields: ['title', 'description', 'body', 'ai_description', 'ocr_text', 'tags_text', 'colors_text', 'url', 'bookmark_author', 'bookmark_post_text'],
    storeFields: ['id'],
    searchOptions: {
      boost: { title: 3, tags_text: 2, description: 1.5 },
      fuzzy: 0.2,
      prefix: true
    }
  })
}

export function rebuildSearchIndex(items: Iterable<IndexedItem>): void {
  if (!engine) return
  engine.removeAll()
  for (const item of items) {
    engine.add({
      id: item.id,
      title: item.title,
      description: item.description,
      body: item.body,
      ai_description: item.ai_description,
      ocr_text: item.ocr_text,
      tags_text: item.tags.join(' '),
      colors_text: item.colors.map((c) => c.name).join(' '),
      url: item.url || '',
      bookmark_author: item.bookmark_author || '',
      bookmark_post_text: item.bookmark_post_text || ''
    })
  }
}

export function addToSearchIndex(item: IndexedItem): void {
  if (!engine) return
  // Remove first in case it already exists
  try { engine.discard(item.id) } catch { /* not found */ }
  engine.add({
    id: item.id,
    title: item.title,
    description: item.description,
    body: item.body,
    ai_description: item.ai_description,
    ocr_text: item.ocr_text,
    tags_text: item.tags.join(' '),
    colors_text: item.colors.map((c) => c.name).join(' '),
    url: item.url || '',
    bookmark_author: item.bookmark_author || '',
    bookmark_post_text: item.bookmark_post_text || ''
  })
}

export function removeFromSearchIndex(id: string): void {
  if (!engine) return
  try { engine.discard(id) } catch { /* not found */ }
}

export function search(query: string, limit = 50): string[] {
  if (!engine || !query.trim()) return []
  const results = engine.search(query, { limit })
  return results.map((r) => r.id)
}

/** MiniSearch relevance scores (higher = better match). Used for hybrid fusion with semantic retrieval. */
export function searchWithScores(query: string, limit = 50): { id: string; score: number }[] {
  if (!engine || !query.trim()) return []
  return engine.search(query, { limit }).map((r) => ({ id: r.id as string, score: r.score }))
}

export function shutdownSearch(): void {
  engine = null
}
