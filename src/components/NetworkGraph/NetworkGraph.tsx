import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { animate } from 'motion'
import { DataSet, Network } from 'vis-network/standalone'
import type { Edge as VisEdge, IdType, Node as VisNode, Options as VisOptions } from 'vis-network/standalone'
import { getItemAssetUrl } from '../../lib/assets'
import {
  displayStillUrl,
  displayUrlForBookmarkMedia,
  lightboxKindForMedia,
  normalizeBookmarkMedia
} from '../../lib/bookmarkMedia'
import {
  animateLightboxFrame,
  computeLightboxGeometry,
  getElementCornerRadiusPx,
  getLightboxTransform,
  setLightboxSourceHidden,
  type LightboxEasing
} from '../../lib/lightboxMotion'
import {
  deriveNetworkGraph,
  getNetworkItemNodeId,
  type NetworkGraphEdge,
  type NetworkGraphHubKind,
  type NetworkGraphHubNode,
  type NetworkGraphNode
} from '../../lib/networkGraph'
import type { Item } from '../../types'
import './NetworkGraph.css'

interface NetworkGraphProps {
  items: Item[]
  selectedId: string | null
  loading: boolean
  onSelect: (item: Item | null) => void
  onFolderSelect: (folder: string) => void
  onTagSelect: (tag: string) => void
  onColorSelect: (hex: string) => void
  onLightboxChange?: (open: boolean) => void
  dismissLightbox?: boolean
}

type NetworkVisNode = VisNode & { id: string }
type NetworkVisEdge = VisEdge & { id: string; from: string; to: string }

interface GraphNodeVisualState {
  opacity: number
  fontSize: number
  labelVAdjust: number
}

interface GraphEdgeVisualState {
  opacity: number
  width: number
}

interface NetworkGraphLightboxMedia {
  src: string
  kind: 'image' | 'video'
  posterSrc?: string
}

interface NetworkGraphLightboxData extends NetworkGraphLightboxMedia {
  rect: DOMRect
  element?: HTMLElement | null
  sourceRadiusPx?: number
}

type DetailPanelMotionPhase = 'enter' | 'change' | 'exit'

interface DetailPanelRenderState {
  item: Item
  motionKey: number
  motionPhase: DetailPanelMotionPhase
}

interface NetworkGraphTheme {
  isDark: boolean
  surface: string
  surfaceSolid: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  border: string
  edge: string
}

interface NetworkEventParams {
  node?: IdType
  nodes?: IdType[]
  pointer?: {
    DOM?: {
      x: number
      y: number
    }
  }
}

type MediaNodeShape = 'image' | 'circularImage'

type TailwindShade = 300 | 400 | 500 | 600 | 700
type TailwindColorFamily =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'

interface NetworkGraphDesign {
  fitDelayMs: number
  colors: {
    items: Record<Item['type'], string>
    hubs: Record<NetworkGraphHubKind, string>
  }
  labels: {
    itemMaxLength: number
    hubMaxLength: number
  }
  layout: {
    hubRadiusMin: number
    hubRadiusSpread: number
    itemRadiusBase: number
    itemRadiusStep: number
    itemRadiusRingStep: number
  }
  item: {
    minSize: number
    maxSize: number
    connectionSizeStep: number
    borderWidth: number
    selectedBorderWidth: number
  }
  media: {
    thumbnailWidth: number
    shape: MediaNodeShape
    size: number
    selectedSize: number
    borderWidth: number
    selectedBorderWidth: number
    imagePadding: number
  }
  note: {
    borderRadius: number
    margin: { top: number; right: number; bottom: number; left: number }
  }
  hub: {
    tagBaseSize: number
    folderBaseSize: number
    colorBaseSize: number
    maxSize: number
    countSizeStep: number
    countMassStep: number
    maxExtraMass: number
    borderWidth: number
    colorBorderWidth: number
    selectedBorderWidth: number
    folderRadius: number
    folderMargin: { top: number; right: number; bottom: number; left: number }
  }
  physics: {
    springLength: number
    avoidOverlap: number
    gravitationalConstant: number
  }
}

