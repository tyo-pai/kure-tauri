import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ColorResult } from 'react-color'
import { GridColorPicker } from '../GridColorPicker/GridColorPicker'
import { normalizeHex } from '../../lib/colorMatch'
import { ALL_FOLDERS_KEY, ROOT_FOLDER_KEY, TYPE_FILTERS, TYPE_LABELS } from '../../lib/constants'
import type { Tag } from '../../types'
import './Toolbar.css'

const NAV_MENU_HOVER_SHOW_MS = 500
/** Gap under color trigger (was 10px; +4px per feedback) */
const COLOR_POPOVER_GAP_PX = 14
const COLOR_POPOVER_WIDTH_EST_PX = 240

function getColorPopoverPortalTarget(): HTMLElement {
  return document.getElementById('root') ?? document.body
}

interface ToolbarProps {
  activeView: 'browse' | 'settings'
  onSearch: (query: string) => void
  semanticMode: boolean
  colorFilter: string | null
  onColorFilterChange: (hex: string | null) => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
  activeType: string
  activeFolder: string
  activeTag: string | null
  folders: string[]
  tags: Tag[]
  typeCounts: Record<string, number>
  folderCounts: Record<string, number>
  onNavTypeChange: (filter: string) => void
  onNavFolderChange: (folder: string) => void
  onNavTagChange: (tag: string | null) => void
}

