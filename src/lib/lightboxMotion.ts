import { animate } from 'motion'

const LIGHTBOX_CLOSE_DURATION_S = 0.38
const FALLBACK_CARD_RADIUS = '12px'
const FALLBACK_LIGHTBOX_RADIUS = '20px'
const LIGHTBOX_OPEN_EASE = [0.22, 1, 0.36, 1] as const
const LIGHTBOX_CLOSE_EASE = [0.4, 0, 0.2, 1] as const

export interface LightboxGeometry {
  targetW: number
  targetH: number
  targetX: number
  targetY: number
  scaleX: number
  scaleY: number
  tx: number
  ty: number
}

export function computeLightboxGeometry(rect: DOMRect, panelWidth = 0, bottomReserve = 0): LightboxGeometry {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const availableWidth = viewportWidth - panelWidth
  const usableHeight = Math.max(0, viewportHeight - bottomReserve)
  const maxWidth = availableWidth * 0.75
  const maxHeight = usableHeight * 0.75
  const aspectRatio = rect.width / rect.height

  let targetW = maxWidth
  let targetH = maxWidth / aspectRatio

  if (targetH > maxHeight) {
    targetH = maxHeight
    targetW = maxHeight * aspectRatio
  }

  const targetX = (availableWidth - targetW) / 2
  const targetY = (usableHeight - targetH) / 2
  const scaleX = rect.width / targetW
  const scaleY = rect.height / targetH
  const tx = rect.left + rect.width / 2 - (targetX + targetW / 2)
  const ty = rect.top + rect.height / 2 - (targetY + targetH / 2)

  return { targetW, targetH, targetX, targetY, scaleX, scaleY, tx, ty }
}

export function lightboxPanelReserveWidth(expanded: boolean): number {
  return expanded ? window.innerWidth - 200 : 380
}

export function getLightboxTransform(geometry: LightboxGeometry): string {
  return `translate3d(${geometry.tx}px, ${geometry.ty}px, 0) scale(${geometry.scaleX}, ${geometry.scaleY})`
}

function parsePixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getScaleCompensation(geometry: LightboxGeometry): number {
  return Math.max(0.0001, (geometry.scaleX + geometry.scaleY) / 2)
}

function getAnimationDuration(geometry: LightboxGeometry): number {
  const distance = Math.hypot(geometry.tx, geometry.ty)
  return 0.44 + Math.min(distance / 1800, 0.2)
}

export function animateLightboxFrame(
  element: HTMLElement,
  geometry: LightboxGeometry,
  mode: 'open' | 'close'
) {
  const rootStyle = getComputedStyle(document.documentElement)
  const cardRadius = rootStyle.getPropertyValue('--radius-card').trim() || FALLBACK_CARD_RADIUS
  const lightboxRadius =
    rootStyle.getPropertyValue('--radius-lightbox').trim() || FALLBACK_LIGHTBOX_RADIUS
  const cardRadiusPx = parsePixelValue(cardRadius)
  const lightboxRadiusPx = parsePixelValue(lightboxRadius)
  const scaleCompensation = getScaleCompensation(geometry)
  const transformOffset = getLightboxTransform(geometry)
  const compensatedCardRadius = `${cardRadiusPx / scaleCompensation}px`

  element.style.left = `${geometry.targetX}px`
  element.style.top = `${geometry.targetY}px`
  element.style.width = `${geometry.targetW}px`
  element.style.height = `${geometry.targetH}px`
  element.style.transformOrigin = 'center center'
  element.style.transform = mode === 'open' ? transformOffset : 'translate3d(0px, 0px, 0px) scale(1, 1)'
  element.style.borderRadius = mode === 'open' ? compensatedCardRadius : `${lightboxRadiusPx}px`

  const fromFrame =
    mode === 'open'
      ? {
          transform: transformOffset,
          borderRadius: compensatedCardRadius
        }
      : {
          transform: 'translate3d(0px, 0px, 0px) scale(1, 1)',
          borderRadius: `${lightboxRadiusPx}px`
        }

  const toFrame =
    mode === 'open'
      ? {
          transform: 'translate3d(0px, 0px, 0px) scale(1, 1)',
          borderRadius: `${lightboxRadiusPx}px`
        }
      : {
          transform: transformOffset,
          borderRadius: compensatedCardRadius
        }

  return animate(
    element,
    {
      transform: [fromFrame.transform, toFrame.transform],
      borderRadius: [fromFrame.borderRadius, toFrame.borderRadius]
    },
    mode === 'open'
      ? {
          duration: Math.min(getAnimationDuration(geometry), 0.42),
          ease: LIGHTBOX_OPEN_EASE
        }
      : {
          duration: LIGHTBOX_CLOSE_DURATION_S,
          ease: LIGHTBOX_CLOSE_EASE
        }
  )
}

export function setLightboxSourceHidden(
  element: HTMLElement | null | undefined,
  hidden: boolean
) {
  if (!element) return

  element.style.visibility = hidden ? 'hidden' : ''
}

export function getLiveLightboxSourceRect(
  element: HTMLElement | null | undefined,
  fallbackRect: DOMRect
) {
  const liveRect = element?.getBoundingClientRect()
  if (liveRect && liveRect.width > 0 && liveRect.height > 0) {
    return liveRect
  }

  return fallbackRect
}
