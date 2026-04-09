// Shared shader configuration for AI scan overlay
// Edit these values here — they're used by both the card overlay and the shader debug panel

export const scanOverlay = {
  colorBack: 'rgba(255,255,255,1)',
  colorFront: 'rgba(0,0,0,1)',
  shape: 'warp' as const,
  type: '4x4' as const,
  size: 3.4,
  speed: 1.1,
  blendMode: 'screen' as const,
  opacity: 1,
}

export const imageDithering = {
  colorFront: '#ffffff',
  colorBack: '#000000',
  colorHighlight: '#ffffff',
  type: '4x4' as const,
  size: 3.4,
  speed: 1.1,
  colorSteps: 2,
  fit: 'cover' as const,
}
