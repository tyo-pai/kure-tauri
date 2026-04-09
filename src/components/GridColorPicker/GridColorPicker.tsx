import { useMemo } from 'react'
import { CustomPicker } from 'react-color'
import tinycolor from 'tinycolor2'
import type { InjectedColorProps } from 'react-color'
import { buildGridRows } from '../../lib/gridColorPalette'
import { normalizeHex } from '../../lib/colorMatch'
import './GridColorPicker.css'

function hexEquals(a: string, b?: string) {
  if (!b) return false
  return normalizeHex(a).toLowerCase() === normalizeHex(b).toLowerCase()
}

function GridPickerInner({ onChange, hex }: InjectedColorProps) {
  const rows = useMemo(() => buildGridRows(), [])

  return (
    <div className="grid-color-picker" role="presentation">
      <div
        className="grid-color-picker-grid"
        role="grid"
        aria-label="Color swatches"
      >
        {rows.map((row, ri) =>
          row.map((cell, ci) => {
            const active = hexEquals(cell, hex)
            return (
              <button
                key={`${ri}-${ci}`}
                type="button"
                role="gridcell"
                className={`grid-color-picker-swatch${active ? ' grid-color-picker-swatch--active' : ''}`}
                style={{ backgroundColor: cell }}
                title={cell}
                onClick={() => onChange?.({ hex: tinycolor(cell).toHexString() })}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export const GridColorPicker = CustomPicker(GridPickerInner)
