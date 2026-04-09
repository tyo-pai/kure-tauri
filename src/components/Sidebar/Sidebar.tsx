import { useState, useEffect } from 'react'
import { Moon, Sun } from '@phosphor-icons/react'
import './Sidebar.css'
import { ALL_FOLDERS_KEY, ROOT_FOLDER_KEY, TYPE_FILTERS, TYPE_LABELS } from '../../lib/constants'
import type { Tag } from '../../types'

interface SidebarProps {
  activeView: 'browse' | 'settings'
  activeType: string
  activeFolder: string
  activeTag: string | null
  onOpenSettings: () => void
  onTypeChange: (filter: string) => void
  onFolderChange: (folder: string) => void
  onTagChange: (tag: string | null) => void
  typeCounts: Record<string, number>
  folderCounts: Record<string, number>
  folders: string[]
  onCreateFolder: (name: string) => Promise<void>
  onRenameFolder: (currentName: string, nextName: string) => Promise<string>
  onDeleteFolder: (name: string) => Promise<void>
  tags: Tag[]
}

export function Sidebar({
  activeView,
  activeType,
  activeFolder,
  activeTag,
  onOpenSettings,
  onTypeChange,
  onFolderChange,
  onTagChange,
  typeCounts,
  folderCounts,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  tags
}: SidebarProps) {
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [folderValue, setFolderValue] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [editingFolderValue, setEditingFolderValue] = useState('')
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<string | null>(null)
  const [folderActionBusy, setFolderActionBusy] = useState(false)
  const [folderActionError, setFolderActionError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('stash-theme') === 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('stash-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const handleCreateFolder = async () => {
    const name = folderValue.trim()
    if (!name || creatingFolder) return
    setCreatingFolder(true)
    setFolderActionError(null)
    try {
      await onCreateFolder(name)
      setShowFolderInput(false)
      setFolderValue('')
      setPendingDeleteFolder(null)
      onFolderChange(name)
      onTypeChange('everything')
      onTagChange(null)
    } catch (err) {
      setFolderActionError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  const clearPendingDeleteFolder = () => {
    if (!folderActionBusy) {
      setPendingDeleteFolder(null)
    }
  }

  const startRenameFolder = (name: string) => {
    setFolderActionError(null)
    setPendingDeleteFolder(null)
    setEditingFolder(name)
    setEditingFolderValue(name)
  }

  const cancelRenameFolder = () => {
    setEditingFolder(null)
    setEditingFolderValue('')
  }

  const handleRenameFolder = async (currentName: string) => {
    const nextName = editingFolderValue.trim()
    if (!nextName || folderActionBusy) {
      cancelRenameFolder()
      return
    }
    setFolderActionBusy(true)
    setFolderActionError(null)
    try {
      const renamed = await onRenameFolder(currentName, nextName)
      setEditingFolder(null)
      setEditingFolderValue('')
      setPendingDeleteFolder(null)
      onFolderChange(renamed)
      onTypeChange('everything')
      onTagChange(null)
    } catch (err) {
      setFolderActionError(err instanceof Error ? err.message : 'Failed to rename folder')
    } finally {
      setFolderActionBusy(false)
    }
  }

  const handleDeleteFolder = async (name: string) => {
    if (folderActionBusy) return
    setFolderActionBusy(true)
    setFolderActionError(null)
    try {
      await onDeleteFolder(name)
      setPendingDeleteFolder(null)
      if (activeFolder === name) {
        onFolderChange(ALL_FOLDERS_KEY)
        onTypeChange('everything')
        onTagChange(null)
      }
    } catch (err) {
      setFolderActionError(err instanceof Error ? err.message : 'Failed to remove folder')
    } finally {
      setFolderActionBusy(false)
    }
  }

  return (
    <div className="sidebar" data-tauri-drag-region>
      <div className="sidebar-wordmark">stash</div>

      <div
        className={`sidebar-item ${activeFolder === ROOT_FOLDER_KEY && activeType === 'everything' && !activeTag ? 'active' : ''}`}
        onClick={() => {
          clearPendingDeleteFolder()
          onFolderChange(ROOT_FOLDER_KEY)
          onTypeChange('everything')
          onTagChange(null)
        }}
      >
        <span>home</span>
        <span className="sidebar-item-count">{folderCounts[ROOT_FOLDER_KEY] || 0}</span>
      </div>

      <div
        className={`sidebar-item ${activeFolder === ALL_FOLDERS_KEY && activeType === 'everything' && !activeTag ? 'active' : ''}`}
        onClick={() => {
          clearPendingDeleteFolder()
          onFolderChange(ALL_FOLDERS_KEY)
          onTypeChange('everything')
          onTagChange(null)
        }}
      >
        <span>everything</span>
        <span className="sidebar-item-count">{folderCounts[ALL_FOLDERS_KEY] || 0}</span>
      </div>

      <div className="sidebar-divider" />
      <div className="sidebar-section-label">folder</div>
      {folders.map((folderKey) => {
        const count = folderCounts[folderKey] || 0
        const isEditing = editingFolder === folderKey
        const isPendingDelete = pendingDeleteFolder === folderKey
        return (
          <div
            key={folderKey}
            className={`sidebar-item ${activeFolder === folderKey && activeType === 'everything' && !activeTag ? 'active' : ''}`}
            onClick={() => {
              if (isEditing) return
              clearPendingDeleteFolder()
              onFolderChange(folderKey)
              onTypeChange('everything')
              onTagChange(null)
            }}
            onDoubleClick={() => startRenameFolder(folderKey)}
            onMouseLeave={() => {
              if (pendingDeleteFolder === folderKey) {
                clearPendingDeleteFolder()
              }
            }}
          >
            {isEditing ? (
              <input
                className="sidebar-folder-inline-input"
                type="text"
                value={editingFolderValue}
                onChange={(e) => setEditingFolderValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => handleRenameFolder(folderKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFolder(folderKey)
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRenameFolder()
                  }
                }}
                autoFocus
              />
            ) : (
              <>
                <span>{folderKey}</span>
                <span className="sidebar-folder-actions">
                  {isPendingDelete ? (
                    <button
                      type="button"
                      className="sidebar-folder-delete-confirm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteFolder(folderKey)
                      }}
                    >
                      remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sidebar-folder-delete"
                      aria-label={`Remove ${folderKey} folder`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFolderActionError(null)
                        setEditingFolder(null)
                        setPendingDeleteFolder(folderKey)
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3.5 4.5H12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        <path d="M6.5 2.75H9.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        <path d="M5 4.5V11.25C5 12.2165 5.7835 13 6.75 13H9.25C10.2165 13 11 12.2165 11 11.25V4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </span>
              </>
            )}
            <span className="sidebar-item-count">{count}</span>
          </div>
        )
      })}
      {!showFolderInput ? (
        <button
          type="button"
          className="sidebar-item sidebar-item--action sidebar-folder-add"
          onClick={() => {
            clearPendingDeleteFolder()
            setShowFolderInput(true)
          }}
        >
          <span className="sidebar-folder-add-content">
            <span className="sidebar-folder-add-icon" aria-hidden="true">
              +
            </span>
            <span>add folder</span>
          </span>
        </button>
      ) : (
        <div className="sidebar-folder-create">
          <input
            className="sidebar-folder-input"
            type="text"
            placeholder="new folder"
            value={folderValue}
            onChange={(e) => setFolderValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') {
                setShowFolderInput(false)
                setFolderValue('')
              }
            }}
            autoFocus
          />
        </div>
      )}
      {folderActionError && <div className="sidebar-folder-error">{folderActionError}</div>}

      <div className="sidebar-divider" />
      <div className="sidebar-section-label">category</div>
      {TYPE_FILTERS.filter((typeKey) => typeKey !== 'everything').map((typeKey) => (
        <div
          key={typeKey}
          className={`sidebar-item ${activeType === typeKey && activeFolder === ALL_FOLDERS_KEY && !activeTag ? 'active' : ''}`}
          onClick={() => {
            clearPendingDeleteFolder()
            onFolderChange(ALL_FOLDERS_KEY)
            onTypeChange(typeKey)
            onTagChange(null)
          }}
        >
          <span>{TYPE_LABELS[typeKey]}</span>
          <span className="sidebar-item-count">{typeCounts[typeKey] || 0}</span>
        </div>
      ))}

      {tags.length > 0 && (
        <div className="sidebar-tags">
          <div className="sidebar-divider" />
          <div className="sidebar-section-label">tags</div>
          <div className="sidebar-tags-scroll scroll-area">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`sidebar-item ${activeTag === tag.name ? 'active' : ''}`}
                onClick={() => {
                  clearPendingDeleteFolder()
                  onTagChange(tag.name)
                }}
              >
                <span>{tag.name}</span>
                {tag.count !== undefined && (
                  <span className="sidebar-item-count">{tag.count}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-bottom">
        <div className="sidebar-footer-actions">
          <button
            type="button"
            className={`sidebar-settings-link${activeView === 'settings' ? ' is-active' : ''}`}
            onClick={() => {
              clearPendingDeleteFolder()
              onOpenSettings()
            }}
          >
            settings
          </button>

          <button
            type="button"
            className="sidebar-theme-toggle"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => {
              clearPendingDeleteFolder()
              setDarkMode(!darkMode)
            }}
          >
            {darkMode ? (
              <Sun className="sidebar-theme-toggle-icon" size={16} weight="regular" aria-hidden="true" />
            ) : (
              <Moon className="sidebar-theme-toggle-icon" size={16} weight="regular" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
