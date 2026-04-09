import { useState, useCallback } from 'react'
import type { Item } from '../types'

export function useSelection() {
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)

  const select = useCallback((item: Item | null) => {
    setSelectedItem(item)
  }, [])

  return { selectedItem, select }
}
