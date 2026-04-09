import type { Item } from '../types'

interface AssetUrlOptions {
  width?: number
}

function joinVaultRelativePath(folderPath: string | null, assetPath: string): string {
  const normalizedAssetPath = assetPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return folderPath ? `${folderPath}/${normalizedAssetPath}` : normalizedAssetPath
}

export function getItemAssetUrl(
  item: Pick<Item, 'thumbnail' | 'folder_path'>,
  options?: AssetUrlOptions
): string | null {
  if (!item.thumbnail) return null
  if (item.thumbnail.startsWith('http://') || item.thumbnail.startsWith('https://')) {
    return item.thumbnail
  }

  const relativePath = joinVaultRelativePath(item.folder_path, item.thumbnail)
  const params = new URLSearchParams()
  if (options?.width && Number.isFinite(options.width)) {
    params.set('w', `${Math.max(64, Math.round(options.width))}`)
  }

  const base = `stash://asset/${encodeURIComponent(relativePath)}`
  return params.size > 0 ? `${base}?${params.toString()}` : base
}
