import OpenAI from 'openai'
import fs from 'fs'
import { getAISearchSettings, getOpenAIKey } from './settings'
import type { Item } from '../types'

function getClient(): OpenAI {
  const key = getOpenAIKey()
  if (!key) throw new Error('OpenAI API key not configured')
  return new OpenAI({ apiKey: key })
}

// --- Apple on-device AI ---

let appleAIAvailable: boolean | null = null

async function isAppleAIAvailable(): Promise<boolean> {
  if (appleAIAvailable !== null) return appleAIAvailable
  try {
    const { chat } = require('@meridius-labs/apple-on-device-ai')
    // Test with a minimal prompt to verify the model responds
    const result = await chat({ messages: 'test' })
    appleAIAvailable = !!result?.text
    console.error(`[ai] Apple on-device AI: ${appleAIAvailable ? 'available' : 'not available'}`)
  } catch (err) {
    appleAIAvailable = false
    console.error('[ai] Apple on-device AI: not available -', (err as Error).message)
  }
  return appleAIAvailable
}

// Apple on-device AI requires a single string prompt (not message array)
async function appleChat(prompt: string): Promise<string> {
  const { chat } = require('@meridius-labs/apple-on-device-ai')
  const response = await chat({ messages: prompt })
  return response.text?.trim() || ''
}

// --- Generate embedding (OpenAI only — no on-device alternative) ---

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient()
  const { embeddingModel } = getAISearchSettings()
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: text.slice(0, 8000)
  })
  return response.data[0].embedding
}

export function getConfiguredEmbeddingModel(): string {
  return getAISearchSettings().embeddingModel
}

function supportsReasoningConfig(model: string): boolean {
  return model.startsWith('gpt-5') || model.startsWith('o')
}

async function createSearchTextResponse({
  model,
  instructions,
  input,
  maxOutputTokens,
  jsonSchema
}: {
  model: string
  instructions: string
  input: string
  maxOutputTokens: number
  jsonSchema?: { name: string; schema: Record<string, unknown> }
}): Promise<string> {
  const client = getClient()
  const response = await client.responses.create({
    model: model as any,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    store: false,
    ...(supportsReasoningConfig(model) ? { reasoning: { effort: 'low' as const } } : {}),
    ...(jsonSchema
      ? {
          text: {
            format: {
              type: 'json_schema' as const,
              name: jsonSchema.name,
              schema: jsonSchema.schema,
              strict: true
            }
          }
        }
      : {})
  })

  return response.output_text?.trim() || ''
}

// --- Auto-generate tags ---

function buildTagPrompt(type: string, title: string, body: string): string {
  const contentSection = body?.trim()
    ? `Content: ${body.slice(0, 2000)}`
    : '(no additional content)'
  return `Given the following content, return 2-4 relevant lowercase tags as a JSON array of strings. Tags should be single words or short hyphenated phrases that categorize the content by topic, domain, or theme. Even if only a title is provided, infer relevant tags from it. Only return the JSON array, nothing else.\n\nType: ${type}\nTitle: ${title}\n${contentSection}`
}

const TAG_SYSTEM_PROMPT =
  'You are a tagging assistant for a personal knowledge base. Given content (which may be a bookmark, note, image, or wishlist item), return 2-4 relevant lowercase tags as a JSON array of strings. Tags should be single words or short hyphenated phrases that categorize the content by topic, domain, or theme. Even if only a title is provided, infer relevant tags from it. Only return the JSON array, nothing else.'

function parseTags(raw: string): string[] {
  try {
    const match = raw.match(/\[[\s\S]*?\]/)
    if (match) {
      const tags = JSON.parse(match[0]) as string[]
      return tags
        .filter((t) => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .slice(0, 4)
    }
  } catch {
    // ignore parse errors
  }
  return []
}

export async function generateTags(
  title: string,
  body: string,
  type: string
): Promise<string[]> {
  // Try Apple on-device AI first
  if (await isAppleAIAvailable()) {
    try {
      const raw = await appleChat(buildTagPrompt(type, title, body))
      const tags = parseTags(raw)
      if (tags.length > 0) {
        console.error('[ai] Tags generated via Apple on-device AI')
        return tags
      }
    } catch (err) {
      console.error('[ai] Apple AI tagging failed, falling back to OpenAI:', err)
    }
  }

  // Fallback to OpenAI
  if (!getOpenAIKey()) {
    console.error('[ai] No AI available for tagging (no Apple AI, no OpenAI key)')
    return []
  }

  const contentSection = body?.trim()
    ? `Content: ${body.slice(0, 2000)}`
    : '(no additional content)'
  const client = getClient()
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 100,
    messages: [
      { role: 'system', content: TAG_SYSTEM_PROMPT },
      { role: 'user', content: `Type: ${type}\nTitle: ${title}\n${contentSection}` }
    ]
  })

  return parseTags(response.choices[0]?.message?.content?.trim() || '[]')
}

