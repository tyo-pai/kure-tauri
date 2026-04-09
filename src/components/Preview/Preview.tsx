import { useState, useCallback, useEffect, useMemo } from 'react'
import './Preview.css'
import { TagChip } from '../common/TagChip'
import { MarkdownEditor, MarkdownRenderer } from '../MarkdownEditor/MarkdownEditor'
import {
  displayStillUrl,
  itemHasRemoteBookmarkAssets,
  normalizeBookmarkMedia
} from '../../lib/bookmarkMedia'
import type { BookmarkMediaItem, Item, Tag, ItemStatus } from '../../types'

function itemToMarkdown(item: Item): string {
  const lines: string[] = []
  lines.push(`# ${item.title}`)
  lines.push('')
  if (item.url) lines.push(`**Source:** ${item.url}`)
  if (item.type) lines.push(`**Type:** ${item.type}`)
  if (item.price) lines.push(`**Price:** ${item.price}`)
  if (item.store_name) lines.push(`**Store:** ${item.store_name}`)
  if (item.tags?.length) lines.push(`**Tags:** ${item.tags.map(t => t.name).join(', ')}`)
  lines.push(`**Saved:** ${item.created_at}`)
  lines.push('')
  const content = item.body || item.description
  if (content) lines.push(content)
  if (item.ai_summary) {
    lines.push('')
    lines.push('## AI Summary')
    lines.push(item.ai_summary)
  }
  if (item.ocr_text) {
    lines.push('')
    lines.push('## Extracted Text')
    lines.push(item.ocr_text)
  }
  return lines.join('\n')
}

