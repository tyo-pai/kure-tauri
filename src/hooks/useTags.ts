import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '../types'

export function useTags(enabled = true) {
  const [tags, setTags] = useState<Tag[]>([])

  const fetchTags = useCallback(async () => {
    if (!enabled) {
      setTags([])
      return
    }

    try {
      const result = await window.desktopAPI.tags.list()
      setTags(result)
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [enabled])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const createTag = useCallback(
    async (name: string) => {
      const tag = await window.desktopAPI.tags.create(name)
      await fetchTags()
      return tag
    },
    [fetchTags]
  )

  return { tags, createTag, refresh: fetchTags }
}