export function Toolbar({
  activeView,
  onSearch,
  semanticMode,
  colorFilter,
  onColorFilterChange,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  activeType,
  activeFolder,
  activeTag,
  folders,
  tags,
  typeCounts,
  folderCounts,
  onNavTypeChange,
  onNavFolderChange,
  onNavTagChange
}: ToolbarProps) {
  const [query, setQuery] = useState('')
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const colorWrapRef = useRef<HTMLDivElement>(null)
  const colorAnchorRef = useRef<HTMLDivElement>(null)
  const colorPopoverRef = useRef<HTMLDivElement>(null)
  const [colorPopoverPos, setColorPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const sidebarNavWrapRef = useRef<HTMLDivElement>(null)
  const navLeaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const navEnterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch(query)
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, onSearch])

  const colorPopoverRafRef = useRef(0)

  const updateColorPopoverPosition = useCallback(() => {
    const anchor = colorAnchorRef.current
    const pop = colorPopoverRef.current
    if (!anchor) return
    const tr = anchor.getBoundingClientRect()
    const w = pop?.getBoundingClientRect().width || COLOR_POPOVER_WIDTH_EST_PX
    setColorPopoverPos({
      top: tr.bottom + COLOR_POPOVER_GAP_PX,
      left: tr.right - w,
    })
  }, [])

  useLayoutEffect(() => {
    if (!colorPickerOpen) {
      setColorPopoverPos(null)
      return
    }
    updateColorPopoverPosition()
    colorPopoverRafRef.current = requestAnimationFrame(() => updateColorPopoverPosition())
    const pop = colorPopoverRef.current
    const ro = pop ? new ResizeObserver(() => updateColorPopoverPosition()) : null
    if (pop && ro) ro.observe(pop)
    window.addEventListener('resize', updateColorPopoverPosition)
    window.addEventListener('scroll', updateColorPopoverPosition, true)
    return () => {
      cancelAnimationFrame(colorPopoverRafRef.current)
      ro?.disconnect()
      window.removeEventListener('resize', updateColorPopoverPosition)
      window.removeEventListener('scroll', updateColorPopoverPosition, true)
    }
  }, [colorPickerOpen, updateColorPopoverPosition])

  useEffect(() => {
    if (!colorPickerOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (colorWrapRef.current?.contains(t)) return
      if (colorPopoverRef.current?.contains(t)) return
      setColorPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [colorPickerOpen])

  useEffect(() => {
    if (!colorPickerOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [colorPickerOpen])

  useEffect(() => {
    if (sidebarOpen) {
      if (navEnterTimer.current) {
        clearTimeout(navEnterTimer.current)
        navEnterTimer.current = undefined
      }
      setNavMenuOpen(false)
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (activeView !== 'settings') return
    setColorPickerOpen(false)
    setNavMenuOpen(false)
  }, [activeView])

  useEffect(() => {
    return () => {
      if (navEnterTimer.current) clearTimeout(navEnterTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!navMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (sidebarNavWrapRef.current?.contains(e.target as Node)) return
      setNavMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [navMenuOpen])

  const clearNavLeaveTimer = useCallback(() => {
    if (navLeaveTimer.current) clearTimeout(navLeaveTimer.current)
  }, [])

  const clearNavEnterTimer = useCallback(() => {
    if (navEnterTimer.current) {
      clearTimeout(navEnterTimer.current)
      navEnterTimer.current = undefined
    }
  }, [])

  const handleNavWrapEnter = useCallback(() => {
    if (sidebarOpen) return
    clearNavLeaveTimer()
    clearNavEnterTimer()
    navEnterTimer.current = setTimeout(() => {
      navEnterTimer.current = undefined
      setNavMenuOpen(true)
    }, NAV_MENU_HOVER_SHOW_MS)
  }, [sidebarOpen, clearNavLeaveTimer, clearNavEnterTimer])

  const handleNavWrapLeave = useCallback(() => {
    clearNavEnterTimer()
    navLeaveTimer.current = setTimeout(() => setNavMenuOpen(false), 180)
  }, [clearNavEnterTimer])

  const handleGridChange = (c: ColorResult) => {
    onColorFilterChange(normalizeHex(c.hex))
  }

  const pickFolder = (folder: string) => {
    onNavFolderChange(folder)
    onNavTypeChange('everything')
    onNavTagChange(null)
    setNavMenuOpen(false)
  }

  const pickType = (typeKey: string) => {
    onNavFolderChange(ALL_FOLDERS_KEY)
    onNavTypeChange(typeKey)
    onNavTagChange(null)
    setNavMenuOpen(false)
  }

  const pickTag = (name: string) => {
    onNavTagChange(name)
    setNavMenuOpen(false)
  }

  const openSettings = () => {
    onOpenSettings()
    setNavMenuOpen(false)
  }

  const clearSearch = () => {
    setQuery('')
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const sidebarToggle = (
    <div
      ref={sidebarNavWrapRef}
      className="toolbar-sidebar-wrap"
      onMouseEnter={handleNavWrapEnter}
      onMouseLeave={handleNavWrapLeave}
    >
      <button
        type="button"
        className="toolbar-sidebar-toggle"
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-haspopup={!sidebarOpen ? 'menu' : undefined}
      >
        <svg
          className="toolbar-sidebar-toggle-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {!sidebarOpen && navMenuOpen && (
        <div className="toolbar-sidebar-nav-menu" role="menu" aria-label="Navigate">
          <div className="toolbar-sidebar-nav-menu-inner scroll-area">
            <div className="toolbar-sidebar-nav-section">
              <div className="toolbar-sidebar-nav-label">places</div>
              <button
                type="button"
                role="menuitem"
                className={`toolbar-sidebar-nav-item${activeFolder === ROOT_FOLDER_KEY && activeType === 'everything' && !activeTag ? ' is-active' : ''}`}
                onClick={() => pickFolder(ROOT_FOLDER_KEY)}
              >
                <span>home</span>
                <span className="toolbar-sidebar-nav-count">{folderCounts[ROOT_FOLDER_KEY] || 0}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={`toolbar-sidebar-nav-item${activeFolder === ALL_FOLDERS_KEY && activeType === 'everything' && !activeTag ? ' is-active' : ''}`}
                onClick={() => pickFolder(ALL_FOLDERS_KEY)}
              >
                <span>everything</span>
                <span className="toolbar-sidebar-nav-count">{folderCounts[ALL_FOLDERS_KEY] || 0}</span>
              </button>
            </div>

            {folders.length > 0 && (
              <div className="toolbar-sidebar-nav-section">
                <div className="toolbar-sidebar-nav-label">folder</div>
                {folders.map((folderKey) => (
                  <button
                    key={folderKey}
                    type="button"
                    role="menuitem"
                    className={`toolbar-sidebar-nav-item${activeFolder === folderKey && activeType === 'everything' && !activeTag ? ' is-active' : ''}`}
                    onClick={() => pickFolder(folderKey)}
                  >
                    <span>{folderKey}</span>
                    <span className="toolbar-sidebar-nav-count">{folderCounts[folderKey] || 0}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="toolbar-sidebar-nav-section">
              <div className="toolbar-sidebar-nav-label">category</div>
              {TYPE_FILTERS.filter((typeKey) => typeKey !== 'everything').map((typeKey) => (
                <button
                  key={typeKey}
                  type="button"
                  role="menuitem"
                  className={`toolbar-sidebar-nav-item${activeType === typeKey && activeFolder === ALL_FOLDERS_KEY && !activeTag ? ' is-active' : ''}`}
                  onClick={() => pickType(typeKey)}
                >
                  <span>{TYPE_LABELS[typeKey]}</span>
                  <span className="toolbar-sidebar-nav-count">{typeCounts[typeKey] || 0}</span>
                </button>
              ))}
            </div>

            {tags.length > 0 && (
              <div className="toolbar-sidebar-nav-section">
                <div className="toolbar-sidebar-nav-label">tags</div>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    role="menuitem"
                    className={`toolbar-sidebar-nav-item${activeTag === tag.name ? ' is-active' : ''}`}
                    onClick={() => pickTag(tag.name)}
                  >
                    <span>{tag.name}</span>
                    {tag.count !== undefined && (
                      <span className="toolbar-sidebar-nav-count">{tag.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="toolbar-sidebar-nav-section">
              <div className="toolbar-sidebar-nav-label">app</div>
              <button
                type="button"
                role="menuitem"
                className={`toolbar-sidebar-nav-item${activeView === 'settings' ? ' is-active' : ''}`}
                onClick={openSettings}
              >
                <span>settings</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="toolbar" data-sidebar-open={sidebarOpen} data-tauri-drag-region>
      <div className="toolbar-drag-zone toolbar-drag-zone--left" data-tauri-drag-region aria-hidden />
      <div className="toolbar-drag-zone toolbar-drag-zone--right" data-tauri-drag-region aria-hidden />
      {createPortal(sidebarToggle, getColorPopoverPortalTarget())}

      {activeView !== 'settings' && (
        <div className="toolbar-search" ref={colorWrapRef}>
          <svg
            className="toolbar-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search everything…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query && (
            <button
              type="button"
              className="toolbar-search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
              title="Clear search"
            >
              <svg
                className="toolbar-search-clear-icon"
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden
              >
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          {semanticMode && (
            <span className="toolbar-semantic-badge">&#10022; smart search</span>
          )}

          <div className="toolbar-color">
            <div className="toolbar-color-trigger-shell" ref={colorAnchorRef}>
              <button
                type="button"
                className="toolbar-color-trigger"
                onClick={() => setColorPickerOpen((o) => !o)}
                title="Filter by color (matches extracted image colors)"
                aria-expanded={colorPickerOpen}
                aria-haspopup="dialog"
                aria-controls="toolbar-color-popover"
              >
                {colorFilter ? (
                  <span className="toolbar-color-swatch" style={{ background: colorFilter }} />
                ) : (
                  <svg
                    className="toolbar-color-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                  </svg>
                )}
              </button>
              {colorFilter && (
                <button
                  type="button"
                  className="toolbar-color-clear"
                  onClick={(e) => {
                    e.stopPropagation()
                    onColorFilterChange(null)
                  }}
                  aria-label="Clear color filter"
                >
                  <svg
                    className="toolbar-color-clear-icon"
                    width="6"
                    height="6"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden={true}
                  >
                    <path
                      d="M3 3l6 6M9 3l-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            {colorPickerOpen &&
              createPortal(
                <div
                  ref={colorPopoverRef}
                  id="toolbar-color-popover"
                  className="toolbar-color-popover toolbar-color-popover--portal"
                  role="dialog"
                  aria-label="Choose color"
                  style={
                    colorPopoverPos
                      ? { top: colorPopoverPos.top, left: colorPopoverPos.left }
                      : { visibility: 'hidden' as const }
                  }
                >
                  <GridColorPicker
                    color={colorFilter ?? '#b3b3b3'}
                    onChange={handleGridChange}
                  />
                </div>,
                getColorPopoverPortalTarget()
              )}
          </div>
        </div>
      )}
    </div>
  )
}
