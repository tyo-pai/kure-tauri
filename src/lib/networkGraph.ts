import type { Item } from '../types'
import { normalizeHex } from './colorMatch'

export type NetworkGraphHubKind = 'tag' | 'folder' | 'color'

export interface NetworkGraphItemNode {
  id: string
  kind: 'item'
  itemId: string
  item: Item
  selected: boolean
  connectionCount: number
  layoutIndex: number
}

export interface NetworkGraphHubNode {
  id: string
  kind: 'hub'
  hubKind: NetworkGraphHubKind
  value: string
  label: string
  count: number
  itemIds: string[]
  color?: string
  forced: boolean
}

export type NetworkGraphNode = NetworkGraphItemNode | NetworkGraphHubNode

export interface NetworkGraphEdge {
  id: string
  source: string
  target: string
  relation: NetworkGraphHubKind
  itemId: string
  color?: string
}

export interface NetworkGraphData {
  nodes: NetworkGraphNode[]
  itemNodes: NetworkGraphItemNode[]
  hubNodes: NetworkGraphHubNode[]
  edges: NetworkGraphEdge[]
  renderedItemIds: Set<string>
}

interface HubBucket {
  kind: NetworkGraphHubKind
  value: string
  label: string
  color?: string
  itemIds: Set<string>
  forced: boolean
}

export function getNetworkItemNodeId(itemId: string): string {
  return `item:${itemId}`
}

export function getNetworkHubNodeId(kind: NetworkGraphHubKind, value: string): string {
  return `hub:${kind}:${encodeURIComponent(value)}`
}

function getItemTime(item: Item): number {
  const updatedAt = new Date(item.updated_at || item.created_at).getTime()
  if (Number.isFinite(updatedAt)) return updatedAt
  const createdAt = new Date(item.created_at).getTime()
  return Number.isFinite(createdAt) ? createdAt : 0
}

function getFolderValue(item: Item): string | null {
  return item.folder || null
}

function getFolderLabel(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() || folder
}

function getColorLabel(hex: string, items: Item[]): string {
  for (const item of items) {
    const match = item.colors?.find((color) => normalizeHex(color.hex) === hex)
    if (match?.name) return match.name
  }
  return hex
}

function addBucket(
  buckets: Map<string, HubBucket>,
  kind: NetworkGraphHubKind,
  value: string,
  itemId: string,
  forced: boolean,
  options?: { label?: string; color?: string }
) {
  const id = getNetworkHubNodeId(kind, value)
  const existing = buckets.get(id)
  if (existing) {
    existing.itemIds.add(itemId)
    existing.forced ||= forced
    return
  }

  buckets.set(id, {
    kind,
    value,
    label: options?.label || value,
    color: options?.color,
    itemIds: new Set([itemId]),
    forced
  })
}

function getScopedItems(items: Item[]): Item[] {
  const seen = new Set<string>()
  const scopedItems: Item[] = []

  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    scopedItems.push(item)
  }

  return scopedItems
}

export function deriveNetworkGraph(items: Item[], selectedId: string | null): NetworkGraphData {
  const scopedItems = getScopedItems(items)
  const renderedItemIds = new Set(scopedItems.map((item) => item.id))
  const layoutIndexByItemId = new Map(
    [...scopedItems]
      .sort((a, b) => getItemTime(b) - getItemTime(a) || a.id.localeCompare(b.id))
      .map((item, index) => [item.id, index])
  )
  const buckets = new Map<string, HubBucket>()

  for (const item of scopedItems) {
    const forced = selectedId === item.id
    const folder = getFolderValue(item)
    if (folder) {
      addBucket(buckets, 'folder', folder, item.id, forced, { label: getFolderLabel(folder) })
    }

    for (const tag of item.tags || []) {
      if (tag.name) addBucket(buckets, 'tag', tag.name, item.id, forced)
    }

    for (const color of item.colors || []) {
      if (!color.hex) continue
      const hex = normalizeHex(color.hex)
      addBucket(buckets, 'color', hex, item.id, forced, {
        label: color.name || hex,
        color: hex
      })
    }
  }

  const hubNodes: NetworkGraphHubNode[] = [...buckets.entries()]
    .filter(([, bucket]) => bucket.kind !== 'color' || bucket.forced || bucket.itemIds.size >= 2)
    .map(([id, bucket]) => ({
      id,
      kind: 'hub' as const,
      hubKind: bucket.kind,
      value: bucket.value,
      label: bucket.kind === 'color' ? getColorLabel(bucket.value, scopedItems) : bucket.label,
      count: bucket.itemIds.size,
      itemIds: [...bucket.itemIds],
      color: bucket.color,
      forced: bucket.forced
    }))
    .sort((a, b) => {
      if (a.hubKind !== b.hubKind) {
        const order: Record<NetworkGraphHubKind, number> = { tag: 0, folder: 1, color: 2 }
        return order[a.hubKind] - order[b.hubKind]
      }
      return b.count - a.count || a.label.localeCompare(b.label)
    })

  const hubNodeIds = new Set(hubNodes.map((node) => node.id))
  const itemConnectionCounts = new Map<string, number>()
  const edgeIds = new Set<string>()
  const edges: NetworkGraphEdge[] = []

  const connect = (item: Item, kind: NetworkGraphHubKind, value: string, color?: string) => {
    const hubId = getNetworkHubNodeId(kind, value)
    if (!hubNodeIds.has(hubId)) return
    const itemNodeId = getNetworkItemNodeId(item.id)
    const edgeId = `${itemNodeId}->${hubId}`
    if (edgeIds.has(edgeId)) return
    edgeIds.add(edgeId)
    edges.push({
      id: edgeId,
      source: itemNodeId,
      target: hubId,
      relation: kind,
      itemId: item.id,
      color
    })
    itemConnectionCounts.set(item.id, (itemConnectionCounts.get(item.id) || 0) + 1)
  }

  for (const item of scopedItems) {
    const folder = getFolderValue(item)
    if (folder) connect(item, 'folder', folder)
    for (const tag of item.tags || []) {
      if (tag.name) connect(item, 'tag', tag.name)
    }
    for (const color of item.colors || []) {
      if (color.hex) {
        const hex = normalizeHex(color.hex)
        connect(item, 'color', hex, hex)
      }
    }
  }

  const itemNodes = scopedItems.map((item) => ({
    id: getNetworkItemNodeId(item.id),
    kind: 'item' as const,
    itemId: item.id,
    item,
    selected: selectedId === item.id,
    connectionCount: itemConnectionCounts.get(item.id) || 0,
    layoutIndex: layoutIndexByItemId.get(item.id) || 0
  }))

  return {
    nodes: [...itemNodes, ...hubNodes],
    itemNodes,
    hubNodes,
    edges,
    renderedItemIds
  }
}
