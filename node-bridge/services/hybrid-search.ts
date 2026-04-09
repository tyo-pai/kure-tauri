import {
  cosineSimilarity,
  generateEmbedding,
  parseSearchQuery,
  rerankSearchResults
} from './ai'
import { getOpenAIKey } from './settings'
import { searchWithScores } from '../vault/search'
import { getItem, getAllEmbeddings, getItems } from '../vault/vault-manager'
import type { Item, ItemFilters } from '../types'

/** Same gates as legacy semantic-only search — see ipc-handlers. */
const SEMANTIC_MIN_SIMILARITY = 0.27
const SEMANTIC_MAX_GAP_FROM_TOP = 0.12
const SEMANTIC_POOL_LIMIT = 48

const KEYWORD_POOL_LIMIT = 150
const RRF_K = 60
const OUTPUT_LIMIT = 100

/**
 * Hybrid retrieval: MiniSearch (lexical) + embedding similarity, fused with RRF,
 * then light heuristic boosts (title / full-text token overlap).
 */
export async function runHybridSearch(query: string, filters: ItemFilters): Promise<Item[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const navFilters: ItemFilters = { ...filters }
  delete navFilters.search

  const allowedItems = getItems(navFilters)
  const allowed = new Set(allowedItems.map((i) => i.id))
  if (allowed.size === 0) return []

  // Optional query expansion: use parsed keywords for lexical + embedding search
  let searchText = trimmed
  if (getOpenAIKey() && trimmed.length >= 3) {
    try {
      const parsed = await parseSearchQuery(trimmed)
      const kw = (parsed.keywords ?? '').trim()
      if (kw.length >= 2) searchText = kw
    } catch {
      /* keep trimmed */
    }
  }

  // --- Keyword branch (relevance-ranked within MiniSearch) ---
  const kwRaw = searchWithScores(searchText, KEYWORD_POOL_LIMIT)
  const kwFiltered = kwRaw.filter((r) => allowed.has(r.id))
  const kwRank = new Map(kwFiltered.map((r, i) => [r.id, i]))

  // --- Semantic branch (optional) ---
  const semRank = new Map<string, number>()
  const semSim = new Map<string, number>()

  if (getOpenAIKey()) {
    try {
      const queryEmbedding = await generateEmbedding(searchText)
      const qLen = queryEmbedding.length
      const ranked = getAllEmbeddings()
        .filter(({ id, embedding }) => allowed.has(id) && embedding.length === qLen)
        .map(({ id, embedding }) => ({
          id,
          score: cosineSimilarity(queryEmbedding, embedding)
        }))
        .filter((r) => r.score >= SEMANTIC_MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score)

      if (ranked.length > 0) {
        const topScore = ranked[0].score
        const floorScore = Math.max(SEMANTIC_MIN_SIMILARITY, topScore - SEMANTIC_MAX_GAP_FROM_TOP)
        const kept = ranked.filter((r) => r.score >= floorScore).slice(0, SEMANTIC_POOL_LIMIT)
        kept.forEach((r, i) => {
          semRank.set(r.id, i)
          semSim.set(r.id, r.score)
        })
      }
    } catch {
      /* semantic leg optional */
    }
  }

  if (kwRank.size === 0 && semRank.size === 0) return []

  const candidateIds = new Set<string>([...kwRank.keys(), ...semRank.keys()])
  const fused: { id: string; score: number; item: Item }[] = []

  for (const id of candidateIds) {
    let rrf = 0
    const kr = kwRank.get(id)
    if (kr !== undefined) rrf += 1 / (RRF_K + kr)
    const sr = semRank.get(id)
    if (sr !== undefined) rrf += 1 / (RRF_K + sr)

    const item = getItem(id)
    if (!item) continue

    const h = heuristicRerankBonus(item, searchText, semSim.get(id), kwRank.has(id))
    fused.push({ id, score: rrf + h, item })
  }

  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return new Date(b.item.created_at).getTime() - new Date(a.item.created_at).getTime()
  })

  const ordered = fused.slice(0, OUTPUT_LIMIT).map((x) => x.item)

  if (getOpenAIKey() && ordered.length > 1) {
    return rerankSearchResults(trimmed, ordered)
  }

  return ordered
}

function heuristicRerankBonus(
  item: Item,
  query: string,
  semanticSim: number | undefined,
  hasKeywordHit: boolean
): number {
  let bonus = 0
  const q = query.toLowerCase().trim()
  const title = (item.title || '').toLowerCase()
  const tags = (item.tags || []).map((t) => t.name.toLowerCase()).join(' ')
  const blob = `${title} ${(item.description || '').toLowerCase()} ${(item.body || '').toLowerCase()} ${(item.ocr_text ?? '').toLowerCase()} ${tags}`

  if (q.length >= 2 && title.includes(q)) {
    bonus += 0.12
  }

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length > 0) {
    const allInTitle = tokens.every((t) => title.includes(t))
    if (allInTitle) bonus += 0.06
    const allInBlob = tokens.every((t) => blob.includes(t))
    if (allInBlob && !allInTitle) bonus += 0.03
  }

  // Slight preference when both lexical and semantic agree
  if (hasKeywordHit && semanticSim !== undefined && semanticSim >= SEMANTIC_MIN_SIMILARITY + 0.05) {
    bonus += 0.04
  }

  return bonus
}
