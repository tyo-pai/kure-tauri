import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import path from 'path'
import { getUserDataDir } from './lib/user-data-path'
import fs from 'fs'
import type { Item, Tag, CreateItemData, ItemFilters } from './types'

let db: SqlJsDatabase
let dbPath: string

function saveToDisk() {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

export async function initDatabase() {
  dbPath = path.join(getUserDataDir(), 'stash.db')

  const sqlJsDir = path.dirname(require.resolve('sql.js'))
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(sqlJsDir, file)
  })

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  // Run migrations
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK(type IN ('bookmark','note','image','wishlist')),
      title         TEXT NOT NULL DEFAULT '',
      url           TEXT,
      description   TEXT DEFAULT '',
      body          TEXT DEFAULT '',
      thumbnail     TEXT,
      favicon_url   TEXT,
      price         TEXT,
      store_name    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at)`)

  // Migration: add status column
  try {
    db.run(`ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'unread'`)
  } catch {
    // column already exists
  }

  // Migration: add AI columns
  try {
    db.run(`ALTER TABLE items ADD COLUMN embedding TEXT`)
  } catch {
    // column already exists
  }
  try {
    db.run(`ALTER TABLE items ADD COLUMN ai_summary TEXT DEFAULT ''`)
  } catch {
    // column already exists
  }
  try {
    db.run(`ALTER TABLE items ADD COLUMN ocr_text TEXT DEFAULT ''`)
  } catch {
    // column already exists
  }

  saveToDisk()
}

function queryAll<T>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const results: T[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as T
    results.push(row)
  }
  stmt.free()
  return results
}

function queryOne<T>(sql: string, params: any[] = []): T | undefined {
  const results = queryAll<T>(sql, params)
  return results[0]
}

function getTagsForItem(itemId: string): Tag[] {
  return queryAll<Tag>(
    `SELECT t.* FROM tags t JOIN item_tags it ON t.id = it.tag_id WHERE it.item_id = ?`,
    [itemId]
  )
}

export function getItems(filters?: ItemFilters): Item[] {
  let sql = `SELECT DISTINCT i.* FROM items i`
  const params: any[] = []

  if (filters?.tag) {
    sql += ` JOIN item_tags it ON i.id = it.item_id JOIN tags t ON it.tag_id = t.id`
  }

  const conditions: string[] = []

  if (filters?.tag) {
    conditions.push(`t.name = ?`)
    params.push(filters.tag)
  }

  if (filters?.type && filters.type !== 'everything') {
    conditions.push(`i.type = ?`)
    params.push(filters.type)
  }

  if (filters?.search) {
    const term = `%${filters.search}%`
    conditions.push(`(i.title LIKE ? OR i.description LIKE ? OR i.body LIKE ? OR i.ocr_text LIKE ? OR i.id IN (SELECT it2.item_id FROM item_tags it2 JOIN tags t2 ON it2.tag_id = t2.id WHERE t2.name LIKE ?))`)
    params.push(term, term, term, term, term)
  }

  if (filters?.status) {
    conditions.push(`i.status = ?`)
    params.push(filters.status)
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }

  sql += ` ORDER BY i.created_at DESC`

  const items = queryAll<Item>(sql, params)
  return items.map((item) => ({ ...item, tags: getTagsForItem(item.id) }))
}

export function getItem(id: string): Item | undefined {
  const item = queryOne<Item>('SELECT * FROM items WHERE id = ?', [id])
  if (!item) return undefined
  return { ...item, tags: getTagsForItem(item.id) }
}

export function createItem(id: string, data: CreateItemData): Item {
  db.run(
    `INSERT INTO items (id, type, title, url, description, body, thumbnail, favicon_url, price, store_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.type,
      data.title,
      data.url || null,
      data.description || '',
      data.body || '',
      data.thumbnail || null,
      data.favicon_url || null,
      data.price || null,
      data.store_name || null
    ]
  )
  saveToDisk()
  return getItem(id)!
}

export function updateItem(id: string, data: Partial<CreateItemData>): Item | undefined {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return getItem(id)

  const sets = entries.map(([k]) => `${k} = ?`)
  sets.push("updated_at = datetime('now')")
  const values = entries.map(([, v]) => v)
  values.push(id)

  db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, values)
  saveToDisk()
  return getItem(id)
}

export function deleteItem(id: string): void {
  db.run('DELETE FROM item_tags WHERE item_id = ?', [id])
  db.run('DELETE FROM items WHERE id = ?', [id])
  cleanupOrphanTags()
  saveToDisk()
}

export function getTags(): (Tag & { count: number })[] {
  return queryAll<Tag & { count: number }>(
    `SELECT t.*, COUNT(it.item_id) as count
     FROM tags t
     LEFT JOIN item_tags it ON t.id = it.tag_id
     GROUP BY t.id
     ORDER BY t.name`
  )
}

export function createTag(id: string, name: string): Tag {
  db.run('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)', [id, name])
  saveToDisk()
  return { id, name }
}

export function addTagToItem(itemId: string, tagId: string): void {
  db.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)', [itemId, tagId])
  saveToDisk()
}

export function removeTagFromItem(itemId: string, tagId: string): void {
  db.run('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?', [itemId, tagId])
  cleanupOrphanTags()
  saveToDisk()
}

function cleanupOrphanTags(): void {
  db.run('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)')
}

export function setItemEmbedding(id: string, embedding: number[]): void {
  db.run('UPDATE items SET embedding = ? WHERE id = ?', [JSON.stringify(embedding), id])
  saveToDisk()
}

export function setItemAISummary(id: string, summary: string): void {
  db.run('UPDATE items SET ai_summary = ? WHERE id = ?', [summary, id])
  saveToDisk()
}

export function setItemOCRText(id: string, ocrText: string): void {
  db.run('UPDATE items SET ocr_text = ? WHERE id = ?', [ocrText, id])
  saveToDisk()
}

export function getAllEmbeddings(): { id: string; embedding: number[] }[] {
  const rows = queryAll<{ id: string; embedding: string }>(
    "SELECT id, embedding FROM items WHERE embedding IS NOT NULL AND embedding != ''"
  )
  return rows
    .map((row) => {
      try {
        return { id: row.id, embedding: JSON.parse(row.embedding) as number[] }
      } catch {
        return null
      }
    })
    .filter((r): r is { id: string; embedding: number[] } => r !== null)
}

export function getItemCounts(): Record<string, number> {
  const rows = queryAll<{ type: string; count: number }>(
    `SELECT type, COUNT(*) as count FROM items GROUP BY type
     UNION ALL
     SELECT 'everything', COUNT(*) FROM items`
  )
  const counts: Record<string, number> = { everything: 0 }
  for (const row of rows) {
    counts[row.type] = row.count
  }
  return counts
}