// --- Generate summary ---

function buildSummaryPrompt(type: string, title: string, body: string): string {
  return `Summarize the following content in 1-2 sentences. Be direct and informative. Only return the summary text, nothing else.\n\nType: ${type}\nTitle: ${title}\nContent: ${body.slice(0, 3000)}`
}

const SUMMARY_SYSTEM_PROMPT =
  'You are a concise summarizer. Summarize the given content in 1-2 sentences. Be direct and informative. Only return the summary text, nothing else.'

export async function generateSummary(
  title: string,
  body: string,
  type: string
): Promise<string> {
  // Try Apple on-device AI first
  if (await isAppleAIAvailable()) {
    try {
      const result = await appleChat(buildSummaryPrompt(type, title, body))
      if (result) {
        console.error('[ai] Summary generated via Apple on-device AI')
        return result
      }
    } catch (err) {
      console.error('[ai] Apple AI summary failed, falling back to OpenAI:', err)
    }
  }

  // Fallback to OpenAI
  if (!getOpenAIKey()) {
    console.error('[ai] No AI available for summary (no Apple AI, no OpenAI key)')
    return ''
  }
  const client = getClient()
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 150,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `Type: ${type}\nTitle: ${title}\nContent: ${body.slice(0, 3000)}` }
    ]
  })

  return response.choices[0]?.message?.content?.trim() || ''
}

// --- OCR: native macOS Vision framework ---

export async function extractTextFromImage(imagePath: string): Promise<string> {
  const MacOCR = require('@cherrystudio/mac-system-ocr')
  const result = await MacOCR.recognizeFromPath(imagePath, {
    languages: 'en-US',
    recognitionLevel: 1 // ACCURATE
  })
  return result.text?.trim() || ''
}

// --- Describe image via OpenAI vision ---

export async function describeImage(imagePath: string): Promise<string> {
  if (!getOpenAIKey()) return ''
  const client = getClient()

  const imageBuffer = fs.readFileSync(imagePath)
  const base64Image = imageBuffer.toString('base64')
  const ext = imagePath.split('.').pop()?.toLowerCase() || 'png'
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image in 1-2 sentences. Focus on the main subject, style, and any notable elements. Be concise.'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'low'
            }
          }
        ]
      }
    ]
  })

  return response.choices[0]?.message?.content?.trim() || ''
}

// --- Parse search query ---

function buildParseQueryPrompt(query: string): string {
  return `Parse the following search query into structured filters. Return a JSON object with these optional fields:
- "keywords": extracted search keywords (string)
- "type": content type if mentioned ("bookmark", "note", "image", "wishlist")
- "timeRange": if a time is mentioned ("today", "this_week", "this_month", "last_month")
- "intent": if there's a clear intent ("buy", "read", "reference")
Only return the JSON object, nothing else.

Query: ${query}`
}

const PARSE_QUERY_SYSTEM_PROMPT = `You parse natural language search queries into structured filters.
Return a JSON object with these optional fields:
- "keywords": extracted search keywords (string)
- "type": content type if mentioned ("bookmark", "note", "image", "wishlist")
- "timeRange": if a time is mentioned ("today", "this_week", "this_month", "last_month")
- "intent": if there's a clear intent ("buy", "read", "reference")
Only return the JSON object, nothing else.`

function parseQueryResult(raw: string, fallback: string): {
  keywords: string
  type?: string
  timeRange?: string
  intent?: string
} {
  try {
    const match = raw.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>
      return {
        keywords: typeof parsed.keywords === 'string' && parsed.keywords.trim() ? parsed.keywords.trim() : fallback,
        type: typeof parsed.type === 'string' && parsed.type.trim() ? parsed.type.trim() : undefined,
        timeRange: typeof parsed.timeRange === 'string' && parsed.timeRange.trim() ? parsed.timeRange.trim() : undefined,
        intent: typeof parsed.intent === 'string' && parsed.intent.trim() ? parsed.intent.trim() : undefined
      }
    }
  } catch {
    // fallback
  }
  return { keywords: fallback }
}