const TAILWIND_COLORS: Record<TailwindColorFamily, Record<TailwindShade, string>> = {
  slate: { 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155' },
  gray: { 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151' },
  zinc: { 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46' },
  neutral: { 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040' },
  red: { 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
  orange: { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
  amber: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
  yellow: { 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207' },
  lime: { 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d', 700: '#4d7c0f' },
  green: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
  emerald: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857' },
  teal: { 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
  cyan: { 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490' },
  sky: { 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1' },
  blue: { 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
  indigo: { 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
  violet: { 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9' },
  purple: { 300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7', 600: '#9333ea', 700: '#7e22ce' },
  fuchsia: { 300: '#f0abfc', 400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf' },
  pink: { 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d' },
  rose: { 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c' }
}

const TAILWIND_COLOR_OPTIONS = (Object.keys(TAILWIND_COLORS) as TailwindColorFamily[]).map((name) => ({
  label: name,
  value: `${name}-600 dark:${name}-400`
}))

const DEFAULT_ITEM_TYPE_COLORS: Record<Item['type'], string> = {
  bookmark: 'neutral-600 dark:neutral-400',
  note: 'amber-600 dark:amber-300',
  image: 'neutral-600 dark:neutral-400',
  wishlist: 'neutral-600 dark:neutral-400'
}

const DEFAULT_HUB_COLORS: Record<NetworkGraphHubKind, string> = {
  tag: 'neutral-600 dark:neutral-400',
  folder: 'indigo-600 dark:indigo-400',
  color: 'violet-600 dark:violet-400'
}

const NETWORK_GRAPH_DEFAULT_DESIGN: NetworkGraphDesign = {
  fitDelayMs: 80,
  colors: {
    items: DEFAULT_ITEM_TYPE_COLORS,
    hubs: DEFAULT_HUB_COLORS
  },
  labels: {
    itemMaxLength: 28,
    hubMaxLength: 22
  },
  layout: {
    hubRadiusMin: 260,
    hubRadiusSpread: 180,
    itemRadiusBase: 70,
    itemRadiusStep: 14,
    itemRadiusRingStep: 5
  },
  item: {
    minSize: 13,
    maxSize: 24,
    connectionSizeStep: 2.4,
    borderWidth: 1.6,
    selectedBorderWidth: 3
  },
  media: {
    thumbnailWidth: 260,
    shape: 'image',
    size: 34,
    selectedSize: 44,
    borderWidth: 1.5,
    selectedBorderWidth: 2.5,
    imagePadding: 0
  },
  note: {
    borderRadius: 8,
    margin: { top: 7, right: 9, bottom: 7, left: 9 }
  },
  hub: {
    tagBaseSize: 13,
    folderBaseSize: 13,
    colorBaseSize: 15,
    maxSize: 30,
    countSizeStep: 2.2,
    countMassStep: 8,
    maxExtraMass: 5,
    borderWidth: 2,
    colorBorderWidth: 1,
    selectedBorderWidth: 3,
    folderRadius: 8,
    folderMargin: { top: 7, right: 10, bottom: 7, left: 10 }
  },
  physics: {
    springLength: 112,
    avoidOverlap: 0.75,
    gravitationalConstant: -64
  }
}

const SCOPE_FIT_MIN_ZOOM = 0.08
const SCOPE_FIT_MAX_ZOOM = 1.18
const SELECTED_FIT_MIN_ZOOM = 0.42
const SELECTED_FIT_MAX_ZOOM = 1.55
const REVEAL_ANIMATION_MS = 180
const ACTIVE_LABEL_SIZE_BOOST = 2
const ACTIVE_LABEL_VADJUST = 5
const LIGHTBOX_CLOSE_MS = 550
const LIGHTBOX_CLOSE_EASE: [number, number, number, number] = [1, -0.2, 0.5, 1]
const DETAIL_PANEL_ENTER_MS = 210
const DETAIL_PANEL_CHANGE_MS = 170
const DETAIL_PANEL_EXIT_MS = 140
const DETAIL_PANEL_ENTER_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const DETAIL_PANEL_CHANGE_EASE: [number, number, number, number] = [0.45, 0, 0.2, 1]
const DETAIL_PANEL_EXIT_EASE: [number, number, number, number] = [0.4, 0, 1, 1]

interface NetworkGraphReturnMotion {
  lightboxCloseDurationMs: number
  lightboxCloseEase: LightboxEasing
}

const NETWORK_GRAPH_RETURN_MOTION: NetworkGraphReturnMotion = {
  lightboxCloseDurationMs: LIGHTBOX_CLOSE_MS,
  lightboxCloseEase: LIGHTBOX_CLOSE_EASE
}

const FALLBACK_IMAGE_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#d7dbe2"/><circle cx="48" cy="39" r="13" fill="#8a93a3"/><path d="M24 74c4-15 16-24 24-24s20 9 24 24" fill="#8a93a3"/></svg>'
)}`

function formatCountLabel(count: number): string {
  return count.toLocaleString('en-US')
}

function getDomain(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function getItemMediaSrc(item: Item, design: NetworkGraphDesign): string | null {
  if (item.type === 'bookmark' || item.type === 'wishlist') {
    const primary = normalizeBookmarkMedia(item)[0]
    return primary ? displayStillUrl(item, primary, { width: design.media.thumbnailWidth }) : null
  }

  if (item.type === 'image') {
    return getItemAssetUrl(item, { width: design.media.thumbnailWidth })
  }

  return null
}

function getItemLightboxMedia(item: Item): NetworkGraphLightboxMedia | null {
  if (item.type === 'bookmark' || item.type === 'wishlist') {
    const primary = normalizeBookmarkMedia(item)[0]
    if (!primary) return null

    return {
      src: displayUrlForBookmarkMedia(item, primary),
      kind: lightboxKindForMedia(primary),
      posterSrc: displayStillUrl(item, primary)
    }
  }

  if (item.type === 'image') {
    const src = getItemAssetUrl(item) || item.thumbnail
    return src ? { src, kind: 'image' } : null
  }

  return null
}

function getItemLabel(item: Item): string {
  return item.title || item.description || item.url || 'untitled'
}

function getItemMeta(item: Item): string {
  if (item.type === 'bookmark' || item.type === 'wishlist') return getDomain(item.url)
  if (item.folder) return item.folder
  return item.type
}

function formatGraphDetailDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).toLowerCase()
}

function truncateLabel(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function readCssColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim()
  return value || fallback
}

function readNetworkGraphTheme(): NetworkGraphTheme {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const isDark =
    root.dataset.theme === 'dark' ||
    (root.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return {
    isDark,
    surface: readCssColor(styles, '--surface', isDark ? '#171717' : '#f5f5f2'),
    surfaceSolid: readCssColor(styles, '--surface-solid', isDark ? '#202020' : '#ffffff'),
    textPrimary: readCssColor(styles, '--text-primary', isDark ? '#f3f0ea' : '#171717'),
    textSecondary: readCssColor(styles, '--text-secondary', isDark ? '#c7c1b8' : '#4c4944'),
    textTertiary: readCssColor(styles, '--text-tertiary', isDark ? '#8f8981' : '#8b867d'),
    border: readCssColor(styles, '--border', isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'),
    edge: isDark ? 'rgba(229,224,216,0.72)' : 'rgba(34,32,30,0.58)'
  }
}

function useNetworkGraphTheme(): NetworkGraphTheme {
  const [theme, setTheme] = useState(readNetworkGraphTheme)

  useEffect(() => {
    const updateTheme = () => setTheme(readNetworkGraphTheme())
    const observer = new MutationObserver(updateTheme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style']
    })
    media.addEventListener('change', updateTheme)

    return () => {
      observer.disconnect()
      media.removeEventListener('change', updateTheme)
    }
  }, [])

  return theme
}

function hashNumber(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(value: string): number {
  return hashNumber(value) / 4294967295
}

function getInitialPosition(node: NetworkGraphNode, design: NetworkGraphDesign): { x: number; y: number } {
  if (node.kind === 'hub') {
    const kindRange: Record<NetworkGraphHubKind, [number, number]> = {
      tag: [-Math.PI * 0.95, -Math.PI * 0.2],
      folder: [-Math.PI * 0.1, Math.PI * 0.35],
      color: [Math.PI * 0.45, Math.PI * 0.95]
    }
    const [start, end] = kindRange[node.hubKind]
    const angle = start + (end - start) * seededUnit(node.id)
    const radius =
      design.layout.hubRadiusMin +
      seededUnit(`${node.id}:radius`) * design.layout.hubRadiusSpread
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  }

  const angle = seededUnit(`${node.id}:angle`) * Math.PI * 2
  const radius =
    design.layout.itemRadiusBase +
    (node.layoutIndex % 18) * design.layout.itemRadiusStep +
    Math.floor(node.layoutIndex / 18) * design.layout.itemRadiusRingStep
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function getNodeLabel(node: NetworkGraphNode, design: NetworkGraphDesign): string {
  if (node.kind === 'hub') {
    if (node.hubKind === 'color') return `${node.label}\n${formatCountLabel(node.count)}`
    const prefix = node.hubKind === 'tag' ? '#' : ''
    return `${prefix}${truncateLabel(node.label, design.labels.hubMaxLength)}\n${formatCountLabel(node.count)}`
  }

  return truncateLabel(getItemLabel(node.item), design.labels.itemMaxLength)
}

function getBaseNodeColor(
  node: NetworkGraphNode,
  theme: NetworkGraphTheme,
  design: NetworkGraphDesign
) {
  if (node.kind === 'hub') {
    const color = node.color || resolveGraphColor(design.colors.hubs[node.hubKind], theme)
    return {
      border: 'rgba(0,0,0,0)',
      background: color,
      highlight: { border: 'rgba(0,0,0,0)', background: color },
      hover: { border: 'rgba(0,0,0,0)', background: color }
    }
  }

  const color = resolveGraphColor(design.colors.items[node.item.type], theme)
  return {
    border: 'rgba(0,0,0,0)',
    background: color,
    highlight: { border: 'rgba(0,0,0,0)', background: color },
    hover: { border: 'rgba(0,0,0,0)', background: color }
  }
}

function getNodeColor(
  node: NetworkGraphNode,
  theme: NetworkGraphTheme,
  design: NetworkGraphDesign
) {
  if (node.kind === 'hub') {
    const color = node.color || resolveGraphColor(design.colors.hubs[node.hubKind], theme)

    if (node.hubKind === 'color') {
      return {
        border: 'rgba(0,0,0,0)',
        background: color,
        highlight: { border: 'rgba(0,0,0,0)', background: color },
        hover: { border: 'rgba(0,0,0,0)', background: color }
      }
    }

    return getBaseNodeColor(node, theme, design)
  }

  const mediaSrc = getItemMediaSrc(node.item, design)
  const color = resolveGraphColor(design.colors.items[node.item.type], theme)

  if (mediaSrc) {
    return {
      border: 'rgba(0,0,0,0)',
      background: color,
      highlight: { border: 'rgba(0,0,0,0)', background: color },
      hover: { border: 'rgba(0,0,0,0)', background: color }
    }
  }

  return getBaseNodeColor(node, theme, design)
}

function getNodeFontSize(node: NetworkGraphNode): number {
  return node.kind === 'hub' ? 12 : 11
}

function getNodeFont(
  node: NetworkGraphNode,
  theme: NetworkGraphTheme,
  opacity = 1,
  size = getNodeFontSize(node),
  vadjust = 0
) {
  const color = opacity < 0.5 ? theme.textTertiary : theme.textSecondary
  return {
    color,
    face: 'Geist Mono, SF Mono, Menlo, monospace',
    size,
    strokeWidth: 0,
    strokeColor: 'rgba(0,0,0,0)',
    vadjust
  }
}

function toVisNode(
  node: NetworkGraphNode,
  theme: NetworkGraphTheme,
  design: NetworkGraphDesign
): NetworkVisNode {
  const position = getInitialPosition(node, design)

  if (node.kind === 'hub') {
    const baseSize =
      node.hubKind === 'color'
        ? design.hub.colorBaseSize
        : node.hubKind === 'folder'
          ? design.hub.folderBaseSize
          : design.hub.tagBaseSize
    return {
      id: node.id,
      label: getNodeLabel(node, design),
      shape: node.hubKind === 'folder' ? 'box' : node.hubKind === 'tag' ? 'dot' : 'circle',
      size: Math.min(
        design.hub.maxSize,
        baseSize + Math.sqrt(node.count) * design.hub.countSizeStep
      ),
      value: node.count,
      mass: 1.7 + Math.min(
        design.hub.maxExtraMass,
        node.count / design.hub.countMassStep
      ),
      borderWidth: 0,
      borderWidthSelected: 0,
      font: getNodeFont(node, theme),
      margin: node.hubKind === 'folder' ? design.hub.folderMargin : undefined,
      shapeProperties: node.hubKind === 'folder'
        ? { borderDashes: false, borderRadius: design.hub.folderRadius }
        : { borderDashes: false },
      shadow: false,
      x: position.x,
      y: position.y,
      group: node.hubKind,
      opacity: 1,
      physics: true,
      labelHighlightBold: false,
      chosen: true,
      color: getNodeColor(node, theme, design)
    }
  }

  const mediaSrc = getItemMediaSrc(node.item, design)
  const size = mediaSrc
    ? node.selected ? design.media.selectedSize : design.media.size
    : Math.min(
        design.item.maxSize,
        design.item.minSize + Math.sqrt(node.connectionCount + 1) * design.item.connectionSizeStep
      )

  return {
    id: node.id,
    label: getNodeLabel(node, design),
    shape: mediaSrc ? design.media.shape : node.item.type === 'note' ? 'box' : 'dot',
    image: mediaSrc || undefined,
    brokenImage: FALLBACK_IMAGE_URI,
    size,
    value: node.connectionCount + 1,
    mass: mediaSrc ? 2.2 : 1.2 + Math.min(3, node.connectionCount / 4),
    borderWidth: 0,
    borderWidthSelected: 0,
    font: getNodeFont(node, theme),
    margin: node.item.type === 'note' && !mediaSrc ? design.note.margin : undefined,
    imagePadding: mediaSrc ? design.media.imagePadding : undefined,
    shapeProperties: mediaSrc
      ? {
          borderDashes: false,
          interpolation: true,
          useImageSize: false,
          useBorderWithImage: true
        }
      : node.item.type === 'note'
        ? { borderDashes: false, borderRadius: design.note.borderRadius }
        : { borderDashes: false },
    shadow: false,
    x: position.x,
    y: position.y,
    group: node.item.type,
    opacity: 1,
    physics: true,
    labelHighlightBold: false,
    chosen: true,
    color: getNodeColor(node, theme, design)
  }
}

function getEdgeColor(edge: NetworkGraphEdge, theme: NetworkGraphTheme, opacity: number) {
  return {
    color: edge.color || theme.edge,
    highlight: edge.color || theme.textSecondary,
    hover: edge.color || theme.textSecondary,
    opacity
  }
}

function toVisEdge(edge: NetworkGraphEdge, theme: NetworkGraphTheme): NetworkVisEdge {
  return {
    id: edge.id,
    from: edge.source,
    to: edge.target,
    color: getEdgeColor(edge, theme, edge.relation === 'color' ? 0.18 : 0.13),
    width: edge.relation === 'color' ? 1.15 : 0.9,
    hoverWidth: 0,
    selectionWidth: 0,
    chosen: false,
    smooth: {
      enabled: true,
      type: 'dynamic',
      roundness: 0.35
    }
  }
}

function removeInitialPositionForExistingNode(
  node: NetworkVisNode,
  existingIds: Set<string>
): NetworkVisNode {
  if (!existingIds.has(node.id)) return node
  const { x: _x, y: _y, ...rest } = node
  return rest
}

function reconcileNodeDataSet(dataSet: DataSet<NetworkVisNode, 'id'>, nextNodes: NetworkVisNode[]) {
  const nextIds = new Set(nextNodes.map((node) => node.id))
  const existingIds = new Set(dataSet.getIds().map(String))
  const staleIds = [...existingIds].filter((id) => !nextIds.has(id))

  if (staleIds.length > 0) dataSet.remove(staleIds)
  dataSet.update(nextNodes.map((node) => removeInitialPositionForExistingNode(node, existingIds)))
}

function reconcileEdgeDataSet(dataSet: DataSet<NetworkVisEdge, 'id'>, nextEdges: NetworkVisEdge[]) {
  const nextIds = new Set(nextEdges.map((edge) => edge.id))
  const existingIds = new Set(dataSet.getIds().map(String))
  const staleIds = [...existingIds].filter((id) => !nextIds.has(id))

  if (staleIds.length > 0) dataSet.remove(staleIds)
  dataSet.update(nextEdges)
}

function getNodeIdFromParams(
  params: NetworkEventParams | undefined,
  network?: Network
): string | null {
  const node = params?.node
  if (typeof node === 'string' || typeof node === 'number') return String(node)

  const id = params?.nodes?.[0]
  if (typeof id === 'string' || typeof id === 'number') return String(id)

  const pointer = params?.pointer?.DOM
  if (!network || !pointer) return null

  const pointerNodeId = network.getNodeAt(pointer)
  return typeof pointerNodeId === 'string' || typeof pointerNodeId === 'number'
    ? String(pointerNodeId)
    : null
}

function getNeighborhoodNodeIds(
  network: Network,
  nodes: DataSet<NetworkVisNode, 'id'>,
  nodeId: string
): string[] {
  if (!nodes.get(nodeId)) return []

  const nodeIds = new Set<string>([nodeId])
  for (const rawNodeId of network.getConnectedNodes(nodeId)) {
    if (typeof rawNodeId !== 'string' && typeof rawNodeId !== 'number') continue

    const connectedNodeId = String(rawNodeId)
    if (nodes.get(connectedNodeId)) nodeIds.add(connectedNodeId)
  }

  return [...nodeIds]
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3)
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function getNetworkOptions(theme: NetworkGraphTheme, design: NetworkGraphDesign): VisOptions {
  return {
    autoResize: true,
    height: '100%',
    width: '100%',
    nodes: {
      labelHighlightBold: false,
      scaling: {
        min: 12,
        max: 34
      },
      font: {
        color: theme.textSecondary,
        face: 'Geist Mono, SF Mono, Menlo, monospace',
        size: 11,
        strokeWidth: 0,
        strokeColor: 'rgba(0,0,0,0)',
        vadjust: 0
      }
    },
    edges: {
      width: 0.9,
      color: {
        color: theme.edge,
        opacity: 0.13
      },
      smooth: {
        enabled: true,
        type: 'dynamic',
        roundness: 0.35
      },
      hoverWidth: 0,
      selectionWidth: 0,
      chosen: false
    },
    interaction: {
      dragNodes: true,
      dragView: true,
      hideEdgesOnDrag: false,
      hover: true,
      hoverConnectedEdges: false,
      keyboard: false,
      multiselect: false,
      navigationButtons: false,
      selectConnectedEdges: false,
      zoomView: true
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      stabilization: {
        enabled: true,
        iterations: 180,
        updateInterval: 25,
        fit: true
      },
      timestep: 0.42,
      minVelocity: 0.08,
      maxVelocity: 18,
      forceAtlas2Based: {
        gravitationalConstant: design.physics.gravitationalConstant,
        centralGravity: 0.006,
        springLength: design.physics.springLength,
        springConstant: 0.058,
        damping: 0.42,
        avoidOverlap: design.physics.avoidOverlap
      }
    },
    layout: {
      improvedLayout: true
    }
  }
}

interface NetworkGraphDesignPanelProps {
  design: NetworkGraphDesign
  theme: NetworkGraphTheme
  onDesignChange: (updater: (current: NetworkGraphDesign) => NetworkGraphDesign) => void
  onReset: () => void
}

interface NetworkGraphSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}

function formatSliderValue(value: number, step = 1): string {
  if (step < 1) return value.toFixed(step < 0.1 ? 2 : 1)
  return Math.round(value).toLocaleString('en-US')
}

function NetworkGraphSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: NetworkGraphSliderProps) {
  return (
    <label className="network-graph-tune-control">
      <span className="network-graph-tune-row">
        <span>{label}</span>
        <output>{formatSliderValue(value, step)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

interface NetworkGraphColorSelectProps {
  label: string
  value: string
  theme: NetworkGraphTheme
  onChange: (value: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHexColor(value: unknown): boolean {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function isTailwindColorFamily(value: string): value is TailwindColorFamily {
  return value in TAILWIND_COLORS
}

function isTailwindShade(value: number): value is TailwindShade {
  return value === 300 || value === 400 || value === 500 || value === 600 || value === 700
}

function getTailwindTokenFromClassName(value: string): string {
  const token = value.replace(/^(bg|border|text|ring|decoration|accent|from|via|to)-/, '')
  return token
}

function resolveTailwindToken(value: string): string | null {
  const token = getTailwindTokenFromClassName(value)
  const match = token.match(/^([a-z]+)-([0-9]{3})$/)
  if (!match) return null

  const [, family, shadeValue] = match
  const shade = Number(shadeValue)
  if (!isTailwindColorFamily(family) || !isTailwindShade(shade)) return null

  return TAILWIND_COLORS[family][shade]
}

function resolveGraphColor(value: string, theme: NetworkGraphTheme, fallback = '#64748b'): string {
  if (isHexColor(value)) return value.toLowerCase()

  const parts = value.trim().split(/\s+/).filter(Boolean)
  const darkToken = parts
    .find((part) => part.startsWith('dark:'))
    ?.replace(/^dark:/, '')
  const lightToken = parts.find((part) => !part.includes(':'))
  const preferredToken = theme.isDark ? darkToken || lightToken : lightToken || darkToken

  if (!preferredToken) return fallback
  return resolveTailwindToken(preferredToken) || fallback
}

function mergeDesignValue<T>(fallback: T, value: unknown): T {
  if (typeof fallback === 'number') {
    return (typeof value === 'number' && Number.isFinite(value) ? value : fallback) as T
  }

  if (typeof fallback === 'string') {
    if (fallback === 'image' || fallback === 'circularImage') {
      return (value === 'image' || value === 'circularImage' ? value : fallback) as T
    }

    return (typeof value === 'string' ? value : fallback) as T
  }

  if (isRecord(fallback)) {
    const source = isRecord(value) ? value : {}
    const merged: Record<string, unknown> = {}

    for (const key of Object.keys(fallback)) {
      merged[key] = mergeDesignValue(fallback[key], source[key])
    }

    return merged as T
  }

  return fallback
}

function mergeNetworkGraphDesignConfig(
  value: unknown,
  fallback: NetworkGraphDesign = NETWORK_GRAPH_DEFAULT_DESIGN
): NetworkGraphDesign {
  return mergeDesignValue(fallback, value)
}

function getDesignConfigText(design: NetworkGraphDesign): string {
  return JSON.stringify(design, null, 2)
}

function NetworkGraphColorSelect({
  label,
  value,
  theme,
  onChange
}: NetworkGraphColorSelectProps) {
  const resolvedColor = resolveGraphColor(value, theme)
  const hasPreset = TAILWIND_COLOR_OPTIONS.some((option) => option.value === value)

  return (
    <label className="network-graph-tune-control network-graph-tune-color-control">
      <span className="network-graph-tune-row">
        <span>{label}</span>
        <output>{value}</output>
      </span>
      <span className="network-graph-tune-swatch" style={{ background: resolvedColor }} />
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {!hasPreset && <option value={value}>custom</option>}
        {TAILWIND_COLOR_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function NetworkGraphDesignPanel({
  design,
  theme,
  onDesignChange,
  onReset
}: NetworkGraphDesignPanelProps) {
  const [configDraft, setConfigDraft] = useState(() => getDesignConfigText(design))
  const [configError, setConfigError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState('copy config')

  useEffect(() => {
    setConfigDraft(getDesignConfigText(design))
    setCopyState('copy config')
  }, [design])

  const updateNumber = (
    section: 'labels' | 'layout' | 'item' | 'media' | 'hub' | 'physics',
    key: string,
    value: number
  ) => {
    onDesignChange((current) => ({
      ...current,
      [section]: {
        ...(current[section] as Record<string, unknown>),
        [key]: value
      }
    }) as NetworkGraphDesign)
  }

  const updateMediaShape = (shape: MediaNodeShape) => {
    onDesignChange((current) => ({
      ...current,
      media: {
        ...current.media,
        shape
      }
    }))
  }

  const updateItemColor = (type: Item['type'], color: string) => {
    onDesignChange((current) => ({
      ...current,
      colors: {
        ...current.colors,
        items: {
          ...current.colors.items,
          [type]: color
        }
      }
    }))
  }

  const updateHubColor = (kind: NetworkGraphHubKind, color: string) => {
    onDesignChange((current) => ({
      ...current,
      colors: {
        ...current.colors,
        hubs: {
          ...current.colors.hubs,
          [kind]: color
        }
      }
    }))
  }

  const applyConfigDraft = () => {
    try {
      const parsed = JSON.parse(configDraft) as unknown
      const nextDesign = mergeNetworkGraphDesignConfig(parsed, design)
      setConfigError(null)
      onDesignChange(() => nextDesign)
    } catch {
      setConfigError('That config is not valid JSON yet.')
    }
  }

  const copyConfig = async () => {
    try {
      const configText = getDesignConfigText(design)
      await navigator.clipboard.writeText(configText)
      setConfigDraft(configText)
      setConfigError(null)
      setCopyState('copied')
    } catch {
      setConfigError('Clipboard copy is blocked here; select the JSON and copy it manually.')
    }
  }

  return (
    <details
      className="network-graph-tune-panel"
      open
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <summary>
        <span>graph tuning</span>
        <button
          type="button"
          className="network-graph-tune-reset"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onReset()
          }}
        >
          reset
        </button>
      </summary>

      <div className="network-graph-tune-content">
        <div className="network-graph-tune-section">
          <div className="network-graph-tune-section-title">nodes</div>
          <NetworkGraphSlider
            label="item size"
            value={design.item.maxSize}
            min={12}
            max={44}
            onChange={(value) => updateNumber('item', 'maxSize', value)}
          />
          <NetworkGraphSlider
            label="media size"
            value={design.media.size}
            min={14}
            max={82}
            onChange={(value) => updateNumber('media', 'size', value)}
          />
          <NetworkGraphSlider
            label="selected media"
            value={design.media.selectedSize}
            min={18}
            max={110}
            onChange={(value) => updateNumber('media', 'selectedSize', value)}
          />
          <NetworkGraphSlider
            label="image padding"
            value={design.media.imagePadding}
            min={0}
            max={10}
            onChange={(value) => updateNumber('media', 'imagePadding', value)}
          />
          <label className="network-graph-tune-control">
            <span className="network-graph-tune-row">
              <span>media shape</span>
            </span>
            <select
              value={design.media.shape}
              onChange={(event) => updateMediaShape(event.currentTarget.value as MediaNodeShape)}
            >
              <option value="image">image ratio</option>
              <option value="circularImage">circle crop</option>
            </select>
          </label>
        </div>

        <div className="network-graph-tune-section">
          <div className="network-graph-tune-section-title">colors</div>
          <NetworkGraphColorSelect
            label="bookmark"
            value={design.colors.items.bookmark}
            theme={theme}
            onChange={(value) => updateItemColor('bookmark', value)}
          />
          <NetworkGraphColorSelect
            label="note"
            value={design.colors.items.note}
            theme={theme}
            onChange={(value) => updateItemColor('note', value)}
          />
          <NetworkGraphColorSelect
            label="image"
            value={design.colors.items.image}
            theme={theme}
            onChange={(value) => updateItemColor('image', value)}
          />
          <NetworkGraphColorSelect
            label="wishlist"
            value={design.colors.items.wishlist}
            theme={theme}
            onChange={(value) => updateItemColor('wishlist', value)}
          />
          <NetworkGraphColorSelect
            label="tag node"
            value={design.colors.hubs.tag}
            theme={theme}
            onChange={(value) => updateHubColor('tag', value)}
          />
          <NetworkGraphColorSelect
            label="folder node"
            value={design.colors.hubs.folder}
            theme={theme}
            onChange={(value) => updateHubColor('folder', value)}
          />
          <NetworkGraphColorSelect
            label="color node fallback"
            value={design.colors.hubs.color}
            theme={theme}
            onChange={(value) => updateHubColor('color', value)}
          />
          <p className="network-graph-tune-note">
            Values are Tailwind-style tokens, for example blue-600 dark:blue-400. Color hubs still use each item color when available.
          </p>
        </div>

        <div className="network-graph-tune-section">
          <div className="network-graph-tune-section-title">hubs</div>
          <NetworkGraphSlider
            label="tag hub"
            value={design.hub.tagBaseSize}
            min={8}
            max={34}
            onChange={(value) => updateNumber('hub', 'tagBaseSize', value)}
          />
          <NetworkGraphSlider
            label="folder hub"
            value={design.hub.folderBaseSize}
            min={8}
            max={34}
            onChange={(value) => updateNumber('hub', 'folderBaseSize', value)}
          />
          <NetworkGraphSlider
            label="color hub"
            value={design.hub.colorBaseSize}
            min={8}
            max={40}
            onChange={(value) => updateNumber('hub', 'colorBaseSize', value)}
          />
          <NetworkGraphSlider
            label="hub max"
            value={design.hub.maxSize}
            min={18}
            max={58}
            onChange={(value) => updateNumber('hub', 'maxSize', value)}
          />
        </div>

        <div className="network-graph-tune-section">
          <div className="network-graph-tune-section-title">layout</div>
          <NetworkGraphSlider
            label="graph spacing"
            value={design.physics.springLength}
            min={40}
            max={260}
            onChange={(value) => updateNumber('physics', 'springLength', value)}
          />
          <NetworkGraphSlider
            label="avoid overlap"
            value={design.physics.avoidOverlap}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => updateNumber('physics', 'avoidOverlap', value)}
          />
          <NetworkGraphSlider
            label="pull strength"
            value={Math.abs(design.physics.gravitationalConstant)}
            min={10}
            max={180}
            onChange={(value) => updateNumber('physics', 'gravitationalConstant', -value)}
          />
          <NetworkGraphSlider
            label="item label"
            value={design.labels.itemMaxLength}
            min={8}
            max={52}
            onChange={(value) => updateNumber('labels', 'itemMaxLength', value)}
          />
        </div>

        <div className="network-graph-tune-section">
          <div className="network-graph-tune-section-title">config</div>
          <textarea
            className="network-graph-tune-config"
            value={configDraft}
            rows={7}
            spellCheck={false}
            onChange={(event) => {
              setConfigDraft(event.currentTarget.value)
              setConfigError(null)
            }}
          />
          <div className="network-graph-tune-actions">
            <button type="button" onClick={copyConfig}>{copyState}</button>
            <button type="button" onClick={applyConfigDraft}>apply</button>
          </div>
          {configError && <div className="network-graph-tune-error">{configError}</div>}
        </div>
      </div>
    </details>
  )
}

interface NetworkGraphDetailPanelProps {
  item: Item
  design: NetworkGraphDesign
  motionKey: number
  motionPhase: DetailPanelMotionPhase
  onClose: () => void
  onMediaEnlarge: (data: NetworkGraphLightboxData) => void
  onExitComplete: () => void
}

function NetworkGraphDetailPanel({
  item,
  design,
  motionKey,
  motionPhase,
  onClose,
  onMediaEnlarge,
  onExitComplete
}: NetworkGraphDetailPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const mediaRef = useRef<HTMLImageElement>(null)
  const motionControlsRef = useRef<ReturnType<typeof animate> | null>(null)
  const mediaSrc = getItemMediaSrc(item, design)
  const lightboxMedia = getItemLightboxMedia(item)
  const savedDate = formatGraphDetailDate(item.created_at)
  const meta = [item.type, getItemMeta(item), savedDate].filter(Boolean)
  const tags = (item.tags || []).slice(0, 4)
  const extraTagCount = Math.max(0, (item.tags?.length || 0) - tags.length)

  const openSourceUrl = async () => {
    if (!item.url) return

    try {
      await window.desktopAPI.system.openUrl(item.url)
    } catch {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  const openMediaLightbox = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const sourceElement = mediaRef.current
    const sourceRect = sourceElement?.getBoundingClientRect()
    if (!sourceElement || !sourceRect || !lightboxMedia) return

    onMediaEnlarge({
      ...lightboxMedia,
      rect: sourceRect,
      element: sourceElement,
      sourceRadiusPx: getElementCornerRadiusPx(sourceElement)
    })
  }

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    motionControlsRef.current?.stop?.()

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.style.opacity = motionPhase === 'exit' ? '0' : ''
      panel.style.transform = ''
      if (motionPhase === 'exit') onExitComplete()
      return
    }

    const keyframes =
      motionPhase === 'exit'
        ? {
            opacity: [1, 0],
            transform: ['translateY(0px) scale(1)', 'translateY(6px) scale(0.985)']
          }
        : motionPhase === 'change'
          ? {
              opacity: [0.78, 1],
              transform: ['translateY(4px) scale(0.992)', 'translateY(0px) scale(1)']
            }
          : {
              opacity: [0, 1],
              transform: ['translateY(10px) scale(0.975)', 'translateY(0px) scale(1)']
            }

    const controls = animate(panel, keyframes, {
      duration:
        motionPhase === 'exit'
          ? DETAIL_PANEL_EXIT_MS / 1000
          : motionPhase === 'change'
            ? DETAIL_PANEL_CHANGE_MS / 1000
            : DETAIL_PANEL_ENTER_MS / 1000,
      ease:
        motionPhase === 'exit'
          ? DETAIL_PANEL_EXIT_EASE
          : motionPhase === 'change'
            ? DETAIL_PANEL_CHANGE_EASE
            : DETAIL_PANEL_ENTER_EASE
    })
    motionControlsRef.current = controls

    controls.then(() => {
      if (motionControlsRef.current !== controls) return

      motionControlsRef.current = null
      if (motionPhase === 'exit') {
        onExitComplete()
        return
      }

      panel.style.opacity = ''
      panel.style.transform = ''
    })

    return () => {
      controls.stop?.()
      if (motionControlsRef.current === controls) motionControlsRef.current = null
    }
  }, [motionKey, motionPhase, onExitComplete])

  return (
    <aside
      ref={panelRef}
      className="network-graph-detail-panel"
      aria-label="selected graph item"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="network-graph-detail-actions" aria-label="detail actions">
        {item.url && (
          <button type="button" onClick={openSourceUrl} aria-label="open source">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14 5h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="close detail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {mediaSrc && (
        <div className="network-graph-detail-media">
          <img ref={mediaRef} src={mediaSrc} alt="" loading="lazy" draggable={false} />
          {lightboxMedia && (
            <button
              type="button"
              className="network-graph-detail-enlarge"
              aria-label="enlarge media"
              onClick={openMediaLightbox}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M14 5h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 5l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M10 19H5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 19l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
    )}

    <div className="network-graph-detail-body">
      <div className="network-graph-detail-title">{getItemLabel(item)}</div>

      <div className="network-graph-detail-kicker">
        {meta.map((entry) => (
          <span key={entry}>{entry}</span>
        ))}
      </div>

      {(tags.length > 0 || item.price || item.store_name) && (
        <div className="network-graph-detail-pills">
            {item.price && <span>{item.price}</span>}
            {item.store_name && <span>{item.store_name}</span>}
            {tags.map((tag) => (
              <span key={tag.id}>#{tag.name}</span>
            ))}
            {extraTagCount > 0 && <span>+{extraTagCount}</span>}
          </div>
        )}
      </div>
    </aside>
  )
}

interface NetworkGraphLightboxProps {
  data: NetworkGraphLightboxData
  returnMotion: NetworkGraphReturnMotion
  onClose: () => void
}

function getNetworkGraphLightboxStyle(rect: DOMRect, phase: 'opening' | 'open' | 'closing'): CSSProperties {
  const geometry = computeLightboxGeometry(rect)

  return {
    left: `${geometry.targetX}px`,
    top: `${geometry.targetY}px`,
    width: `${geometry.targetW}px`,
    height: `${geometry.targetH}px`,
    transform: getLightboxTransform(geometry),
    transformOrigin: 'center center',
    ...(phase === 'open'
      ? {
          transition:
            'left 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1)'
        }
      : {})
  }
}

function NetworkGraphLightbox({ data, returnMotion, onClose }: NetworkGraphLightboxProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null)
  const animationRef = useRef<ReturnType<typeof animateLightboxFrame> | null>(null)
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>('opening')
  const [videoReady, setVideoReady] = useState(data.kind !== 'video')
  const [videoControlsVisible, setVideoControlsVisible] = useState(false)
  const [intrinsicRect, setIntrinsicRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    setPhase('opening')
    setVideoReady(data.kind !== 'video')
    setVideoControlsVisible(false)
    setIntrinsicRect(null)
  }, [data.kind, data.src])

  useEffect(() => {
    return () => {
      setLightboxSourceHidden(data.element, false)
    }
  }, [data.element])

  const resolveLightboxRect = useCallback(() => {
    const media = mediaRef.current

    if ((phase === 'open' || phase === 'closing') && media) {
      if (media instanceof HTMLVideoElement && media.videoWidth && media.videoHeight) {
        return new DOMRect(data.rect.x, data.rect.y, media.videoWidth, media.videoHeight)
      }

      if (media instanceof HTMLImageElement && media.naturalWidth && media.naturalHeight) {
        return new DOMRect(data.rect.x, data.rect.y, media.naturalWidth, media.naturalHeight)
      }
    }

    return intrinsicRect || data.rect
  }, [data.rect, intrinsicRect, phase])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    let cancelled = false
    animationRef.current?.stop?.()
    setLightboxSourceHidden(data.element, true)
    const controls = animateLightboxFrame(frame, computeLightboxGeometry(data.rect), 'open', {
      sourceRadiusPx: data.sourceRadiusPx
    })
    animationRef.current = controls

    controls.then(() => {
      if (cancelled) return
      animationRef.current = null
      setPhase('open')
    })

    return () => {
      cancelled = true
      controls.stop?.()
      if (animationRef.current === controls) animationRef.current = null
    }
  }, [data.element, data.rect, data.sourceRadiusPx, data.src])

  const closeLightbox = useCallback(() => {
    if (phase === 'closing') return

    const frame = frameRef.current
    setPhase('closing')
    setVideoControlsVisible(false)

    if (!frame) {
      setLightboxSourceHidden(data.element, false)
      onClose()
      return
    }

    animationRef.current?.stop?.()
    const controls = animateLightboxFrame(frame, computeLightboxGeometry(data.rect), 'close', {
      closeDurationMs: returnMotion.lightboxCloseDurationMs,
      closeEase: returnMotion.lightboxCloseEase,
      sourceRadiusPx: data.sourceRadiusPx
    })
    animationRef.current = controls
    controls.then(() => {
      animationRef.current = null
      setLightboxSourceHidden(data.element, false)
      onClose()
    })
  }, [data.element, data.rect, data.sourceRadiusPx, onClose, phase, returnMotion])

  const handleOverlayClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    closeLightbox()
  }, [closeLightbox])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeLightbox])

  const overlayClassName = [
    'lightbox-overlay',
    phase ? 'is-active' : '',
    phase !== 'closing' ? 'is-visible' : '',
    phase === 'open' ? 'is-settled' : ''
  ].filter(Boolean).join(' ')

  const lightboxRect = resolveLightboxRect()

  return (
    <div
      className={overlayClassName}
      onClick={handleOverlayClick}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="lightbox-backdrop" />
      {data.kind === 'video' ? (
        <div
          ref={frameRef}
          className="lightbox-img lightbox-img--video"
          style={{
            ...getNetworkGraphLightboxStyle(lightboxRect, phase),
            ...(data.posterSrc ? { backgroundImage: `url("${data.posterSrc}")` } : {})
          }}
          onClick={(event) => event.stopPropagation()}
          onMouseMove={() => setVideoControlsVisible(true)}
          onMouseLeave={() => setVideoControlsVisible(false)}
        >
          {data.posterSrc && (
            <img
              className={`lightbox-media lightbox-media-poster${videoReady ? ' is-hidden' : ''}`}
              src={data.posterSrc}
              alt=""
              draggable={false}
            />
          )}
          <video
            key={data.src}
            ref={(node) => {
              mediaRef.current = node
            }}
            className={`lightbox-media lightbox-media--video${videoReady ? '' : ' is-hidden'}`}
            src={data.src}
            preload="auto"
            controls={videoControlsVisible}
            controlsList="nodownload noremoteplayback nofullscreen"
            muted
            loop
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              if (video.videoWidth && video.videoHeight) {
                setIntrinsicRect(new DOMRect(data.rect.x, data.rect.y, video.videoWidth, video.videoHeight))
              }
            }}
            onLoadedData={() => setVideoReady(true)}
          />
        </div>
      ) : (
        <div
          ref={frameRef}
          className="lightbox-img"
          style={getNetworkGraphLightboxStyle(lightboxRect, phase)}
          onClick={(event) => event.stopPropagation()}
        >
          <img
            ref={(node) => {
              mediaRef.current = node
            }}
            className="lightbox-media"
            src={data.src}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth && image.naturalHeight) {
                setIntrinsicRect(new DOMRect(data.rect.x, data.rect.y, image.naturalWidth, image.naturalHeight))
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

export function NetworkGraph({
  items,
  selectedId,
  loading,
  onSelect,
  onFolderSelect,
  onTagSelect,
  onColorSelect,
  onLightboxChange,
  dismissLightbox
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const nodesRef = useRef<DataSet<NetworkVisNode, 'id'> | null>(null)
  const edgesRef = useRef<DataSet<NetworkVisEdge, 'id'> | null>(null)
  const selectedIdRef = useRef(selectedId)
  const selectedNodeIdRef = useRef<string | null>(selectedId ? getNetworkItemNodeId(selectedId) : null)
  const itemByNodeIdRef = useRef(new Map<string, Item>())
  const hubByNodeIdRef = useRef(new Map<string, NetworkGraphHubNode>())
  const onSelectRef = useRef(onSelect)
  const onFolderSelectRef = useRef(onFolderSelect)
  const onTagSelectRef = useRef(onTagSelect)
  const onColorSelectRef = useRef(onColorSelect)
  const fitTimeoutRef = useRef<number | null>(null)
  const selectedFitTimeoutRef = useRef<number | null>(null)
  const pendingFocusNodeIdRef = useRef<string | null>(null)
  const revealAnimationFrameRef = useRef<number | null>(null)
  const detailPanelMotionKeyRef = useRef(0)
  const nodeVisualStateRef = useRef(new Map<string, GraphNodeVisualState>())
  const edgeVisualStateRef = useRef(new Map<string, GraphEdgeVisualState>())
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [design, setDesign] = useState<NetworkGraphDesign>(NETWORK_GRAPH_DEFAULT_DESIGN)
  const [detailLightbox, setDetailLightbox] = useState<NetworkGraphLightboxData | null>(null)
  const [detailPanelState, setDetailPanelState] = useState<DetailPanelRenderState | null>(null)
  const theme = useNetworkGraphTheme()
  const graph = useMemo(() => deriveNetworkGraph(items, selectedId), [items, selectedId])
  const scopeKey = useMemo(() => graph.nodes.map((node) => node.id).join('|'), [graph.nodes])
  const edgeScopeKey = useMemo(() => graph.edges.map((edge) => edge.id).join('|'), [graph.edges])
  const selectedNodeId = selectedId ? getNetworkItemNodeId(selectedId) : null
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) || null : null
  const returnMotion = NETWORK_GRAPH_RETURN_MOTION

  selectedIdRef.current = selectedId
  selectedNodeIdRef.current = selectedNodeId
  onSelectRef.current = onSelect
  onFolderSelectRef.current = onFolderSelect
  onTagSelectRef.current = onTagSelect
  onColorSelectRef.current = onColorSelect

  const visNodes = useMemo(
    () => graph.nodes.map((node) => toVisNode(node, theme, design)),
    [design, graph.nodes, theme]
  )
  const visEdges = useMemo(
    () => graph.edges.map((edge) => toVisEdge(edge, theme)),
    [graph.edges, theme]
  )

  useEffect(() => {
    itemByNodeIdRef.current = new Map(
      graph.itemNodes.map((node) => [node.id, node.item])
    )
    hubByNodeIdRef.current = new Map(
      graph.hubNodes.map((node) => [node.id, node])
    )
  }, [graph.hubNodes, graph.itemNodes])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const nodes = new DataSet<NetworkVisNode, 'id'>([])
    const edges = new DataSet<NetworkVisEdge, 'id'>([])
    const network = new Network(container, { nodes, edges }, getNetworkOptions(theme, design))

    nodesRef.current = nodes
    edgesRef.current = edges
    networkRef.current = network

    const handleHoverNode = (params?: NetworkEventParams) => {
      const nodeId = getNodeIdFromParams(params, network)
      if (!nodeId) return
      const lockedNodeId = selectedNodeIdRef.current
      if (lockedNodeId && nodeId !== lockedNodeId) return
      setActiveNodeId(nodeId)
    }

    const handleBlurNode = (params?: NetworkEventParams) => {
      const nodeId = getNodeIdFromParams(params, network)
      if (selectedNodeIdRef.current) return
      if (!nodeId) {
        setActiveNodeId(null)
        return
      }
      setActiveNodeId((current) => (current === nodeId ? null : current))
    }

    const handleSelectNode = (params?: NetworkEventParams) => {
      const nodeId = getNodeIdFromParams(params, network)
      if (!nodeId) return
      if (selectedIdRef.current) return
      setActiveNodeId(nodeId)
    }

    const handleDeselectNode = () => {
      if (!selectedIdRef.current) setActiveNodeId(null)
    }

    const handleClick = (params?: NetworkEventParams) => {
      const nodeId = getNodeIdFromParams(params, network)

      if (selectedIdRef.current) {
        const currentSelectedNodeId = selectedNodeIdRef.current

        if (nodeId && nodeId !== currentSelectedNodeId) {
          const nextItem = itemByNodeIdRef.current.get(nodeId)
          if (nextItem) {
            network.selectNodes([nodeId], false)
            setActiveNodeId(nodeId)
            onSelectRef.current(nextItem)
            return
          }

          if (hubByNodeIdRef.current.has(nodeId)) {
            pendingFocusNodeIdRef.current = nodeId
            network.selectNodes([nodeId], false)
            setActiveNodeId(nodeId)
            onSelectRef.current(null)
            return
          }
        }

        onSelectRef.current(null)
        network.unselectAll()
        setActiveNodeId(null)
        return
      }

      if (!nodeId) {
        network.unselectAll()
        setActiveNodeId(null)
        return
      }

      const item = itemByNodeIdRef.current.get(nodeId)
      if (item) {
        onSelectRef.current(item)
        return
      }

      const hub = hubByNodeIdRef.current.get(nodeId)
      if (!hub) return

      network.unselectAll()
      setActiveNodeId(null)
      if (hub.hubKind === 'folder') onFolderSelectRef.current(hub.value)
      if (hub.hubKind === 'tag') onTagSelectRef.current(hub.value)
      if (hub.hubKind === 'color') onColorSelectRef.current(hub.value)
    }

    network.on('hoverNode', handleHoverNode)
    network.on('blurNode', handleBlurNode)
    network.on('selectNode', handleSelectNode)
    network.on('deselectNode', handleDeselectNode)
    network.on('click', handleClick)

    return () => {
      if (fitTimeoutRef.current) window.clearTimeout(fitTimeoutRef.current)
      if (selectedFitTimeoutRef.current) window.clearTimeout(selectedFitTimeoutRef.current)
      if (revealAnimationFrameRef.current) window.cancelAnimationFrame(revealAnimationFrameRef.current)
      network.off('hoverNode', handleHoverNode)
      network.off('blurNode', handleBlurNode)
      network.off('selectNode', handleSelectNode)
      network.off('deselectNode', handleDeselectNode)
      network.off('click', handleClick)
      network.destroy()
      networkRef.current = null
      nodesRef.current = null
      edgesRef.current = null
    }
  }, [])

  useEffect(() => {
    networkRef.current?.setOptions(getNetworkOptions(theme, design))
    networkRef.current?.startSimulation()
  }, [design, theme])

  useEffect(() => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const network = networkRef.current
    if (!nodes || !edges || !network) return

    reconcileNodeDataSet(nodes, visNodes)
    reconcileEdgeDataSet(edges, visEdges)
    network.startSimulation()
  }, [visEdges, visNodes])

  useEffect(() => {
    const network = networkRef.current
    const nodes = nodesRef.current
    if (!network || !nodes) return

    if (selectedNodeId && nodes.get(selectedNodeId)) {
      pendingFocusNodeIdRef.current = null
      setActiveNodeId(null)
      network.selectNodes([selectedNodeId], false)
    } else {
      const pendingFocusNodeId = pendingFocusNodeIdRef.current
      pendingFocusNodeIdRef.current = null

      if (pendingFocusNodeId && nodes.get(pendingFocusNodeId)) {
        network.selectNodes([pendingFocusNodeId], false)
        setActiveNodeId(pendingFocusNodeId)
        return
      }

      network.unselectAll()
      setActiveNodeId(null)
    }
  }, [selectedNodeId, scopeKey])

  useEffect(() => {
    const network = networkRef.current
    if (!network || graph.nodes.length === 0 || selectedNodeId) return
    if (fitTimeoutRef.current) window.clearTimeout(fitTimeoutRef.current)

    fitTimeoutRef.current = window.setTimeout(() => {
      network.fit({
        animation: { duration: 420, easingFunction: 'easeInOutQuad' },
        minZoomLevel: SCOPE_FIT_MIN_ZOOM,
        maxZoomLevel: SCOPE_FIT_MAX_ZOOM
      })
      network.startSimulation()
      fitTimeoutRef.current = null
    }, design.fitDelayMs)

    return () => {
      if (fitTimeoutRef.current) {
        window.clearTimeout(fitTimeoutRef.current)
        fitTimeoutRef.current = null
      }
    }
  }, [design.fitDelayMs, graph.nodes.length, scopeKey, selectedNodeId])

  useEffect(() => {
    const network = networkRef.current
    const nodes = nodesRef.current
    if (!network || !nodes || !selectedNodeId) return

    if (selectedFitTimeoutRef.current) window.clearTimeout(selectedFitTimeoutRef.current)

    selectedFitTimeoutRef.current = window.setTimeout(() => {
      const focusNodeIds = getNeighborhoodNodeIds(network, nodes, selectedNodeId)
      if (focusNodeIds.length === 0) {
        selectedFitTimeoutRef.current = null
        return
      }

      network.fit({
        nodes: focusNodeIds,
        animation: { duration: 360, easingFunction: 'easeInOutQuad' },
        minZoomLevel: SELECTED_FIT_MIN_ZOOM,
        maxZoomLevel: SELECTED_FIT_MAX_ZOOM
      })
      network.startSimulation()
      selectedFitTimeoutRef.current = null
    }, Math.max(24, Math.min(design.fitDelayMs, 80)))

    return () => {
      if (selectedFitTimeoutRef.current) {
        window.clearTimeout(selectedFitTimeoutRef.current)
        selectedFitTimeoutRef.current = null
      }
    }
  }, [design.fitDelayMs, edgeScopeKey, selectedNodeId, scopeKey])

  useEffect(() => {
    const network = networkRef.current
    const nodes = nodesRef.current
    const edges = edgesRef.current
    if (!network || !nodes || !edges) return

    const revealNodeId = selectedNodeId || activeNodeId
    const relatedNodeIds = new Set<string>()
    const relatedEdgeIds = new Set<string>()

    if (revealNodeId && nodes.get(revealNodeId)) {
      relatedNodeIds.add(revealNodeId)
      for (const rawNodeId of network.getConnectedNodes(revealNodeId)) {
        if (typeof rawNodeId === 'string' || typeof rawNodeId === 'number') {
          relatedNodeIds.add(String(rawNodeId))
        }
      }
      for (const rawEdgeId of network.getConnectedEdges(revealNodeId)) {
        if (typeof rawEdgeId === 'string' || typeof rawEdgeId === 'number') {
          relatedEdgeIds.add(String(rawEdgeId))
        }
      }
    }

    const hasRevealFocus = relatedNodeIds.size > 0
    const targetNodeStates = new Map<string, GraphNodeVisualState>()
    const targetEdgeStates = new Map<string, GraphEdgeVisualState>()
    const nodeVisualTargets = graph.nodes.map((node) => {
      const related = !hasRevealFocus || relatedNodeIds.has(node.id)
      const active = revealNodeId === node.id
      const opacity = related ? 1 : node.kind === 'item' && getItemMediaSrc(node.item, design) ? 0.08 : 0.13
      const state = {
        opacity,
        fontSize: getNodeFontSize(node) + (active ? ACTIVE_LABEL_SIZE_BOOST : 0),
        labelVAdjust: active ? ACTIVE_LABEL_VADJUST : 0
      }
      const shadow = active
        ? {
            enabled: true,
            color: theme.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.2)',
            size: 16,
            x: 0,
            y: 4
          }
        : false

      targetNodeStates.set(node.id, state)

      return {
        node,
        state,
        shadow
      }
    })

    const edgeVisualTargets = graph.edges.map((edge) => {
      const related = !hasRevealFocus || relatedEdgeIds.has(edge.id)
      const opacity = related ? (edge.relation === 'color' ? 0.5 : 0.42) : 0.035
      const state = {
        opacity,
        width: related ? 1.45 : 0.75
      }

      targetEdgeStates.set(edge.id, state)

      return { edge, state }
    })

    if (revealAnimationFrameRef.current) {
      window.cancelAnimationFrame(revealAnimationFrameRef.current)
      revealAnimationFrameRef.current = null
    }

    const fromNodeStates = new Map<string, GraphNodeVisualState>()
    for (const [nodeId, target] of targetNodeStates) {
      fromNodeStates.set(nodeId, nodeVisualStateRef.current.get(nodeId) || target)
    }

    const fromEdgeStates = new Map<string, GraphEdgeVisualState>()
    for (const [edgeId, target] of targetEdgeStates) {
      fromEdgeStates.set(edgeId, edgeVisualStateRef.current.get(edgeId) || target)
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startedAt = performance.now()

    const applyVisualProgress = (progress: number) => {
      const nextNodeStates = new Map<string, GraphNodeVisualState>()
      const nextEdgeStates = new Map<string, GraphEdgeVisualState>()

      const nodeUpdates = nodeVisualTargets.map(({ node, state: target, shadow }) => {
        const from = fromNodeStates.get(node.id) || target
        const opacity = lerp(from.opacity, target.opacity, progress)
        const fontSize = lerp(from.fontSize, target.fontSize, progress)
        const labelVAdjust = lerp(from.labelVAdjust, target.labelVAdjust, progress)

        nextNodeStates.set(node.id, { opacity, fontSize, labelVAdjust })

        return {
          id: node.id,
          opacity,
          font: getNodeFont(node, theme, opacity, fontSize, labelVAdjust),
          color: getNodeColor(node, theme, design),
          borderWidth: 0,
          shadow
        }
      })

      const edgeUpdates = edgeVisualTargets.map(({ edge, state: target }) => {
        const from = fromEdgeStates.get(edge.id) || target
        const opacity = lerp(from.opacity, target.opacity, progress)
        const width = lerp(from.width, target.width, progress)

        nextEdgeStates.set(edge.id, { opacity, width })

        return {
          id: edge.id,
          color: getEdgeColor(edge, theme, opacity),
          width
        }
      })

      nodeVisualStateRef.current = nextNodeStates
      edgeVisualStateRef.current = nextEdgeStates
      nodes.update(nodeUpdates)
      edges.update(edgeUpdates)
      network.redraw()
    }

    if (reduceMotion) {
      applyVisualProgress(1)
      return
    }

    const tick = (now: number) => {
      const elapsed = now - startedAt
      const progress = Math.min(1, elapsed / REVEAL_ANIMATION_MS)
      applyVisualProgress(easeOutCubic(progress))

      if (progress < 1) {
        revealAnimationFrameRef.current = window.requestAnimationFrame(tick)
      } else {
        revealAnimationFrameRef.current = null
      }
    }

    revealAnimationFrameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (revealAnimationFrameRef.current) {
        window.cancelAnimationFrame(revealAnimationFrameRef.current)
        revealAnimationFrameRef.current = null
      }
    }
  }, [activeNodeId, design, graph.edges, graph.nodes, selectedNodeId, theme])

  useLayoutEffect(() => {
    setDetailPanelState((current) => {
      if (selectedItem) {
        if (current && current.item.id === selectedItem.id && current.motionPhase !== 'exit') {
          return current.item === selectedItem ? current : { ...current, item: selectedItem }
        }

        const nextMotionKey = detailPanelMotionKeyRef.current + 1
        detailPanelMotionKeyRef.current = nextMotionKey

        return {
          item: selectedItem,
          motionKey: nextMotionKey,
          motionPhase: current && current.motionPhase !== 'exit' ? 'change' : 'enter'
        }
      }

      if (!current || current.motionPhase === 'exit') return current

      const nextMotionKey = detailPanelMotionKeyRef.current + 1
      detailPanelMotionKeyRef.current = nextMotionKey

      return {
        ...current,
        motionKey: nextMotionKey,
        motionPhase: 'exit'
      }
    })
  }, [selectedItem])

  const clearSelected = useCallback(() => {
    onSelect(null)
    networkRef.current?.unselectAll()
    setActiveNodeId(null)
  }, [onSelect])

  const openDetailLightbox = useCallback((data: NetworkGraphLightboxData) => {
    setDetailLightbox(data)
    onLightboxChange?.(true)
  }, [onLightboxChange])

  const closeDetailLightbox = useCallback(() => {
    setDetailLightbox(null)
    onLightboxChange?.(false)
  }, [onLightboxChange])

  const handleDetailPanelExitComplete = useCallback(() => {
    setDetailPanelState((current) => (current?.motionPhase === 'exit' ? null : current))
  }, [])

  useEffect(() => {
    if (!dismissLightbox || !detailLightbox) return
    closeDetailLightbox()
  }, [closeDetailLightbox, detailLightbox, dismissLightbox])

  if (!loading && items.length === 0) {
    return (
      <div className="network-graph network-graph--empty">
        <div className="network-graph-empty-card">
          <div className="network-graph-empty-title">network is quiet</div>
          <div className="network-graph-empty-copy">Add a note, image, bookmark, or wishlist item to start seeing relationships.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="network-graph">
      <div className="network-graph-status" aria-live="polite">
        <span>current scope</span>
        <span>{formatCountLabel(items.length)} items</span>
        {graph.hubNodes.length > 0 && <span>{formatCountLabel(graph.hubNodes.length)} hubs</span>}
      </div>

      <div className="network-graph-stage" ref={containerRef} />

      {loading && items.length === 0 && (
        <div className="network-graph-loading">mapping vault</div>
      )}

      {detailPanelState ? (
        <NetworkGraphDetailPanel
          item={detailPanelState.item}
          design={design}
          motionKey={detailPanelState.motionKey}
          motionPhase={detailPanelState.motionPhase}
          onClose={clearSelected}
          onMediaEnlarge={openDetailLightbox}
          onExitComplete={handleDetailPanelExitComplete}
        />
      ) : selectedId && (
        <button type="button" className="network-graph-clear-selection" onClick={clearSelected}>
          clear selection
        </button>
      )}

      {detailLightbox && (
        <NetworkGraphLightbox
          data={detailLightbox}
          returnMotion={returnMotion}
          onClose={closeDetailLightbox}
        />
      )}

    </div>
  )
}
