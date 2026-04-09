import { useState, useEffect, useCallback } from 'react'
import type { Item } from '../types'

interface UseItemsOptions {
  enabled?: boolean
  type?: string
  folder?: string
  tag?: string
  search?: string
  /** Hex color — vault matches items whose extracted palette is near this color */
  color?: string
}

export function useItems(options: UseItemsOptions = {}) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  const [folders, setFolders] = useState<string[]>([])

  useEffect(() => {
    setLoading(Boolean(options.enabled))
  }, [options.enabled])

  const fetchItems = useCallback(async () => {
    if (!options.enabled) {
      setItems([])
      setLoading(false)
      return
    }

    // Do not set loading=true here — it ran on every filter/search change and made the grid flash.
    // Initial state is loading=true until the first fetch completes in finally {}.
    try {
      const filters: Record<string, string> = {}
      if (options.type && options.type !== 'everything') filters.type = options.type
      if (options.folder && options.folder !== '__all__' && options.folder !== '__root__') {
        filters.folder = options.folder
      }
      if (options.tag) filters.tag = options.tag
      if (options.search) filters.search = options.search
      if (options.color) filters.color = options.color

      const result = await window.desktopAPI.items.list(
        Object.keys(filters).length > 0 ? filters : undefined
      )
      setItems(result)
    } catch (err) {
      console.error('Failed to fetch items:', err)
    } finally {
      setLoading(false)
    }
  }, [options.enabled, options.type, options.folder, options.tag, options.search, options.color])

  const fetchCounts = useCallback(async () => {
    if (!options.enabled) {
      setTypeCounts({})
      setFolderCounts({})
      return
    }

    try {
      const result = await window.desktopAPI.items.list()
      if (result) {
        const nextTypeCounts: Record<string, number> = { everything: result.length }
        const nextFolderCounts: Record<string, number> = { __all__: result.length, __root__: result.length }
        for (const item of result) {
          nextTypeCounts[item.type] = (nextTypeCounts[item.type] || 0) + 1
          if (item.folder) {
            nextFolderCounts[item.folder] = (nextFolderCounts[item.folder] || 0) + 1
          }
        }
        setTypeCounts(nextTypeCounts)
        setFolderCounts(nextFolderCounts)
      }
    } catch {
      // ignore
    }
  }, [options.enabled])

  const fetchFolders = useCallback(async () => {
    if (!options.enabled) {
      setFolders([])
      return
    }

    try {
      const result = await window.desktopAPI.folders.list()
      setFolders(result)
    } catch {
      // ignore
    }
  }, [options.enabled])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  const refresh = useCallback(() => {
    fetchItems()
    fetchCounts()
    fetchFolders()
  }, [fetchItems, fetchCounts, fetchFolders])

  return { items, loading, typeCounts, folderCounts, folders, refresh }
}
