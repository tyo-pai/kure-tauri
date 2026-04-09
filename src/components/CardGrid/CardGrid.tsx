import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Card } from './Card'
import type { LightboxData } from './Card'
import './CardGrid.css'
import { getItemAssetUrl } from '../../lib/assets'
import {
  animateLightboxFrame,
  computeLightboxGeometry,
  getLiveLightboxSourceRect,
  lightboxPanelReserveWidth,
  setLightboxSourceHidden
} from '../../lib/lightboxMotion'
import {
  displayStillUrl,
  displayUrlForBookmarkMedia,
  lightboxKindForMedia,
  normalizeBookmarkMedia
} from '../../lib/bookmarkMedia'
import { waitForVideoFirstFrame } from '../../utils/videoFrame'
import { videoDebugHandlers } from '../../utils/videoDebug'
import type { EnrichmentStage, Item } from '../../types'

interface CardGridProps {
  items: Item[]
  selectedId: string | null
  onSelect: (item: Item) => void
  loading: boolean
  viewMode: 'grid' | 'list'
  onDrop: (files: File[]) => void
  onLightboxChange?: (open: boolean) => void
  dismissLightbox?: boolean
  enrichingIds?: Set<string>
  enrichmentStages?: Record<string, EnrichmentStage>
  newCardIds?: Set<string>
  /** Matches detail panel width so lightbox image + filmstrip clear the fixed preview column */
  previewExpanded?: boolean
  /** Shared with preview panel — which bookmark attachment is shown in lightbox */
  bookmarkAttachmentIndex: number
  onBookmarkAttachmentChange: (index: number) => void
}

const GRID_CELL_WIDTH_PX = 320
const GRID_CELL_HEIGHT_PX = 420
const GRID_COLUMN_GAP_PX = 24
const GRID_ROW_GAP_PX = 36
const GRID_HORIZONTAL_PADDING_PX = 24
const GRID_OVERSCAN_PX = GRID_CELL_HEIGHT_PX + GRID_ROW_GAP_PX
const LIGHTBOX_FILMSTRIP_MEDIA_WIDTH_PX = 160

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getSourceElementItemId(element: HTMLElement | null | undefined): string | null {
  return element?.dataset.lightboxSourceId || null
}

interface VirtualGridRowProps {
  top: number
  rowIndex: number
  columnCount: number
  items: Item[]
  selectedId: string | null
  enrichingIds?: Set<string>
  enrichmentStages?: Record<string, EnrichmentStage>
  newCardIds?: Set<string>
  onSelect: (item: Item) => void
  onEnlarge: (data: LightboxData) => void
}

function chunkItems(items: Item[], chunkSize: number) {
  const rows: Item[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    rows.push(items.slice(index, index + chunkSize))
  }
  return rows
}

const VirtualGridRow = memo(function VirtualGridRow({
  top,
  rowIndex,
  columnCount,
  items,
  selectedId,
  enrichingIds,
  enrichmentStages,
  newCardIds,
  onSelect,
  onEnlarge
}: VirtualGridRowProps) {
  return (
    <div
      className="card-grid-row"
      style={{
        top,
        height: GRID_CELL_HEIGHT_PX,
        gridTemplateColumns: `repeat(${columnCount}, ${GRID_CELL_WIDTH_PX}px)`
      }}
    >
      {items.map((item, itemIndex) => (
        <div
          key={item.id}
          className="card-grid-cell card-grid-cell--enter"
          style={{
            animationDelay: `${Math.min(rowIndex * 24 + itemIndex * 18, 180)}ms`
          }}
        >
          <Card
            item={item}
            selected={item.id === selectedId}
            enriching={enrichingIds?.has(item.id) || false}
            enrichmentStage={enrichmentStages?.[item.id]}
            isNew={newCardIds?.has(item.id) || false}
            onSelect={onSelect}
            onEnlarge={onEnlarge}
            viewMode="grid"
          />
        </div>
      ))}
    </div>
  )
})

