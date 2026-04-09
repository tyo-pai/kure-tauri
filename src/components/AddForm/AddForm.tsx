import { useState, useCallback, useRef } from 'react'
import './AddForm.css'
import { MarkdownEditor } from '../MarkdownEditor/MarkdownEditor'
import type { ItemType, Tag } from '../../types'

interface AddFormProps {
  onClose: () => void
  onSave: (data: Record<string, unknown>, tagIds: string[]) => Promise<void>
  folders: string[]
  tags: Tag[]
  onCreateTag: (name: string) => Promise<Tag>
  initialTab?: ItemType
  initialFolder?: string | null
}

const TABS: { key: ItemType; label: string }[] = [
  { key: 'bookmark', label: 'bookmark' },
  { key: 'note', label: 'note' },
  { key: 'image', label: 'image' },
  { key: 'wishlist', label: 'wishlist' }
]

export function AddForm({ onClose, onSave, folders, tags, onCreateTag, initialTab, initialFolder }: AddFormProps) {
  const [activeTab, setActiveTab] = useState<ItemType>(initialTab || 'bookmark')
  const [folder, setFolder] = useState(initialFolder || '')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [price, setPrice] = useState('')
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetchedMeta, setFetchedMeta] = useState<Record<string, unknown> | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [expanded, setExpanded] = useState(false)
  /** URL string we last successfully fetched metadata for (avoids stale meta after edits) */
  const lastFetchedUrlRef = useRef<string | null>(null)

  const handleUrlBlur = useCallback(async () => {
    if (!url || (activeTab !== 'bookmark' && activeTab !== 'wishlist')) return
    const u = url.trim()
    try {
      setFetching(true)
      setFetchFailed(false)
      const meta = await window.desktopAPI.metadata.fetch(u)
      setFetchedMeta(meta)
      lastFetchedUrlRef.current = u
      if (!title && meta.title) setTitle(meta.title)
      if (!body && meta.description) setBody(meta.description)
      if (!price && meta.price) setPrice(meta.price)
    } catch {
      setFetchFailed(true)
    } finally {
      setFetching(false)
    }
  }, [url, title, body, price, activeTab])

  const handleImageSelect = useCallback(async () => {
    const folderPath = folder.trim() || null
    const filename = await window.desktopAPI.images.save('', folderPath)
    if (filename) {
      setFetchedMeta({ thumbnail: filename })
      if (!title) setTitle(filename.split('/').pop() || filename)
    }
  }, [folder, title])

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }, [])

  const handleAddNewTag = useCallback(async () => {
    const name = newTagName.trim().toLowerCase()
    if (!name) return
    const existing = tags.find((t) => t.name === name)
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) {
        setSelectedTagIds((prev) => [...prev, existing.id])
      }
    } else {
      const tag = await onCreateTag(name)
      setSelectedTagIds((prev) => [...prev, tag.id])
    }
    setNewTagName('')
  }, [newTagName, tags, selectedTagIds, onCreateTag])

  const handleSubmit = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const u = url.trim()
      let meta: Record<string, unknown> | null = fetchedMeta
      let outTitle = title.trim()
      let outBody = body
      let outPrice = price

      /*
       * Metadata only ran on URL blur. Clicking "save" blurs the field and starts fetch async,
       * but submit runs in the same turn before fetch completes — so meta was often null.
       * Ensure we await fetch on save when we don't have meta for this URL yet.
       */
      if ((activeTab === 'bookmark' || activeTab === 'wishlist') && u) {
        const needsFetch = !meta || lastFetchedUrlRef.current !== u
        if (needsFetch) {
          setFetching(true)
          setFetchFailed(false)
          try {
            meta = await window.desktopAPI.metadata.fetch(u)
            setFetchedMeta(meta)
            lastFetchedUrlRef.current = u
            if (!outTitle && meta.title) {
              outTitle = String(meta.title)
              setTitle(outTitle)
            }
            if (!outBody && meta.description) {
              outBody = String(meta.description)
              setBody(outBody)
            }
            if (activeTab === 'wishlist' && !outPrice && meta.price) {
              outPrice = String(meta.price)
              setPrice(outPrice)
            }
          } catch {
            setFetchFailed(true)
            meta = fetchedMeta
          } finally {
            setFetching(false)
          }
        }
      }

      const data: Record<string, unknown> = {
        type: activeTab,
        folder: folder.trim() || undefined,
        title: outTitle || 'untitled',
        url: url || undefined,
        description: outBody,
        body: outBody
      }

      if (activeTab === 'bookmark' || activeTab === 'wishlist') {
        const fm = meta as { image?: string; mediaUrl?: string; mediaItems?: unknown[] }
        data.thumbnail = fm?.image || undefined
        data.preview_video_url = fm?.mediaUrl || undefined
        if (fm?.mediaItems && fm.mediaItems.length > 0) {
          data.bookmark_media = fm.mediaItems
        }
        data.bookmark_author = (meta as { author?: string | null })?.author || undefined
        data.bookmark_post_text = (meta as { postText?: string | null })?.postText || undefined
        data.favicon_url = (meta as { favicon?: string })?.favicon || undefined
        data.store_name = (meta as { siteName?: string })?.siteName || undefined
      }

      if (activeTab === 'wishlist') {
        data.price = outPrice || undefined
      }

      if (activeTab === 'image') {
        data.thumbnail = (fetchedMeta as any)?.thumbnail || undefined
      }

      await onSave(data, selectedTagIds)
      onClose()
    } finally {
      setSaving(false)
    }
  }, [activeTab, folder, title, url, body, price, fetchedMeta, selectedTagIds, saving, onSave, onClose])

  const canSubmit =
    (activeTab === 'bookmark' && url) ||
    (activeTab === 'note' && (title || body)) ||
    (activeTab === 'image' && fetchedMeta?.thumbnail) ||
    (activeTab === 'wishlist' && url)

  const panelClass = `add-form-panel${expanded ? ' add-form-panel--expanded' : ''}`

  return (
    <>
      <div className="add-form-overlay" onClick={onClose} />
      {expanded && <div className="add-form-backdrop" onClick={() => setExpanded(false)} />}
      <div className={panelClass}>
      <div className="add-form-header">
        <div className="add-form-header-left">
          <button
            type="button"
            className="add-form-header-btn"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {expanded ? (
                <>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              )}
            </svg>
          </button>
          <span className="add-form-header-title">new item</span>
        </div>
        <button type="button" className="add-form-header-btn" onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="add-form-body scroll-area">
        <div className="add-form-tabs">
          {TABS.map((tab) => (
            <div
              key={tab.key}
              className={`add-form-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.key)
                setFetchedMeta(null)
                lastFetchedUrlRef.current = null
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {(activeTab === 'bookmark' || activeTab === 'wishlist') && (
          <>
            <div className="add-form-field">
              <label className="add-form-label">url</label>
              <input
                className="add-form-input"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                autoFocus
              />
              {fetching && <div className="add-form-fetching">fetching metadata...</div>}
              {fetchedMeta && !fetching && (
                <div className="add-form-fetched">
                  {fetchedMeta.title ? String(fetchedMeta.title) : 'metadata fetched'}
                </div>
              )}
            </div>
            {activeTab === 'wishlist' && (
              <div className="add-form-field">
                <label className="add-form-label">price</label>
                <input
                  className="add-form-input"
                  type="text"
                  placeholder="$0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            )}
            {fetchFailed && (
              <>
                <div className="add-form-field">
                  <label className="add-form-label">title</label>
                  <input
                    className="add-form-input"
                    type="text"
                    placeholder="page title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="add-form-field">
                  <label className="add-form-label">notes</label>
                  <textarea
                    className="add-form-textarea"
                    placeholder="add a description..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'note' && (
          <>
            <div className="add-form-field">
              <label className="add-form-label">title</label>
              <input
                className="add-form-input"
                type="text"
                placeholder="note title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="add-form-field">
              <label className="add-form-label">content</label>
              <MarkdownEditor
                value={body}
                onChange={setBody}
                placeholder="write something... (supports markdown)"
                minHeight={160}
                autoFocus={!!title}
              />
            </div>
          </>
        )}

        {activeTab === 'image' && (
          <>
            <div className="add-form-field">
              <button
                className="add-form-input"
                style={{ cursor: 'pointer', textAlign: 'left', color: 'var(--text-tertiary)' }}
                onClick={handleImageSelect}
              >
                {fetchedMeta?.thumbnail
                  ? `selected: ${fetchedMeta.thumbnail}`
                  : 'click to select an image...'}
              </button>
            </div>
            <div className="add-form-field">
              <label className="add-form-label">title</label>
              <input
                className="add-form-input"
                type="text"
                placeholder="image title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="add-form-field">
              <label className="add-form-label">description</label>
              <textarea
                className="add-form-textarea"
                placeholder="describe this image..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="add-form-field">
          <label className="add-form-label">folder</label>
          <input
            className="add-form-input"
            type="text"
            list="folder-options"
            placeholder="home"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <datalist id="folder-options">
            {folders.map((existingFolder) => (
              <option key={existingFolder} value={existingFolder} />
            ))}
          </datalist>
        </div>

        {/* Tag assignment */}
        <div className="add-form-field">
          <label className="add-form-label">tags</label>
          <div className="add-form-tags">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={`add-form-tag-chip ${selectedTagIds.includes(tag.id) ? 'active' : ''}`}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </button>
            ))}
            <div className="add-form-new-tag">
              <input
                className="add-form-tag-input"
                type="text"
                placeholder="+ new tag"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddNewTag()
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div className="add-form-actions">
          <button className="add-form-cancel" onClick={onClose}>
            cancel
          </button>
          <button
            className="add-form-submit"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
          >
            {saving ? 'saving...' : 'save'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
