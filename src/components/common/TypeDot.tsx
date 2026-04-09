import { TYPE_COLORS } from '../../lib/constants'
import type { ItemType } from '../../types'

interface TypeDotProps {
  type: ItemType
}

export function TypeDot({ type }: TypeDotProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        backgroundColor: TYPE_COLORS[type]
      }}
    />
  )
}