export function CardGrid({
  items,
  selectedId,
  onSelect,
  loading,
  viewMode,
  onDrop,
  onLightboxChange,
  dismissLightbox,
  enrichingIds,
  enrichmentStages,
  newCardIds,
  previewExpanded = false,
  bookmarkAttachmentIndex,
  onBookmarkAttachmentChange
}: CardGridProps) {
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxData | null>(null)
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing' | null>(null)
  const [lightboxVideoReady, setLightboxVideoReady] = useState(false)
  const [lightboxVideoPlaybackArmed, setLightboxVideoPlaybackArmed] = useState(false)
  const [lightboxVideoControlsVisible, setLightboxVideoControlsVisible] = useState(false)
  const [lightboxIntrinsicRect, setLightboxIntrinsicRect] = useState<DOMRect | null>(null)
  const [lightboxIntrinsicRectKey, setLightboxIntrinsicRectKey] = useState<string | null>(null)
  const [filmstripEntered, setFilmstripEntered] = useState(false)
  const lightboxMediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null)
  const lightboxFrameRef = useRef<HTMLDivElement>(null)
  const lightboxPanelWidth = useRef(0)
  const lightboxAnimationRef = useRef<ReturnType<typeof animateLightboxFrame> | null>(null)
  const lightboxVideoRevealCleanupRef = useRef<(() => void) | null>(null)
  const lightboxVideoPlaybackTimerRef = useRef<number | null>(null)
  const hiddenSourceRef = useRef<HTMLElement | null>(null)
  const navigatingRef = useRef(false)
  const filmstripActiveRef = useRef<HTMLButtonElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const [, forceUpdate] = useState(0)
  const [gridMetrics, setGridMetrics] = useState({
    width: 0,
    height: 0,
    scrollTop: 0
  })
  const handleSelect = useCallback((item: Item) => {
    onSelect(item)
  }, [onSelect])

  const stopLightboxAnimation = useCallback(() => {
    lightboxAnimationRef.current?.stop?.()
    lightboxAnimationRef.current = null
  }, [])

  const restoreSourceVisibility = useCallback(() => {
    setLightboxSourceHidden(hiddenSourceRef.current, false)
    hiddenSourceRef.current = null
  }, [])

  const resolveCurrentLightboxSource = useCallback(() => {
    const sourceItemId = lightbox?.sourceItemId ?? selectedId
    if (!sourceItemId) return hiddenSourceRef.current
    const scope = scrollRef.current
    if (!scope) return hiddenSourceRef.current

    const selector = `[data-lightbox-source-id="${escapeAttributeValue(sourceItemId)}"]`
    const candidate = scope.querySelector(selector)
    return candidate instanceof HTMLElement ? candidate : hiddenSourceRef.current
  }, [lightbox?.sourceItemId, selectedId])

  const finalizeLightboxClose = useCallback(() => {
    stopLightboxAnimation()
    restoreSourceVisibility()
    setLightbox(null)
    setPhase(null)
  }, [restoreSourceVisibility, stopLightboxAnimation])

  const cancelLightboxVideoReveal = useCallback(() => {
    lightboxVideoRevealCleanupRef.current?.()
    lightboxVideoRevealCleanupRef.current = null
  }, [])

  const cancelLightboxVideoPlaybackArm = useCallback(() => {
    if (lightboxVideoPlaybackTimerRef.current !== null) {
      window.clearTimeout(lightboxVideoPlaybackTimerRef.current)
      lightboxVideoPlaybackTimerRef.current = null
    }
  }, [])

  const handleEnlarge = useCallback((data: LightboxData) => {
    stopLightboxAnimation()
    restoreSourceVisibility()
    lightboxPanelWidth.current = lightboxPanelReserveWidth(previewExpanded)
    setLightbox(data)
    setPhase('opening')
    onLightboxChange?.(true)
  }, [onLightboxChange, previewExpanded, restoreSourceVisibility, stopLightboxAnimation])

  const handleDismiss = useCallback(() => {
    if (!lightbox || phase === 'closing') return
    stopLightboxAnimation()
    setPhase('closing')
    onLightboxChange?.(false)
  }, [lightbox, onLightboxChange, phase, stopLightboxAnimation])

  // Dismiss lightbox when parent requests it
  useEffect(() => {
    if (dismissLightbox && lightbox && phase !== 'closing') {
      handleDismiss()
    }
  }, [dismissLightbox, handleDismiss, lightbox, phase])

  // Reposition lightbox when preview expands/collapses (panel reserve width changes)
  useEffect(() => {
    if (!lightbox || phase !== 'open') return
    lightboxPanelWidth.current = lightboxPanelReserveWidth(previewExpanded)
    forceUpdate((n) => n + 1)
  }, [previewExpanded, lightbox, phase])

  // Scroll active filmstrip thumb into view when selection changes
  useEffect(() => {
    if (!lightbox || !selectedId || items.length < 2) return
    filmstripActiveRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth'
    })
  }, [selectedId, lightbox, items.length])

  // Filmstrip: keep lightbox media in sync when selection changes (bookmarks use gallery; images use src)
  useEffect(() => {
    if (!lightbox || !selectedId || phase !== 'open') return
    const selectedItem = items.find((i) => i.id === selectedId)
    if (!selectedItem?.thumbnail) return

    const isBookmarkLike = selectedItem.type === 'bookmark' || selectedItem.type === 'wishlist'
    const isImageType = selectedItem.type === 'image'

    if (isBookmarkLike) {
      if (lightbox.itemId === selectedId) return
      navigatingRef.current = true
      setLightbox((prev) =>
        prev
          ? {
              rect: prev.rect,
              element: prev.element,
              sourceItemId: selectedId,
              itemId: selectedId,
              src: undefined,
              kind: undefined
            }
          : prev
      )
      return
    }

    if (isImageType) {
      const newSrc = getItemAssetUrl(selectedItem) || ''
      if (!lightbox.itemId && lightbox.src === newSrc) return
      navigatingRef.current = true
      setLightbox((prev) =>
        prev
          ? {
              rect: prev.rect,
              element: prev.element,
              sourceItemId: selectedId,
              src: newSrc,
              kind: 'image',
              itemId: undefined
            }
          : prev
      )
    }
  }, [selectedId, items, lightbox, phase])

  useEffect(() => {
    cancelLightboxVideoReveal()
    cancelLightboxVideoPlaybackArm()
    setLightboxVideoReady(false)
    setLightboxVideoPlaybackArmed(false)
  }, [cancelLightboxVideoPlaybackArm, cancelLightboxVideoReveal, lightbox?.itemId, lightbox?.src, lightbox?.kind])

  useEffect(() => {
    setLightboxVideoControlsVisible(false)
  }, [lightbox?.itemId, lightbox?.src, phase])

  useEffect(() => {
    return () => {
      cancelLightboxVideoPlaybackArm()
      cancelLightboxVideoReveal()
    }
  }, [cancelLightboxVideoPlaybackArm, cancelLightboxVideoReveal])

  // `[` / `]` cycle attachments (same index as preview filmstrip)
  useEffect(() => {
    if (!lightbox?.itemId) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key !== '[' && e.key !== ']') return
      const item = items.find((i) => i.id === lightbox.itemId)
      if (!item) return
      const gallery = normalizeBookmarkMedia(item)
      if (gallery.length <= 1) return
      e.preventDefault()
      e.stopPropagation()
      navigatingRef.current = true
      const delta = e.key === '[' ? -1 : 1
      const next = (bookmarkAttachmentIndex + delta + gallery.length) % gallery.length
      onBookmarkAttachmentChange(next)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [lightbox?.itemId, items, bookmarkAttachmentIndex, onBookmarkAttachmentChange])

  // Close on Escape
  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, handleDismiss])

  // Reposition on window resize
  useEffect(() => {
    if (!lightbox || phase !== 'open') return
    const handler = () => forceUpdate((n) => n + 1)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [lightbox, phase])

  useEffect(() => {
    return () => {
      stopLightboxAnimation()
      restoreSourceVisibility()
    }
  }, [restoreSourceVisibility, stopLightboxAnimation])

  useEffect(() => {
    if (viewMode !== 'grid') return

    const element = scrollRef.current
    if (!element) return

    const updateMetrics = () => {
      const nextWidth = Math.max(0, element.clientWidth - GRID_HORIZONTAL_PADDING_PX * 2)
      const nextHeight = element.clientHeight
      const nextScrollTop = element.scrollTop

      setGridMetrics((current) => {
        if (
          current.width === nextWidth &&
          current.height === nextHeight &&
          current.scrollTop === nextScrollTop
        ) {
          return current
        }

        return {
          width: nextWidth,
          height: nextHeight,
          scrollTop: nextScrollTop
        }
      })
    }

    updateMetrics()

    const observer = new ResizeObserver(() => {
      updateMetrics()
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [viewMode])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current)
      }
    }
  }, [])

  const handleGridScroll = useCallback(() => {
    if (viewMode !== 'grid') return

    const element = scrollRef.current
    if (!element) return

    if (scrollRafRef.current) return

    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const nextScrollTop = element.scrollTop
      setGridMetrics((current) =>
        current.scrollTop === nextScrollTop
          ? current
          : { ...current, scrollTop: nextScrollTop }
      )
    })
  }, [viewMode])

  const columnCount = useMemo(() => {
    if (viewMode !== 'grid') return 1
    return Math.max(
      1,
      Math.floor((gridMetrics.width + GRID_COLUMN_GAP_PX) / (GRID_CELL_WIDTH_PX + GRID_COLUMN_GAP_PX))
    )
  }, [gridMetrics.width, viewMode])

  const gridRows = useMemo(() => {
    if (viewMode !== 'grid') return []
    return chunkItems(items, columnCount)
  }, [columnCount, items, viewMode])

  const rowLayout = useMemo(() => {
    const tops = gridRows.map((_, rowIndex) => rowIndex * (GRID_CELL_HEIGHT_PX + GRID_ROW_GAP_PX))
    const bottoms = tops.map((top) => top + GRID_CELL_HEIGHT_PX)

    return {
      tops,
      bottoms,
      totalHeight:
        gridRows.length > 0
          ? bottoms[bottoms.length - 1] + GRID_ROW_GAP_PX
          : 0
    }
  }, [gridRows])

  const visibleRowRange = useMemo(() => {
    if (viewMode !== 'grid' || gridRows.length === 0) {
      return { start: 0, end: -1 }
    }

    const rangeStart = Math.max(0, gridMetrics.scrollTop - GRID_OVERSCAN_PX)
    const rangeEnd = gridMetrics.scrollTop + gridMetrics.height + GRID_OVERSCAN_PX

    let start = 0
    while (start < rowLayout.bottoms.length && rowLayout.bottoms[start] < rangeStart) {
      start += 1
    }

    let end = start
    while (end < rowLayout.tops.length && rowLayout.tops[end] <= rangeEnd) {
      end += 1
    }

    return {
      start,
      end: Math.min(gridRows.length - 1, Math.max(start, end - 1))
    }
  }, [gridMetrics.height, gridMetrics.scrollTop, gridRows.length, rowLayout.bottoms, rowLayout.tops, viewMode])

  const visibleRows = useMemo(() => {
    if (visibleRowRange.end < visibleRowRange.start) return []

    return gridRows
      .slice(visibleRowRange.start, visibleRowRange.end + 1)
      .map((rowItems, offset) => {
        const rowIndex = visibleRowRange.start + offset
        return {
          rowIndex,
          items: rowItems,
          top: rowLayout.tops[rowIndex] ?? 0
        }
      })
  }, [gridRows, rowLayout.tops, visibleRowRange.end, visibleRowRange.start])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onDrop(files)
        return
      }

      const text =
        e.dataTransfer.getData('text/uri-list') ||
        e.dataTransfer.getData('text/plain')
      const url = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))

      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        onDrop([new File([url], 'url.txt', { type: 'text/uri-list' })])
      }
    },
    [onDrop]
  )

  const showEmptyState = !loading && items.length === 0 && !dragging

  const lightboxResolved =
    lightbox && lightbox.itemId
      ? (() => {
          const item = items.find((i) => i.id === lightbox.itemId)
          if (!item?.thumbnail) return null
          const gallery = normalizeBookmarkMedia(item)
          if (gallery.length === 0) return null
          const idx = Math.min(Math.max(0, bookmarkAttachmentIndex), gallery.length - 1)
          const m = gallery[idx]
          return {
            src: displayUrlForBookmarkMedia(item, m),
            kind: lightboxKindForMedia(m),
            posterSrc: displayStillUrl(item, m)
          }
        })()
      : lightbox?.src
        ? { src: lightbox.src, kind: lightbox.kind ?? 'image', posterSrc: lightbox.posterSrc }
        : null

  const lightboxResolvedKey = lightboxResolved
    ? `${lightboxResolved.kind}:${lightboxResolved.src}:${lightboxResolved.posterSrc ?? ''}`
    : null

  useEffect(() => {
    if (!lightbox || !lightboxResolved || phase === 'opening') return

    const dimensionSrc =
      lightboxResolved.kind === 'video'
        ? lightboxResolved.posterSrc || lightboxResolved.src
        : lightboxResolved.src

    if (!dimensionSrc) return

    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled || img.naturalWidth <= 0 || img.naturalHeight <= 0) return
      setLightboxIntrinsicRect(
        new DOMRect(lightbox.rect.x, lightbox.rect.y, img.naturalWidth, img.naturalHeight)
      )
      setLightboxIntrinsicRectKey(lightboxResolvedKey)
    }
    img.src = dimensionSrc

    return () => {
      cancelled = true
    }
  }, [lightbox, lightboxResolved, lightboxResolvedKey, phase])

  useEffect(() => {
    cancelLightboxVideoPlaybackArm()

    if (phase !== 'open' || lightboxResolved?.kind !== 'video') {
      setLightboxVideoPlaybackArmed(false)
      return
    }

    setLightboxVideoPlaybackArmed(false)
    lightboxVideoPlaybackTimerRef.current = window.setTimeout(() => {
      lightboxVideoPlaybackTimerRef.current = null
      setLightboxVideoPlaybackArmed(true)
      const media = lightboxMediaRef.current
      if (media instanceof HTMLVideoElement) {
        void media.play().catch(() => {})
      }
    }, 360)

    return () => {
      cancelLightboxVideoPlaybackArm()
    }
  }, [cancelLightboxVideoPlaybackArm, lightboxResolved?.kind, lightboxResolved?.src, phase])

  const showLightboxFilmstrip = items.length > 1 && phase === 'open'
  // Keep the enlarge motion independent from the strip so the strip doesn't perturb FLIP geometry.
  const lightboxBottomReserve = 0

  const resolveDisplayRect = () => {
    if (!lightbox) return null

    const media = lightboxMediaRef.current
    let rect = lightbox.rect

    if ((phase === 'open' || phase === 'closing') && media) {
      if (media instanceof HTMLVideoElement && media.videoWidth && media.videoHeight) {
        rect = new DOMRect(rect.x, rect.y, media.videoWidth, media.videoHeight)
      } else if (media instanceof HTMLImageElement && media.naturalWidth && media.naturalHeight) {
        rect = new DOMRect(rect.x, rect.y, media.naturalWidth, media.naturalHeight)
      } else if (lightboxIntrinsicRect && lightboxIntrinsicRectKey === lightboxResolvedKey) {
        rect = lightboxIntrinsicRect
      } else if (navigatingRef.current && lightboxIntrinsicRect) {
        rect = lightboxIntrinsicRect
      }
    }

    return rect
  }

  const getLightboxImgStyle = (): React.CSSProperties => {
    const rect = resolveDisplayRect()
    if (!rect) return {}
    const { targetW, targetH, targetX, targetY } = computeLightboxGeometry(
      rect,
      lightboxPanelWidth.current,
      lightboxBottomReserve
    )
    return {
      width: targetW,
      height: targetH,
      left: targetX,
      top: targetY,
      ...(phase === 'open'
        ? {
            transition:
              'left 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1)'
          }
        : {}),
      ...(navigatingRef.current ? { transition: 'none' } : {}),
    } as React.CSSProperties
  }

  const revealLightboxVideo = phase !== 'opening' && lightboxVideoPlaybackArmed && lightboxVideoReady

  const filmstripInset = {
    left: previewExpanded ? 200 : 0,
    right: previewExpanded ? 0 : 380
  }

  useEffect(() => {
    if (phase !== 'open') return

    const targetSource = resolveCurrentLightboxSource()
    if (!targetSource || targetSource === hiddenSourceRef.current) return

    setLightboxSourceHidden(hiddenSourceRef.current, false)
    hiddenSourceRef.current = targetSource
    setLightboxSourceHidden(hiddenSourceRef.current, true)
  }, [phase, resolveCurrentLightboxSource, lightbox?.sourceItemId])

  useEffect(() => {
    if (!showLightboxFilmstrip) {
      setFilmstripEntered(false)
      return
    }

    let raf = 0
    setFilmstripEntered(false)
    raf = window.requestAnimationFrame(() => {
      setFilmstripEntered(true)
    })

    return () => window.cancelAnimationFrame(raf)
  }, [showLightboxFilmstrip])

  useLayoutEffect(() => {
    if (!lightbox || phase !== 'opening') return

    const frame = lightboxFrameRef.current
    const rect = resolveDisplayRect()
    if (!frame || !rect) return

    const geometry = computeLightboxGeometry(rect, lightboxPanelWidth.current, lightboxBottomReserve)
    restoreSourceVisibility()
    hiddenSourceRef.current = lightbox.element ?? null
    setLightboxSourceHidden(hiddenSourceRef.current, true)

    let cancelled = false
    const controls = animateLightboxFrame(frame, geometry, 'open')
    lightboxAnimationRef.current = controls

    controls.then(() => {
      if (cancelled) return
      lightboxAnimationRef.current = null
      setPhase('open')
    })

    return () => {
      cancelled = true
    }
  }, [lightbox, phase, lightboxBottomReserve, restoreSourceVisibility])

  useLayoutEffect(() => {
    if (!lightbox || phase !== 'closing') return

    const frame = lightboxFrameRef.current
    const targetSource = resolveCurrentLightboxSource()
    if (targetSource && targetSource !== hiddenSourceRef.current) {
      setLightboxSourceHidden(hiddenSourceRef.current, false)
      hiddenSourceRef.current = targetSource
      setLightboxSourceHidden(hiddenSourceRef.current, true)
    }
    const currentSourceId = lightbox.sourceItemId ?? selectedId ?? null
    const hiddenSourceId = getSourceElementItemId(hiddenSourceRef.current)
    const shouldReturnToHiddenSource = !currentSourceId || currentSourceId === hiddenSourceId
    const rect = targetSource
      ? getLiveLightboxSourceRect(targetSource, lightbox.rect)
      : shouldReturnToHiddenSource
        ? getLiveLightboxSourceRect(hiddenSourceRef.current, lightbox.rect)
        : null
    if (!frame || !rect) {
      finalizeLightboxClose()
      return
    }

    const geometry = computeLightboxGeometry(rect, lightboxPanelWidth.current, lightboxBottomReserve)
    let cancelled = false
    let finalizeFrame = 0
    const controls = animateLightboxFrame(frame, geometry, 'close')
    lightboxAnimationRef.current = controls

    controls.then(() => {
      if (cancelled) return
      setLightboxSourceHidden(hiddenSourceRef.current, false)
      finalizeFrame = window.requestAnimationFrame(() => {
        if (cancelled) return
        finalizeLightboxClose()
      })
    })

    return () => {
      cancelled = true
      if (finalizeFrame) window.cancelAnimationFrame(finalizeFrame)
    }
  }, [finalizeLightboxClose, lightbox, lightboxBottomReserve, phase, resolveCurrentLightboxSource, selectedId])

  return (
    <div
      className={`card-grid scroll-area${dragging ? ' card-grid-dragging' : ''}`}
      ref={scrollRef}
      onScroll={viewMode === 'grid' ? handleGridScroll : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="card-grid-drop-zone">
          <div className="card-grid-drop-label">drop to save</div>
        </div>
      )}
      {showEmptyState ? (
        <div className="card-grid-empty">
          <div className="card-grid-empty-title">nothing here yet</div>
          <div className="card-grid-onboarding">
            <div className="card-grid-onboarding-item">
              <span className="card-grid-onboarding-key">&#8984;N</span>
              <span>add a bookmark, note, image, or wishlist item</span>
            </div>
            <div className="card-grid-onboarding-item">
              <span className="card-grid-onboarding-key">drop</span>
              <span>drag files or URLs here to save instantly</span>
            </div>
            <div className="card-grid-onboarding-item">
              <span className="card-grid-onboarding-key">&#8984;V</span>
              <span>paste images, links, or text from the clipboard</span>
            </div>
            <div className="card-grid-onboarding-item">
              <span className="card-grid-onboarding-key">&#8984;F</span>
              <span>search everything with keywords or natural language</span>
            </div>
            <div className="card-grid-onboarding-item">
              <span className="card-grid-onboarding-key">ai</span>
              <span>set up an OpenAI key in the sidebar for smart features</span>
            </div>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div
          className="card-grid-virtual"
          style={{ height: rowLayout.totalHeight || undefined }}
        >
          {visibleRows.map((row) => (
            <VirtualGridRow
              key={`${columnCount}-${row.rowIndex}`}
              top={row.top}
              rowIndex={row.rowIndex}
              columnCount={columnCount}
              items={row.items}
              selectedId={selectedId}
              enrichingIds={enrichingIds}
              enrichmentStages={enrichmentStages}
              newCardIds={newCardIds}
              onSelect={handleSelect}
              onEnlarge={handleEnlarge}
            />
          ))}
        </div>
      ) : (
        <div className="card-grid-list">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              enriching={enrichingIds?.has(item.id) || false}
              enrichmentStage={enrichmentStages?.[item.id]}
              isNew={newCardIds?.has(item.id) || false}
              onSelect={handleSelect}
              onEnlarge={handleEnlarge}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}

      {lightbox && lightboxResolved && (
        <div
          className={`lightbox-overlay${phase ? ' is-active' : ''}${phase && phase !== 'closing' ? ' is-visible' : ''}${phase === 'open' ? ' is-settled' : ''}`}
          onClick={handleDismiss}
        >
          <div className="lightbox-backdrop" />
          {lightboxResolved.kind === 'video' ? (
            <div
              ref={lightboxFrameRef}
              className="lightbox-img lightbox-img--video"
              style={{
                ...getLightboxImgStyle(),
                ...(lightboxResolved.posterSrc
                  ? {
                      backgroundImage: `url("${lightboxResolved.posterSrc}")`
                    }
                  : {})
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseMove={() => {
                if (!lightboxVideoControlsVisible) {
                  setLightboxVideoControlsVisible(true)
                }
              }}
              onMouseLeave={() => {
                setLightboxVideoControlsVisible(false)
              }}
            >
              {lightboxResolved.posterSrc && (
                <img
                  className={`lightbox-media lightbox-media-poster${revealLightboxVideo ? ' is-hidden' : ''}`}
                  src={lightboxResolved.posterSrc}
                  alt=""
                  draggable={false}
                />
              )}
              <video
                key={lightboxResolved.src}
                ref={lightboxMediaRef as React.RefObject<HTMLVideoElement>}
                className={`lightbox-media lightbox-media--video${revealLightboxVideo ? '' : ' is-hidden'}`}
                src={lightboxResolved.src}
                preload="auto"
                controls={lightboxVideoControlsVisible}
                controlsList="nodownload noremoteplayback nofullscreen"
                muted
                loop
                playsInline
                disablePictureInPicture
                disableRemotePlayback
                {...videoDebugHandlers('lightbox', {
                  src: lightboxResolved.src,
                  onLoadedMetadata: () => {
                    navigatingRef.current = false
                    forceUpdate((n) => n + 1)
                  }
                })}
                onLoadedData={(event) => {
                  cancelLightboxVideoReveal()
                  lightboxVideoRevealCleanupRef.current = waitForVideoFirstFrame(event.currentTarget, () => {
                    lightboxVideoRevealCleanupRef.current = null
                    setLightboxVideoReady(true)
                  })
                }}
              />
            </div>
          ) : (
            <div
              ref={lightboxFrameRef}
              className="lightbox-img"
              style={getLightboxImgStyle()}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                key={lightboxResolved.src}
                ref={lightboxMediaRef as React.RefObject<HTMLImageElement>}
                className="lightbox-media"
                src={lightboxResolved.src}
                alt=""
                onLoad={() => {
                  navigatingRef.current = false
                  forceUpdate((n) => n + 1)
                }}
              />
            </div>
          )}
          {showLightboxFilmstrip && (
            <nav
              className={`lightbox-filmstrip${filmstripEntered ? ' is-entered' : ''}`}
              style={{ left: filmstripInset.left, right: filmstripInset.right }}
              aria-label="Items in current list"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="lightbox-filmstrip-scroll">
                {items.map((listItem) => {
                  const active = listItem.id === selectedId
                  const src = getItemAssetUrl(listItem, { width: LIGHTBOX_FILMSTRIP_MEDIA_WIDTH_PX })
                  return (
                    <button
                      key={listItem.id}
                      type="button"
                      className={`lightbox-filmstrip-thumb${active ? ' is-active' : ''}`}
                      ref={active ? filmstripActiveRef : undefined}
                      onClick={() => onSelect(listItem)}
                      title={listItem.title || 'untitled'}
                    >
                      {src ? (
                        <img src={src} alt="" draggable={false} loading="lazy" decoding="async" fetchPriority="low" />
                      ) : (
                        <div className={`lightbox-filmstrip-fallback is-${listItem.type}`}>
                          {(listItem.title || listItem.type).slice(0, 2)}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
