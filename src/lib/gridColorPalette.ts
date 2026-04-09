import tinycolor from 'tinycolor2'

/** 12 columns × 11 rows: row 0 grayscale, rows 1–10 hue columns with dark→light. */
export const GRID_COLS = 12
export const GRID_ROWS = 11

export function buildGridRows(): string[][] {
  const rows: string[][] = []
  const grayRow: string[] = []
  for (let c = 0; c < GRID_COLS; c++) {
    const g = Math.round((c / (GRID_COLS - 1)) * 255)
    grayRow.push(tinycolor({ r: g, g: g, b: g }).toHexString())
  }
  rows.push(grayRow)

  for (let r = 1; r < GRID_ROWS; r++) {
    const t = (r - 1) / (GRID_ROWS - 2)
    const row: string[] = []
    for (let c = 0; c < GRID_COLS; c++) {
      const h = (c / GRID_COLS) * 360
      const s = 98 - t * 58
      const l = 16 + t * 78
      row.push(tinycolor({ h, s, l }).toHexString())
    }
    rows.push(row)
  }
  return rows
}
