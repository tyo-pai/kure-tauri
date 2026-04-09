import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LightboxData } from '../CardGrid/Card'
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
import type { Item } from '../../types'
import './HomeOverview.css'

interface HomeOverviewProps {
  items: Item[]
  folders: string[]
  folderCounts: Record<string, number>
  loading: boolean
  selectedId: string | null
  previewExpanded: boolean
  onFolderSelect: (folder: string) => void
  onItemSelect: (item: Item) => void
  onEverythingSelect: () => void
  onDrop: (files: File[]) => void
  onLightboxChange?: (open: boolean) => void
  dismissLightbox?: boolean
  bookmarkAttachmentIndex: number
  onBookmarkAttachmentChange: (index: number) => void
}

interface FolderSummary {
  name: string
  items: Item[]
  updatedAt: number
}

type SlotName = 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4'

interface SlotLayout {
  name: SlotName
  width: number
  height: number
  left: number
  bottom: number
  rotate: number
  zIndex: number
}

interface RenderedStackCard {
  item: Item
  slotIndex: number | null
  originSlotIndex: number | null
  phase: 'idle' | 'moving' | 'entering' | 'leaving'
  zIndex: number
}

/* ─────────────────────────────────────────────────────────
 * HOVER STORYBOARD
 *
 *    0ms   folder collage is resting on the default stack
 *  180ms   hover lift begins on the canvas
 *  560ms   top card tucks back while the stack shifts forward
 *  820ms   a new card rises from the back of the pile
 * 2500ms   stack cycles again after a shorter pause
 * ───────────────────────────────────────────────────────── */
const TIMING = {
  hoverLift:          160,
  hoverStartDelay:    560,
  stackMoveDuration:  620,
  collectionShuffle: 2500
}

const SLOT_LAYOUTS: SlotLayout[] = [
  { name: 'slot-2', width: 82, height: 82, left: 32, bottom: 68, rotate: -6.68, zIndex: 1 },
  { name: 'slot-1', width: 90, height: 92, left: 62, bottom: 33, rotate: 5.6, zIndex: 2 },
  { name: 'slot-3', width: 90, height: 92, left: 16, bottom: 24, rotate: -3.83, zIndex: 3 },
  { name: 'slot-4', width: 90, height: 92, left: 42, bottom: 43, rotate: 2.57, zIndex: 4 }
]

const SINGLE_ITEM_LAYOUT: SlotLayout = {
  name: 'slot-4',
  width: 116,
  height: 116,
  left: 32,
  bottom: 32,
  rotate: -3.2,
  zIndex: 4
}

const PLACEHOLDER_CLASSNAMES = ['placeholder-1', 'placeholder-2', 'placeholder-3', 'placeholder-4'] as const
const EVERYTHING_PULL_THRESHOLD = 260
const EVERYTHING_PULL_MAX = 360
const EVERYTHING_BOTTOM_SETTLE_MS = 140
const HOME_FOLDER_MEDIA_WIDTH_PX = 320
const HOME_RECENT_MEDIA_WIDTH_PX = 720
const LIGHTBOX_FILMSTRIP_MEDIA_WIDTH_PX = 160

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getSourceElementItemId(element: HTMLElement | null | undefined): string | null {
  return element?.dataset.lightboxSourceId || null
}

function getCreatedAtValue(item: Item): number {
  return new Date(item.created_at).getTime()
}

function sortNewestFirst(a: Item, b: Item): number {
  return getCreatedAtValue(b) - getCreatedAtValue(a)
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const month = date.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  return `${date.getDate()} ${month}`
}

function getVisualItems(items: Item[]): Item[] {
  return items.filter((item) => Boolean(getItemAssetUrl(item)))
}