export async function parseSearchQuery(query: string): Promise<{
  keywords: string
  type?: string
  timeRange?: string
  intent?: string
}> {
  const settings = getAISearchSettings()

  if (settings.queryParser === 'off') {
    return { keywords: query }
  }

  // Search parsing is configurable. Default is OpenAI for predictable smart search.
  if (settings.queryParser === 'apple' && await isAppleAIAvailable()) {
    try {
      const raw = await appleChat(buildParseQueryPrompt(query))
      const result = parseQueryResult(raw, query)
      if (result.keywords !== query || result.type || result.timeRange || result.intent) {
        console.error('[ai] Query parsed via Apple on-device AI')
        return result
      }
    } catch (err) {
      console.error('[ai] Apple AI query parse failed, falling back to OpenAI:', err)
    }
  }

  // Fallback to OpenAI
  if (!getOpenAIKey()) return { keywords: query }
  const raw = await createSearchTextResponse({
    model: settings.queryParserModel,
    instructions: PARSE_QUERY_SYSTEM_PROMPT,
    input: query,
    maxOutputTokens: 220,
    jsonSchema: {
      name: 'search_query_parse',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keywords: { type: 'string' },
          type: { type: 'string', enum: ['bookmark', 'note', 'image', 'wishlist', ''] },
          timeRange: { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_month', ''] },
          intent: { type: 'string' }
        },
        required: ['keywords', 'type', 'timeRange', 'intent']
      }
    }
  })

  return parseQueryResult(raw || '{}', query)
}

/** Max candidates sent to the LLM reranker (cost/latency cap). */
export const RERANK_CANDIDATE_LIMIT = 32

/**
 * Re-order the top hybrid candidates by relevance using a single LLM call.
 * Falls back to the input order on any failure. OpenAI-only (embeddings already require a key).
 */
export async function rerankSearchResults(query: string, items: Item[]): Promise<Item[]> {
  if (!getOpenAIKey() || items.length <= 1) return items
  const { rerankModel } = getAISearchSettings()

  const head = items.slice(0, RERANK_CANDIDATE_LIMIT)
  const tail = items.slice(RERANK_CANDIDATE_LIMIT)

  const snippet = (it: Item): string => {
    const parts = [
      it.title,
      it.description?.slice(0, 200),
      it.body?.slice(0, 200),
      it.ocr_text?.slice(0, 200),
      it.bookmark_post_text?.slice(0, 160)
    ].filter((x) => x && String(x).trim())
    return parts.join(' | ').slice(0, 500)
  }

  const lines = head.map((it) => `id=${it.id}\ntype=${it.type}\n${snippet(it)}`).join('\n---\n')

  try {
    const raw = await createSearchTextResponse({
      model: rerankModel,
      instructions:
        'You rank search results for a personal knowledge base. Return JSON with key "order": an array of item id strings, from most relevant to least relevant for the user query. Every id from the user message must appear exactly once.',
      input: `Query:\n${query}\n\nRank these items by relevance (most relevant first). Item ids:\n${head.map((i) => i.id).join('\n')}\n\nItem details:\n${lines}`,
      maxOutputTokens: 1400,
      jsonSchema: {
        name: 'search_rerank_order',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            order: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['order']
        }
      }
    })

    const parsed = JSON.parse(raw) as { order?: string[] }
    const ids = parsed.order
    if (!Array.isArray(ids) || ids.length === 0) return items

    const allowed = new Set(head.map((i) => i.id))
    const byId = new Map(head.map((i) => [i.id, i] as const))
    const ordered: Item[] = []
    const seen = new Set<string>()

    for (const id of ids) {
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) continue
      const it = byId.get(id)
      if (it) {
        ordered.push(it)
        seen.add(id)
      }
    }
    for (const it of head) {
      if (!seen.has(it.id)) ordered.push(it)
    }

    return [...ordered, ...tail]
  } catch (err) {
    console.error('[ai] rerankSearchResults failed:', err)
    return items
  }
}

// --- Cosine similarity ---

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
