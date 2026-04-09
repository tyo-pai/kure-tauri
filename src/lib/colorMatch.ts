/** Shared color matching for palette search (vault + client-side semantic results). */

export function normalizeHex(hex: string): string {
  const raw = hex.trim().toLowerCase().replace(/^#/, '')
  if (raw.length === 3) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
  }
  if (raw.length === 6) return `#${raw}`
  return hex.startsWith('#') ? hex : `#${hex}`
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeHex(hex).replace(/^#/, '')
  if (n.length !== 6) return null
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  if ([r, g, b].some((x) => Number.isNaN(x))) return null
  return { r, g, b }
}

/**
 * Max Euclidean distance in RGB space between picked color and a palette swatch.
 * (Black→white ≈ 441; identical colors = 0.)
 * High enough that the wheel doesn’t need to land on the exact extracted hex—only “in the ballpark”.
 */
export const COLOR_MATCH_RGB_DISTANCE_THRESHOLD = 70

export function hexesColorMatch(a: string, b: string, threshold = COLOR_MATCH_RGB_DISTANCE_THRESHOLD): boolean {
  const A = parseRgb(a)
  const B = parseRgb(b)
  if (!A || !B) return normalizeHex(a) === normalizeHex(b)
  const d = Math.sqrt((A.r - B.r) ** 2 + (A.g - B.g) ** 2 + (A.b - B.b) ** 2)
  return d <= threshold
}

export function itemMatchesColorFilter(
  item: { colors?: { hex: string }[] },
  filterHex: string
): boolean {
  if (!item.colors?.length) return false
  const target = normalizeHex(filterHex)
  return item.colors.some((c) => hexesColorMatch(c.hex, target))
}