function hashSeed(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function getShuffledItems(items: Item[], seedKey: string): Item[] {
  const seed = hashSeed(seedKey)
  return [...items]
    .map((item, index) => ({
      item,
      rank: hashSeed(`${seed}-${item.id}-${index}`)
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item)
}

function getStackFrame(items: Item[], offset: number, size: number): Item[] {
  if (items.length === 0) return []

  const visibleCount = Math.min(items.length, size)
  return Array.from({ length: visibleCount }, (_, index) => {
    const itemIndex = (offset + index + items.length) % items.length
    return items[itemIndex]
  })
}

function getPlaceholderLabel(item: Item): string {
  const title = typeof item.title === 'string' ? item.title.trim() : ''

  if (title) {
    return title.slice(0, 18)
  }

  switch (item.type) {
    case 'bookmark':
      return 'link'
    case 'wishlist':
      return 'wish'
    default:
      return item.type
  }
}

function getSlotTransform(slotIndex: number, hovered: boolean): string {
  const layout = SLOT_LAYOUTS[slotIndex]
  const lift = hovered ? -1 : 0
  const scale = hovered ? 1.004 : 1
  return `translate(0px, ${lift}px) rotate(${layout.rotate}deg) scale(${scale})`
}

function getLeavingTransform(slotIndex: number, hovered: boolean): string {
  const layout = SLOT_LAYOUTS[slotIndex]
  const lift = hovered ? -7 : -6
  return `translate(-10px, ${lift}px) rotate(${layout.rotate + 3}deg) scale(1.015)`
}

function RevealImage({
  src,
  className,
  eager = false
}: {
  src: string
  className?: string
  eager?: boolean
}) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
  }, [src])

  const handleReady = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [])

  return (
    <img
      ref={handleReady}
      className={`${className ?? ''}${loaded ? ' is-loaded' : ''}`.trim()}
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'low'}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth > 0) {
          setLoaded(true)
        }
      }}
    />
  )
}