interface PreviewProps {
  item: Item | null
  folders: string[]
  tags: Tag[]
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>
  onAddTag: (itemId: string, tagId: string) => Promise<void>
  onRemoveTag: (itemId: string, tagId: string) => Promise<void>
  onCreateTag: (name: string) => Promise<Tag>
  onRefresh?: () => void
  expanded?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
  bookmarkAttachmentIndex: number
  onBookmarkAttachmentChange: (index: number) => void
  /** True while this item’s media is being saved to the vault (background download). */
  bookmarkMediaDownloading?: boolean
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${h}:${m}`
}

function getDomain(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return ''
  }
}

const STATUS_OPTIONS: { key: ItemStatus; label: string }[] = [
  { key: 'unread', label: 'unread' },
  { key: 'favorite', label: 'favorite' },
  { key: 'archived', label: 'archived' }
]

export function Preview({
  item,
  folders,
  tags,
  onDelete,
  onUpdate,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onRefresh,
  expanded,
  onExpand,
  onCollapse,
  onClose,
  onPrev,
  onNext,
  bookmarkAttachmentIndex,
  onBookmarkAttachmentChange,
  bookmarkMediaDownloading
}: PreviewProps) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [moveFolder, setMoveFolder] = useState('')
  const [showMoveFolder, setShowMoveFolder] = useState(false)
  const [movingFolder, setMovingFolder] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [readMode, setReadMode] = useState(false)

  const bookmarkMedia: BookmarkMediaItem[] = useMemo(() => {
    if (!item || (item.type !== 'bookmark' && item.type !== 'wishlist')) return []
    return normalizeBookmarkMedia(item)
  }, [item])

  useEffect(() => {
    if (bookmarkMedia.length > 0 && bookmarkAttachmentIndex >= bookmarkMedia.length) {
      onBookmarkAttachmentChange(0)
    }
  }, [bookmarkMedia.length, bookmarkAttachmentIndex, onBookmarkAttachmentChange])

  const startEditing = useCallback(() => {
    if (!item) return
    setEditTitle(item.title)
    setEditBody(item.body || item.description)
    setEditPrice(item.price || '')
    setEditing(true)
  }, [item])

  const saveEdit = useCallback(async () => {
    if (!item) return
    await onUpdate(item.id, {
      title: editTitle,
      body: editBody,
      description: editBody,
      ...(item.type === 'wishlist' ? { price: editPrice } : {})
    })
    setEditing(false)
  }, [item, editTitle, editBody, editPrice, onUpdate])

  const handleStatusChange = useCallback(async (status: ItemStatus) => {
    if (!item) return
    await onUpdate(item.id, { status })
  }, [item, onUpdate])

  const handleAddTag = useCallback(async () => {
    if (!item || !newTagInput.trim()) return
    const name = newTagInput.trim().toLowerCase()
    const existing = tags.find((t) => t.name === name)
    if (existing) {
      await onAddTag(item.id, existing.id)
    } else {
      const tag = await onCreateTag(name)
      await onAddTag(item.id, tag.id)
    }
    setNewTagInput('')
    setShowTagPicker(false)
  }, [item, newTagInput, tags, onAddTag, onCreateTag])

  const handlePickTag = useCallback(async (tagId: string) => {
    if (!item) return
    await onAddTag(item.id, tagId)
    setShowTagPicker(false)
  }, [item, onAddTag])

  const handleSummarize = useCallback(async () => {
    if (!item) return
    setSummarizing(true)
    try {
      await window.desktopAPI.ai.summarize(item.id)
      onRefresh?.()
    } catch { /* silent */ }
    setSummarizing(false)
  }, [item, onRefresh])

  const handleEnrich = useCallback(async () => {
    if (!item) return
    setEnriching(true)
    try {
      await window.desktopAPI.ai.enrichItem(item.id)
      onRefresh?.()
    } catch { /* silent */ }
    setEnriching(false)
  }, [item, onRefresh])

  const handleCopy = useCallback(async () => {
    if (!item) return
    try {
      await navigator.clipboard.writeText(itemToMarkdown(item))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // silent
    }
  }, [item])

  const handleMoveToFolder = useCallback(async () => {
    if (!item || movingFolder) return
    setMovingFolder(true)
    try {
      await onUpdate(item.id, { folder: moveFolder.trim() || null })
      setShowMoveFolder(false)
    } finally {
      setMovingFolder(false)
    }
  }, [item, moveFolder, movingFolder, onUpdate])

  const openSourceUrl = useCallback(async (url: string) => {
    try {
      await window.desktopAPI.system.openUrl(url)
    } catch (err) {
      console.error('Failed to open external url:', err)
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  // Reset read mode when switching items
  useEffect(() => {
    setReadMode(false)
    setEditing(false)
    setCopied(false)
    setShowMoveFolder(false)
    setMoveFolder(item?.folder_path || '')
  }, [item?.id])

  // Arrow key navigation between cards
  useEffect(() => {
    if (!item || editing) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev?.()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [item, editing, onPrev, onNext])

  const isOpen = !!item

  const content = item ? (item.body || item.description) : ''
  const itemTagIds = item ? (item.tags || []).map((t) => t.id) : []
  const availableTags = tags.filter((t) => !itemTagIds.includes(t.id))
  const shouldShowSummarize = item?.type === 'note'
  const shouldShowEnrich = !!item && (
    ((item.tags?.length || 0) === 0) ||
    !item.ai_description?.trim() ||
    (item.type === 'image' && !item.ocr_text?.trim())
  )

  const panelClass = `preview${isOpen ? ' preview--open' : ''}${expanded ? ' preview--expanded' : ''}`

  const renderMeta = (inline: boolean) => {
    if (!item) return null
    return (
      <div className={`preview-meta${inline ? ' preview-meta--inline' : ''}`}>
        <div className="preview-meta-row">
          <span className="preview-meta-key">status</span>
          <div className="preview-status-flags">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`preview-status-btn ${item.status === opt.key ? 'active' : ''}`}
                onClick={() => handleStatusChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="preview-meta-row">
          <span className="preview-meta-key">type</span>
          <span className="preview-meta-value">{item.type}</span>
        </div>

        <div className="preview-meta-row">
          <span className="preview-meta-key">folder</span>
          <div className="preview-meta-value preview-folder-value">
            <span>{item.folder_path || 'home'}</span>
            {showMoveFolder && (
              <div className="preview-folder-editor">
                <input
                  className="preview-folder-input"
                  type="text"
                  list="preview-folder-options"
                  placeholder="home"
                  value={moveFolder}
                  onChange={(e) => setMoveFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleMoveToFolder()
                    if (e.key === 'Escape') {
                      setShowMoveFolder(false)
                      setMoveFolder(item.folder_path || '')
                    }
                  }}
                />
                <datalist id="preview-folder-options">
                  {folders.map((folder) => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
                <button className="preview-inline-btn" onClick={handleMoveToFolder} disabled={movingFolder}>
                  {movingFolder ? 'moving...' : 'save'}
                </button>
                <button
                  className="preview-inline-btn"
                  onClick={() => {
                    setShowMoveFolder(false)
                    setMoveFolder(item.folder_path || '')
                  }}
                  disabled={movingFolder}
                >
                  cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {item.url && (
          <div className="preview-meta-row">
            <span className="preview-meta-key">source</span>
            <span className="preview-meta-value">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  void openSourceUrl(item.url)
                }}
              >
                {getDomain(item.url)}
              </a>
            </span>
          </div>
        )}

        {item.price && (
          <div className="preview-meta-row">
            <span className="preview-meta-key">price</span>
            <span className="preview-meta-value">{item.price}</span>
          </div>
        )}

        {item.store_name && (
          <div className="preview-meta-row">
            <span className="preview-meta-key">store</span>
            <span className="preview-meta-value">{item.store_name}</span>
          </div>
        )}

        <div className="preview-meta-row">
          <span className="preview-meta-key">tags</span>
          <div className="preview-meta-tags">
            {(item.tags || []).map((tag) => (
              <TagChip
                key={tag.id}
                label={tag.name}
                onRemove={() => onRemoveTag(item.id, tag.id)}
              />
            ))}
            {!showTagPicker ? (
              <button className="preview-add-tag-btn" onClick={() => setShowTagPicker(true)}>+</button>
            ) : (
              <div className="preview-tag-picker">
                {availableTags.map((tag) => (
                  <button key={tag.id} className="preview-tag-option" onClick={() => handlePickTag(tag.id)}>
                    {tag.name}
                  </button>
                ))}
                <input
                  className="preview-tag-input"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTag()
                    if (e.key === 'Escape') setShowTagPicker(false)
                  }}
                  placeholder="new tag..."
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>

        {item.colors && item.colors.length > 0 && (
          <div className="preview-meta-row">
            <span className="preview-meta-key">colors</span>
            <div className="preview-color-swatches">
              {item.colors.map((color, i) => (
                <div
                  key={i}
                  className="preview-color-swatch"
                  style={{ background: color.hex }}
                  title={`${color.name} ${color.hex}`}
                />
              ))}
            </div>
          </div>
        )}

        {item.ai_description && (
          <div className="preview-meta-row">
            <span className="preview-meta-key">desc</span>
            <span className="preview-meta-value">{item.ai_description}</span>
          </div>
        )}

        <div className="preview-meta-row">
          <span className="preview-meta-key">saved</span>
          <span className="preview-meta-value">{formatDateTime(item.created_at)}</span>
        </div>

        <div className="preview-action-row">
          {!editing && (
            <button className="preview-action-btn" onClick={startEditing}>edit</button>
          )}
          {item.url && (
            <button className="preview-action-btn" onClick={() => void openSourceUrl(item.url)}>
              source
            </button>
          )}
          {shouldShowSummarize && (
            <button
              className={`preview-action-btn ${summarizing ? 'disabled' : ''}`}
              onClick={!summarizing ? handleSummarize : undefined}
              disabled={summarizing}
            >
              {summarizing ? 'summarizing...' : 'summarize'}
            </button>
          )}
          {shouldShowEnrich && (
            <button
              className={`preview-action-btn ${enriching ? 'disabled' : ''}`}
              onClick={!enriching ? handleEnrich : undefined}
              disabled={enriching}
            >
              {enriching ? 'enriching...' : 'enrich'}
            </button>
          )}
          <button
            className="preview-action-btn"
            onClick={() => {
              setShowMoveFolder((prev) => !prev)
              setMoveFolder(item.folder_path || '')
            }}
          >
            move folder
          </button>
          <button className="preview-action-btn" onClick={handleCopy}>{copied ? 'copied' : 'copy'}</button>
          <button className="preview-action-btn preview-action-btn--delete" onClick={() => onDelete(item.id)}>delete</button>
        </div>
      </div>
    )
  }

  return (
    <>
      {expanded && <div className="preview-backdrop" onClick={onCollapse} />}
      <div className={panelClass}>
      {!item ? <div className="preview-empty" /> : (
      <>
      <div className="preview-header">
        <div className="preview-header-left">
          {item.type === 'note' && (
            <button className="preview-header-btn" onClick={expanded ? onCollapse : onExpand} title={expanded ? 'Collapse' : 'Expand'}>
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
          )}
          <span className="preview-header-date">{formatDateTime(item.created_at)}</span>
          {(item.type === 'bookmark' || item.type === 'wishlist') && itemHasRemoteBookmarkAssets(item) && (
            <button
              type="button"
              className="preview-header-btn preview-header-cloud"
              disabled={bookmarkMediaDownloading}
              title={bookmarkMediaDownloading ? 'Saving media…' : 'Save media to vault (offline)'}
              onClick={() => void window.desktopAPI.bookmarkMedia.persist(item.id)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
            </button>
          )}
        </div>
        <button className="preview-header-btn" onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {readMode ? (
        <div className="preview-read-mode scroll-area">
          <button className="preview-read-close" onClick={() => setReadMode(false)}>close reader</button>
          {item.title && <div className="preview-read-title">{item.title}</div>}
          {item.url && <div className="preview-read-source">{getDomain(item.url)}</div>}
          {content && (item.type === 'note' ? (
            <MarkdownRenderer content={content} className="preview-read-body" />
          ) : (
            <div className="preview-read-body">{content}</div>
          ))}
          {item.ai_summary && (
            <div className="preview-read-summary">
              <div className="preview-ai-label">ai summary</div>
              <div className="preview-read-body">{item.ai_summary}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="preview-content scroll-area">
            {bookmarkMedia.length > 1 && item && (
              <div
                className="preview-media-strip"
                role="list"
                aria-label="Saved media"
              >
                <div className="preview-media-strip-scroll">
                  {bookmarkMedia.map((m, i) => {
                    const still = displayStillUrl(item, { kind: 'image', url: m.url })
                    const active = i === bookmarkAttachmentIndex
                    return (
                      <button
                        key={`${m.url}-${i}`}
                        type="button"
                        role="listitem"
                        className={`preview-media-strip-thumb${m.kind === 'video' ? ' preview-media-strip-thumb--video' : ''}${active ? ' is-active' : ''}`}
                        onClick={() => onBookmarkAttachmentChange(i)}
                        title={m.kind === 'video' ? 'Video' : 'Image'}
                      >
                        {still ? (
                          <img src={still} alt="" draggable={false} />
                        ) : (
                          <div className="preview-media-strip-fallback">{i + 1}</div>
                        )}
                        {m.kind === 'video' && (
                          <span className="preview-media-strip-play" aria-hidden />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {editing ? (
              <div className="preview-edit-form">
                <input
                  className="preview-edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="title"
                  autoFocus
                />
                {item.type === 'note' ? (
                  <MarkdownEditor
                    value={editBody}
                    onChange={setEditBody}
                    placeholder="write something... (supports markdown)"
                    minHeight={200}
                  />
                ) : (
                  <textarea
                    className="preview-edit-body"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="content..."
                  />
                )}
                {item.type === 'wishlist' && (
                  <input
                    className="preview-edit-price"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="$0.00"
                  />
                )}
                <div className="preview-edit-actions">
                  <button className="preview-edit-cancel" onClick={() => setEditing(false)}>cancel</button>
                  <button className="preview-edit-save" onClick={saveEdit}>save</button>
                </div>
              </div>
            ) : (
              <>
                {item.title && <div className="preview-title">{item.title}</div>}
                {content && (item.type === 'note' ? (
                  <MarkdownRenderer content={content} className="preview-body" />
                ) : (
                  <div className="preview-body">{content}</div>
                ))}
              </>
            )}

            {item.ai_summary && (
              <div className="preview-ai-section">
                <div className="preview-ai-label">ai summary</div>
                <div className="preview-ai-text">{item.ai_summary}</div>
              </div>
            )}

            {item.ocr_text && (
              <div className="preview-ai-section">
                <div className="preview-ai-label">extracted text</div>
                <div className="preview-ai-text">{item.ocr_text}</div>
              </div>
            )}

            {item.type !== 'note' && renderMeta(true)}
          </div>

          {item.type === 'note' && renderMeta(false)}

      <div className="preview-footer">
        {item.url && (
          <div className="preview-footer-btn" onClick={() => void openSourceUrl(item.url)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>source</span>
          </div>
        )}
        {item.type === 'note' && (
          <div className="preview-footer-btn" onClick={() => setReadMode(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>read</span>
          </div>
        )}
        <div className="preview-footer-btn" onClick={handleCopy}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{copied ? 'copied' : 'copy'}</span>
        </div>
      </div>
        </>
      )}
      </>
      )}
    </div>
    </>
  )
}
