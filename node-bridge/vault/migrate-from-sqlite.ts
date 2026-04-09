import path from 'path'
import fs from 'fs'
import { getUserDataDir } from '../lib/user-data-path'
import matter from 'gray-matter'
import { RESERVED_VAULT_DIRS } from './types'

interface SqliteRow {
  id: string
  type: string
  title: string
  url: string | null
  description: string
  body: string
  thumbnail: string | null
  favicon_url: string | null
  price: string | null
  store_name: string | null
  status: string
  created_at: string
  updated_at: string
  embedding: string | null
  ai_summary: string
  ocr_text: string
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

function collectExistingVaultItemIds(dir: string): Set<string> {
  const ids = new Set<string>()

  function walk(currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (RESERVED_VAULT_DIRS.includes(entry.name as typeof RESERVED_VAULT_DIRS[number])) {
          continue
        }
        walk(path.join(currentDir, entry.name))
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      try {
        const raw = fs.readFileSync(path.join(currentDir, entry.name), 'utf-8')
        const { data } = matter(raw)
        if (typeof data.id === 'string' && typeof data.type === 'string') {
          ids.add(data.id)
        }
      } catch {
        // Ignore malformed markdown here; the main vault loader will surface parse problems separately.
      }
    }
  }

  if (fs.existsSync(dir)) {
    walk(dir)
  }

  return ids
}

export async function migrateFromSqlite(vaultPath: string): Promise<{ migrated: number; errors: string[] }> {
  const markerPath = path.join(vaultPath, '.stash', 'migrated-from-sqlite')
  const markerExists = fs.existsSync(markerPath)

  const dbPath = path.join(getUserDataDir(), 'stash.db')
  if (!fs.existsSync(dbPath)) {
    console.error('[migrate] No existing stash.db found, nothing to migrate')
    return { migrated: 0, errors: [] }
  }

  const existingItemIds = collectExistingVaultItemIds(vaultPath)
  console.error(
    markerExists
      ? `[migrate] Checking for missing SQLite items (${existingItemIds.size} already present in vault)...`
      : `[migrate] Starting migration from stash.db (${existingItemIds.size} items already present in vault)...`
  )

  const errors: string[] = []
  let migrated = 0

  try {
    const initSqlJs = require('sql.js')
    const sqlJsDir = path.dirname(require.resolve('sql.js'))
    const SQL = await initSqlJs({
      locateFile: (file: string) => path.join(sqlJsDir, file)
    })

    const fileBuffer = fs.readFileSync(dbPath)
    const db = new SQL.Database(fileBuffer)

    // Get all items
    const stmt = db.prepare('SELECT * FROM items ORDER BY created_at DESC')
    const items: SqliteRow[] = []
    while (stmt.step()) {
      items.push(stmt.getAsObject() as SqliteRow)
    }
    stmt.free()

    // Get tags for each item
    const tagStmt = db.prepare(
      'SELECT t.name FROM tags t JOIN item_tags it ON t.id = it.tag_id WHERE it.item_id = ?'
    )

    for (const row of items) {
      if (existingItemIds.has(row.id)) {
        continue
      }

      try {
        // Get item tags
        tagStmt.bind([row.id])
        const tags: string[] = []
        while (tagStmt.step()) {
          const tagRow = tagStmt.getAsObject() as { name: string }
          tags.push(tagRow.name)
        }
        tagStmt.reset()

        // Build the indexed item
        const slug = slugify(row.title || 'untitled')
        const shortId = row.id.slice(0, 6)
        const filePath = path.join(vaultPath, `${slug}-${shortId}.md`)

        // Copy image files into the root-level asset folder for imported items
        if (row.thumbnail && !row.thumbnail.startsWith('http')) {
          const oldImagePath = path.join(getUserDataDir(), 'images', row.thumbnail)
          if (fs.existsSync(oldImagePath)) {
            const assetDir = path.join(vaultPath, '_assets')
            fs.mkdirSync(assetDir, { recursive: true })
            const newImagePath = path.join(assetDir, row.thumbnail)
            if (!fs.existsSync(newImagePath)) {
              fs.copyFileSync(oldImagePath, newImagePath)
            }
            row.thumbnail = path.join('_assets', row.thumbnail).replace(/\\/g, '/')
          }
        }

        // Build frontmatter
        const frontmatter: Record<string, any> = {
          id: row.id,
          type: row.type,
          title: row.title || '',
          status: row.status || 'unread',
          created_at: row.created_at,
          updated_at: row.updated_at
        }

        if (row.url) frontmatter.url = row.url
        if (row.description) frontmatter.description = row.description
        if (row.thumbnail) frontmatter.thumbnail = row.thumbnail
        if (row.favicon_url) frontmatter.favicon_url = row.favicon_url
        if (row.price) frontmatter.price = row.price
        if (row.store_name) frontmatter.store_name = row.store_name
        if (tags.length > 0) frontmatter.tags = tags
        if (row.ai_summary) frontmatter.ai_summary = row.ai_summary
        if (row.ocr_text) frontmatter.ocr_text = row.ocr_text

        if (row.embedding) {
          try {
            frontmatter.embedding = JSON.parse(row.embedding)
          } catch {
            // skip malformed embedding
          }
        }

        const body = row.body || ''
        const fileContent = matter.stringify(body, frontmatter)

        // Ensure directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, fileContent, 'utf-8')

        migrated++
        existingItemIds.add(row.id)
        console.error(`[migrate] ✓ ${row.type}: ${row.title || row.id}`)
      } catch (err: any) {
        const msg = `Failed to migrate item ${row.id}: ${err.message}`
        errors.push(msg)
        console.error(`[migrate] ✗ ${msg}`)
      }
    }

    tagStmt.free()
    db.close()

    // Migrate settings
    const oldSettingsPath = path.join(getUserDataDir(), 'settings.json')
    if (fs.existsSync(oldSettingsPath)) {
      const settings = JSON.parse(fs.readFileSync(oldSettingsPath, 'utf-8'))
      const newSettingsPath = path.join(vaultPath, '.stash', 'config.json')
      fs.writeFileSync(newSettingsPath, JSON.stringify(settings, null, 2))
      console.error('[migrate] Settings copied to vault')
    }

    // Write migration marker
    fs.mkdirSync(path.join(vaultPath, '.stash'), { recursive: true })
    fs.writeFileSync(markerPath, new Date().toISOString())

    if (migrated === 0 && markerExists) {
      console.error('[migrate] Vault already contains all SQLite items')
    }
    console.error(`[migrate] Complete: ${migrated} items migrated, ${errors.length} errors`)
  } catch (err: any) {
    errors.push(`Migration failed: ${err.message}`)
    console.error('[migrate] Fatal error:', err)
  }

  return { migrated, errors }
}