function FolderCard({
  folder,
  index,
  onFolderSelect
}: {
  folder: FolderSummary
  index: number
  onFolderSelect: (folder: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [stackOffset, setStackOffset] = useState(0)
  const [targetOffset, setTargetOffset] = useState<number | null>(null)
  const stackOffsetRef = useRef(0)
  const orderedItems = useMemo(
    () => getShuffledItems(folder.items, folder.name),
    [folder.items, folder.name]
  )
  const visibleCount = Math.min(orderedItems.length, 4)

  const currentItems = useMemo(
    () => getStackFrame(orderedItems, stackOffset, 4),
    [orderedItems, stackOffset]
  )

  const nextOffset = useMemo(() => {
    if (orderedItems.length === 0) return 0
    return (stackOffset - 1 + orderedItems.length) % orderedItems.length
  }, [orderedItems.length, stackOffset])

  const nextItems = useMemo(
    () => getStackFrame(orderedItems, nextOffset, 4),
    [orderedItems, nextOffset]
  )

  useEffect(() => {
    stackOffsetRef.current = stackOffset
  }, [stackOffset])

  const renderCards = useMemo<RenderedStackCard[]>(() => {
    if (targetOffset === null || visibleCount <= 1) {
      return currentItems.map<RenderedStackCard>((item, index) => ({
        item,
        slotIndex: index,
        originSlotIndex: index,
        phase: 'idle',
        zIndex: SLOT_LAYOUTS[index].zIndex
      }))
    }

    const currentSlotById = new Map(currentItems.map((item, index) => [item.id, index]))
    const nextSlotById = new Map(nextItems.map((item, index) => [item.id, index]))
    const allIds = Array.from(new Set([...currentItems.map((item) => item.id), ...nextItems.map((item) => item.id)]))

    return allIds
      .map((id) => {
        const currentSlotIndex = currentSlotById.get(id) ?? null
        const nextSlotIndex = nextSlotById.get(id) ?? null
        const item =
          currentItems.find((entry) => entry.id === id) ||
          nextItems.find((entry) => entry.id === id)

        if (!item) return null

        if (currentSlotIndex !== null && nextSlotIndex !== null) {
          return {
            item,
            slotIndex: nextSlotIndex,
            originSlotIndex: currentSlotIndex,
            phase: currentSlotIndex === nextSlotIndex ? 'idle' : 'moving',
            zIndex: SLOT_LAYOUTS[nextSlotIndex].zIndex
          } as RenderedStackCard
        }

        if (currentSlotIndex !== null) {
          return {
            item,
            slotIndex: currentSlotIndex,
            originSlotIndex: currentSlotIndex,
            phase: 'leaving',
            zIndex: 0
          } as RenderedStackCard
        }

        if (nextSlotIndex !== null) {
          return {
            item,
            slotIndex: nextSlotIndex,
            originSlotIndex: 0,
            phase: 'entering',
            zIndex: SLOT_LAYOUTS[nextSlotIndex].zIndex
          } as RenderedStackCard
        }

        return null
      })
      .filter((card): card is RenderedStackCard => card !== null)
  }, [currentItems, nextItems, targetOffset, visibleCount])

  useEffect(() => {
    if (!hovered || orderedItems.length <= 1) return

    let interval: number | undefined
    const firstTick = window.setTimeout(() => {
      setTargetOffset(nextOffset)
      interval = window.setInterval(() => {
        setTargetOffset((current) => {
          const baseOffset = current ?? stackOffsetRef.current
          return (baseOffset - 1 + orderedItems.length) % orderedItems.length
        })
      }, TIMING.collectionShuffle)
    }, TIMING.hoverStartDelay)

    return () => {
      window.clearTimeout(firstTick)
      if (interval !== undefined) {
        window.clearInterval(interval)
      }
    }
  }, [hovered, nextOffset, orderedItems.length])

  useEffect(() => {
    if (targetOffset === null || orderedItems.length <= 1) return

    const complete = window.setTimeout(() => {
      setStackOffset(targetOffset)
      setTargetOffset(null)
    }, TIMING.stackMoveDuration)

    return () => window.clearTimeout(complete)
  }, [orderedItems.length, targetOffset])

  return (
    <button
      type="button"
      className={`home-folder-card ${hovered ? 'is-hovered' : ''}`}
      style={{ '--home-appear-delay': `${Math.min(index * 36, 180)}ms` } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={() => onFolderSelect(folder.name)}
    >
      <div className="home-folder-card-canvas">
        {renderCards.map(({ item, slotIndex, originSlotIndex, phase, zIndex }) => {
          if (slotIndex === null) return null
          const isSingleCard = visibleCount === 1
          const layout = isSingleCard ? SINGLE_ITEM_LAYOUT : SLOT_LAYOUTS[slotIndex]
          const src = getItemAssetUrl(item, { width: HOME_FOLDER_MEDIA_WIDTH_PX })
          const transform = isSingleCard
            ? `translate(0px, ${hovered ? -1 : 0}px) rotate(${layout.rotate}deg) scale(${hovered ? 1.01 : 1})`
            : phase === 'leaving' && originSlotIndex !== null
              ? getLeavingTransform(originSlotIndex, hovered)
              : getSlotTransform(slotIndex, hovered)

          return (
            <div
              key={item.id}
              className={[
                'home-folder-card-thumb',
                layout.name,
                `home-folder-card-thumb--${phase}`,
                PLACEHOLDER_CLASSNAMES[slotIndex],
                src ? 'has-image' : ''
              ].join(' ')}
              style={{
                width: `${layout.width}px`,
                height: `${layout.height}px`,
                left: `${layout.left}px`,
                bottom: `${layout.bottom}px`,
                zIndex,
                transform,
                transitionDelay: phase === 'moving' ? `${slotIndex * 50}ms` : '0ms',
                ['--stack-rotate' as string]: `${layout.rotate}deg`
              }}
            >
              {src ? (
                <RevealImage src={src} className="home-folder-card-image" />
              ) : (
                <span>{getPlaceholderLabel(item)}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="home-folder-card-title">{folder.name}</div>
    </button>
  )
}

export function HomeOverview({
  items,
  folders,
  folderCounts,
  loading,
  selectedId,
  previewExpanded,
  onFolderSelect,
  onItemSelect,
  onEverythingSelect,
  onDrop,
  onLightboxChange,
  dismissLightbox,
  bookmarkAttachmentIndex,
  onBookmarkAttachmentChange
}: HomeOverviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigateTriggeredRef = useRef(false)
  const bottomSettledRef = useRef(false)
  const bottomSettleTimerRef = useRef<number | null>(null)
  const lightboxMediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null)
  const lightboxFrameRef = useRef<HTMLDivElement>(null)
  const lightboxPanelWidth = useRef(0)
  const lightboxAnimationRef = useRef<ReturnType<typeof animateLightboxFrame> | null>(null)
  const lightboxVideoRevealCleanupRef = useRef<(() => void) | null>(null)
  const lightboxVideoPlaybackTimerRef = useRef<number | null>(null)
  const hiddenSourceRef = useRef<HTMLElement | null>(null)
  const navigatingRef = useRef(false)
  const filmstripActiveRef = useRef<HTMLButtonElement | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isAtBottom, setIsAtBottom] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<LightboxData | null>(null)
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing' | null>(null)
  const [lightboxVideoReady, setLightboxVideoReady] = useState(false)
  const [lightboxVideoPlaybackArmed, setLightboxVideoPlaybackArmed] = useState(false)
  const [lightboxVideoControlsVisible, setLightboxVideoControlsVisible] = useState(false)
  const [lightboxIntrinsicRect, setLightboxIntrinsicRect] = useState<DOMRect | null>(null)
  const [lightboxIntrinsicRectKey, setLightboxIntrinsicRectKey] = useState<string | null>(null)
  const [filmstripEntered, setFilmstripEntered] = useState(false)
  const [, forceUpdate] = useState(0)

  const folderSummaries = useMemo<FolderSummary[]>(() => {
    const itemsByFolder = new Map<string, Item[]>()

    for (const item of items) {
      if (!item.folder) continue
      const group = itemsByFolder.get(item.folder) || []
      group.push(item)
      itemsByFolder.set(item.folder, group)
    }

    return folders
      .filter((folder) => (folderCounts[folder] || 0) > 0)
      .map((folder) => {
        const folderItems = [...(itemsByFolder.get(folder) || [])].sort(sortNewestFirst)
        const visualItems = getVisualItems(folderItems)
        const previewItems = visualItems.length > 0 ? visualItems : folderItems

        return {
          name: folder,
          items: previewItems,
          updatedAt: folderItems[0] ? getCreatedAtValue(folderItems[0]) : 0
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [folders, folderCounts, items])

  const recentItems = useMemo(() => {
    return [...items].sort(sortNewestFirst).slice(0, 10)
  }, [items])

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

  const handleDismissLightbox = useCallback(() => {
    if (!lightbox || phase === 'closing') return
    stopLightboxAnimation()
    setPhase('closing')
    onLightboxChange?.(false)
  }, [lightbox, onLightboxChange, phase, stopLightboxAnimation])

  useEffect(() => {
    if (dismissLightbox && lightbox && phase !== 'closing') {
      handleDismissLightbox()
    }
  }, [dismissLightbox, handleDismissLightbox, lightbox, phase])

  useEffect(() => {
    if (!lightbox || phase !== 'open') return
    lightboxPanelWidth.current = lightboxPanelReserveWidth(previewExpanded)
    forceUpdate((n) => n + 1)
  }, [previewExpanded, lightbox, phase])

  useEffect(() => {
    if (!lightbox || !selectedId || recentItems.length < 2) return
    filmstripActiveRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth'
    })
  }, [selectedId, lightbox, recentItems.length])

  useEffect(() => {
    if (!lightbox || !selectedId || phase !== 'open') return
    const selectedItem = recentItems.find((entry) => entry.id === selectedId)
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
  }, [selectedId, recentItems, lightbox, phase])

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

  useEffect(() => {
    if (!lightbox?.itemId) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key !== '[' && e.key !== ']') return
      const item = recentItems.find((entry) => entry.id === lightbox.itemId)
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
  }, [lightbox?.itemId, recentItems, bookmarkAttachmentIndex, onBookmarkAttachmentChange])

  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismissLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, handleDismissLightbox])

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

  const pullProgress = useMemo(() => {
    const ratio = Math.min(1, pullDistance / EVERYTHING_PULL_THRESHOLD)
    return Math.pow(ratio, 0.82)
  }, [pullDistance])

  const pullLift = useMemo(() => {
    return Math.min(34, pullDistance * 0.16)
  }, [pullDistance])

  const lightboxResolved =
    lightbox && lightbox.itemId
      ? (() => {
          const item = recentItems.find((entry) => entry.id === lightbox.itemId)
          if (!item?.thumbnail) return null
          const gallery = normalizeBookmarkMedia(item)
          if (gallery.length === 0) return null
          const index = Math.min(Math.max(0, bookmarkAttachmentIndex), gallery.length - 1)
          const media = gallery[index]
          return {
            src: displayUrlForBookmarkMedia(item, media),
            kind: lightboxKindForMedia(media),
            posterSrc: displayStillUrl(item, media)
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

  const showLightboxFilmstrip = recentItems.length > 1 && phase === 'open'
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
      ...(navigatingRef.current ? { transition: 'none' } : {})
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

  const resetPullState = useCallback(() => {
    setPullDistance(0)
    navigateTriggeredRef.current = false
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }, [])

  const handleDropEvent = useCallback((e: React.DragEvent<HTMLDivElement>) => {
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
  }, [onDrop])

  const updateBottomState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2
    setIsAtBottom(atBottom)

    if (bottomSettleTimerRef.current !== null) {
      window.clearTimeout(bottomSettleTimerRef.current)
      bottomSettleTimerRef.current = null
    }

    if (atBottom) {
      bottomSettleTimerRef.current = window.setTimeout(() => {
        bottomSettledRef.current = true
        bottomSettleTimerRef.current = null
      }, EVERYTHING_BOTTOM_SETTLE_MS)
    } else {
      bottomSettledRef.current = false
      resetPullState()
    }
  }, [onEverythingSelect, resetPullState])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!isAtBottom || !bottomSettledRef.current) return

    if (event.deltaY > 0) {
      event.preventDefault()
      setPullDistance((current) => {
        const resistance = current < EVERYTHING_PULL_THRESHOLD ? 0.34 : 0.14
        const next = Math.min(EVERYTHING_PULL_MAX, current + event.deltaY * resistance)
        if (next >= EVERYTHING_PULL_THRESHOLD && !navigateTriggeredRef.current) {
          navigateTriggeredRef.current = true
          onEverythingSelect()
        }
        return next
      })
      return
    }

    if (event.deltaY < 0) {
      setPullDistance((current) => Math.max(0, current + event.deltaY * 0.7))
    }
  }, [isAtBottom, onEverythingSelect])

  useEffect(() => {
    updateBottomState()
  }, [items, updateBottomState])

  useEffect(() => {
    return () => {
      if (bottomSettleTimerRef.current !== null) {
        window.clearTimeout(bottomSettleTimerRef.current)
      }
    }
  }, [])

  if (!loading && items.length === 0) {
    return (
      <div
        className={`home-overview scroll-area${dragging ? ' card-grid-dragging' : ''}`}
        ref={scrollRef}
        onScroll={updateBottomState}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropEvent}
      >
        {dragging && (
          <div className="card-grid-drop-zone">
            <div className="card-grid-drop-label">drop to save</div>
          </div>
        )}
        <div className="home-overview-empty">
          <div className="home-overview-empty-title">nothing here yet</div>
          <p>Start saving images, links, notes, and wishlist items to build your overview.</p>
        </div>
        <div
          className={`home-overview-next-menu ${isAtBottom || pullProgress > 0 ? 'is-visible' : ''}`}
          style={{
            '--next-progress': pullProgress,
            '--next-lift': `${pullLift}px`
          } as CSSProperties}
        >
          <div className="home-overview-next-pill">
            <div className="home-overview-next-pill-fill" />
            <span className="home-overview-next-pill-label">everything</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={`home-overview scroll-area${dragging ? ' card-grid-dragging' : ''}`}
        ref={scrollRef}
        onScroll={updateBottomState}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropEvent}
      >
        {folderSummaries.length > 0 && (
          <section className="home-overview-section" aria-label="Folders with content">
            <div className="home-overview-folder-grid">
              {folderSummaries.map((folder, index) => (
                <FolderCard key={folder.name} folder={folder} index={index} onFolderSelect={onFolderSelect} />
              ))}
            </div>
          </section>
        )}

        <section className="home-overview-section" aria-labelledby="home-overview-recent">
          <h2 id="home-overview-recent" className="home-overview-title">
            recent
          </h2>

          <div className="home-overview-recent-grid">
            {recentItems.map((item, index) => {
              const src = getItemAssetUrl(item, { width: HOME_RECENT_MEDIA_WIDTH_PX })
              const fullSrc = getItemAssetUrl(item)

              return (
                <button
                  key={item.id}
                  type="button"
                  className="home-recent-card"
                  style={{ '--home-appear-delay': `${Math.min(index * 34, 180)}ms` } as CSSProperties}
                  onClick={(event) => {
                    onItemSelect(item)

                    const mediaFrame = event.currentTarget.querySelector('.home-recent-card-media') as HTMLDivElement | null
                    const mediaSurface = event.currentTarget.querySelector('.home-recent-card-media-surface') as HTMLDivElement | null
                    const mediaEl = event.currentTarget.querySelector('.home-recent-card-media-surface img, .home-recent-card-media-surface video') as
                      | HTMLImageElement
                      | HTMLVideoElement
                      | null
                    const sourceRect =
                      mediaEl?.getBoundingClientRect() ??
                      mediaSurface?.getBoundingClientRect() ??
                      mediaFrame?.getBoundingClientRect() ??
                      event.currentTarget.getBoundingClientRect()
                    const sourceElement = mediaSurface ?? mediaFrame ?? event.currentTarget

                    if (item.type === 'image' && fullSrc) {
                      handleEnlarge({
                        rect: sourceRect,
                        element: sourceElement,
                        sourceItemId: item.id,
                        src: fullSrc,
                        kind: 'image'
                      })
                      return
                    }

                    if ((item.type === 'bookmark' || item.type === 'wishlist') && item.thumbnail) {
                      handleEnlarge({
                        rect: sourceRect,
                        element: sourceElement,
                        sourceItemId: item.id,
                        itemId: item.id
                      })
                    }
                  }}
                >
                  <div
                    className={`home-recent-card-media ${src ? 'has-image' : `is-${item.type}`}`}
                  >
                    {src ? (
                      <div className="home-recent-card-media-surface" data-lightbox-source-id={item.id}>
                        <RevealImage
                          src={src}
                          className="home-recent-card-image"
                          eager={index < 4}
                        />
                      </div>
                    ) : (
                      <div className="home-recent-card-fallback">{getPlaceholderLabel(item)}</div>
                    )}
                  </div>
                  <div className="home-recent-card-meta">
                    <div className="home-recent-card-title">{item.title || 'untitled'}</div>
                    <div className="home-recent-card-date">{formatDate(item.created_at)}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <div
          className={`home-overview-next-menu ${isAtBottom || pullProgress > 0 ? 'is-visible' : ''}`}
          style={{
            '--next-progress': pullProgress,
            '--next-lift': `${pullLift}px`
          } as CSSProperties}
        >
          <div className="home-overview-next-pill">
            <div className="home-overview-next-pill-fill" />
            <span className="home-overview-next-pill-label">everything</span>
          </div>
        </div>
      </div>

      {lightbox && lightboxResolved && (
        <div
          className={`lightbox-overlay${phase ? ' is-active' : ''}${phase && phase !== 'closing' ? ' is-visible' : ''}${phase === 'open' ? ' is-settled' : ''}`}
          onClick={handleDismissLightbox}
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
                {recentItems.map((listItem) => {
                  const active = listItem.id === selectedId
                  const thumbSrc = getItemAssetUrl(listItem, { width: LIGHTBOX_FILMSTRIP_MEDIA_WIDTH_PX })
                  return (
                    <button
                      key={listItem.id}
                      type="button"
                      className={`lightbox-filmstrip-thumb${active ? ' is-active' : ''}`}
                      ref={active ? filmstripActiveRef : undefined}
                      onClick={() => onItemSelect(listItem)}
                      title={listItem.title || 'untitled'}
                    >
                      {thumbSrc ? (
                        <img src={thumbSrc} alt="" draggable={false} loading="lazy" decoding="async" fetchPriority="low" />
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
    </>
  )
}
