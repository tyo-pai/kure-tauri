import { useState, useRef } from 'react'
import { Dithering, ImageDithering } from '@paper-design/shaders-react'
import { scanOverlay, imageDithering } from '../../lib/shader-config'
import './ShaderDebug.css'

const BLEND_MODES = [
  'normal', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light',
  'color-dodge', 'color-burn', 'difference', 'exclusion', 'lighten', 'darken',
  'luminosity', 'hue', 'saturation', 'color'
]

const SHAPES = ['warp', 'zigzag', 'sine', 'steps', 'bricks', 'truchet']
const TYPES = ['2x2', '4x4', '8x8']

const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600',
]

// Parse rgba string to hex + alpha
function parseRgba(rgba: string): { hex: string; alpha: number } {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/)
  if (match) {
    const r = parseInt(match[1])
    const g = parseInt(match[2])
    const b = parseInt(match[3])
    const a = match[4] !== undefined ? parseFloat(match[4]) : 1
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    return { hex, alpha: a }
  }
  // Fallback for hex strings
  if (rgba.startsWith('#')) return { hex: rgba, alpha: 1 }
  return { hex: '#000000', alpha: 1 }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Init from shared config
const initFront = parseRgba(scanOverlay.colorFront)
const initBack = parseRgba(scanOverlay.colorBack)

export function ShaderDebug({ onClose }: { onClose: () => void }) {
  // --- Scan overlay (Dithering) ---
  const [blendMode, setBlendMode] = useState(scanOverlay.blendMode)
  const [opacity, setOpacity] = useState(scanOverlay.opacity)
  const [colorFront, setColorFront] = useState(initFront.hex)
  const [colorFrontAlpha, setColorFrontAlpha] = useState(initFront.alpha)
  const [colorBack, setColorBack] = useState(initBack.hex)
  const [colorBackAlpha, setColorBackAlpha] = useState(initBack.alpha)
  const [shape, setShape] = useState<string>(scanOverlay.shape)
  const [type, setType] = useState<string>(scanOverlay.type)
  const [size, setSize] = useState(scanOverlay.size)
  const [speed, setSpeed] = useState(scanOverlay.speed)

  // --- Image dithering ---
  const [imgDitherFront, setImgDitherFront] = useState(imageDithering.colorFront)
  const [imgDitherBack, setImgDitherBack] = useState(imageDithering.colorBack)
  const [imgDitherHighlight, setImgDitherHighlight] = useState(imageDithering.colorHighlight)
  const [imgDitherType, setImgDitherType] = useState<string>(imageDithering.type)
  const [imgDitherSize, setImgDitherSize] = useState(imageDithering.size)
  const [imgDitherSpeed, setImgDitherSpeed] = useState(imageDithering.speed)
  const [imgDitherSteps, setImgDitherSteps] = useState(imageDithering.colorSteps)
  const [showImageDither, setShowImageDither] = useState(true)

  const [sampleImg, setSampleImg] = useState(0)
  const [customImage, setCustomImage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const frontRgba = hexToRgba(colorFront, colorFrontAlpha)
  const backRgba = hexToRgba(colorBack, colorBackAlpha)
  const imgSrc = customImage || SAMPLE_IMAGES[sampleImg]

  const codeSnippet = `// shader-config.ts

export const scanOverlay = {
  colorBack: '${backRgba}',
  colorFront: '${frontRgba}',
  shape: '${shape}',
  type: '${type}',
  size: ${size},
  speed: ${speed},
  blendMode: '${blendMode}',
  opacity: ${opacity},
}

export const imageDithering = {
  colorFront: '${imgDitherFront}',
  colorBack: '${imgDitherBack}',
  colorHighlight: '${imgDitherHighlight}',
  type: '${imgDitherType}',
  size: ${imgDitherSize},
  speed: ${imgDitherSpeed},
  colorSteps: ${imgDitherSteps},
  fit: 'cover',
}`

  return (
    <div className="shader-debug-overlay">
      <div className="shader-debug-panel">
        <div className="shader-debug-header">
          <h2>Shader Debug</h2>
          <button onClick={onClose}>close</button>
        </div>

        <div className="shader-debug-layout">
          {/* Preview */}
          <div className="shader-debug-preview">
            <div className="shader-debug-card">
              {showImageDither ? (
                <div className="shader-debug-img-dither">
                  <ImageDithering
                    imageSrc={imgSrc}
                    colorFront={imgDitherFront}
                    colorBack={imgDitherBack}
                    colorHighlight={imgDitherHighlight}
                    type={imgDitherType as any}
                    size={imgDitherSize}
                    speed={imgDitherSpeed}
                    colorSteps={imgDitherSteps}
                    fit="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <img src={imgSrc} alt="" className="shader-debug-img" />
              )}
              <div
                className="shader-debug-shader"
                style={{
                  mixBlendMode: blendMode as any,
                  opacity,
                }}
              >
                <Dithering
                  colorBack={backRgba}
                  colorFront={frontRgba}
                  shape={shape as any}
                  type={type as any}
                  size={size}
                  speed={speed}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>

            <div className="shader-debug-img-switcher">
              {SAMPLE_IMAGES.map((_, i) => (
                <button
                  key={i}
                  className={sampleImg === i && !customImage ? 'active' : ''}
                  onClick={() => { setSampleImg(i); setCustomImage(null) }}
                >
                  img {i + 1}
                </button>
              ))}
              <button onClick={() => fileRef.current?.click()}>upload</button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setCustomImage(URL.createObjectURL(f))
                }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="shader-debug-controls">
            <Section title="Scan Overlay">
              <SelectControl label="blend" value={blendMode} options={BLEND_MODES} onChange={setBlendMode} />
              <SliderControl label="opacity" value={opacity} min={0} max={1} step={0.05} onChange={setOpacity} />
              <ColorControl label="front" color={colorFront} alpha={colorFrontAlpha}
                onColorChange={setColorFront} onAlphaChange={setColorFrontAlpha} />
              <ColorControl label="back" color={colorBack} alpha={colorBackAlpha}
                onColorChange={setColorBack} onAlphaChange={setColorBackAlpha} />
              <SelectControl label="shape" value={shape} options={SHAPES} onChange={setShape} />
              <SelectControl label="type" value={type} options={TYPES} onChange={setType} />
              <SliderControl label="size" value={size} min={0.5} max={10} step={0.1} onChange={setSize} />
              <SliderControl label="speed" value={speed} min={0} max={5} step={0.1} onChange={setSpeed} />
            </Section>

            <Section title="Image Dithering">
              <div className="shader-debug-row">
                <label>show</label>
                <input type="checkbox" checked={showImageDither}
                  onChange={(e) => setShowImageDither(e.target.checked)} />
              </div>
              <ColorControl label="front" color={imgDitherFront} alpha={1}
                onColorChange={setImgDitherFront} onAlphaChange={() => {}} />
              <ColorControl label="back" color={imgDitherBack} alpha={1}
                onColorChange={setImgDitherBack} onAlphaChange={() => {}} />
              <ColorControl label="hilite" color={imgDitherHighlight} alpha={1}
                onColorChange={setImgDitherHighlight} onAlphaChange={() => {}} />
              <SelectControl label="type" value={imgDitherType} options={TYPES} onChange={setImgDitherType} />
              <SliderControl label="size" value={imgDitherSize} min={0.5} max={10} step={0.1} onChange={setImgDitherSize} />
              <SliderControl label="speed" value={imgDitherSpeed} min={0} max={5} step={0.1} onChange={setImgDitherSpeed} />
              <SliderControl label="steps" value={imgDitherSteps} min={1} max={10} step={1} onChange={setImgDitherSteps} />
            </Section>

            <Section title="Code">
              <pre className="shader-debug-code">{codeSnippet}</pre>
              <button
                className="shader-debug-copy"
                onClick={() => navigator.clipboard.writeText(codeSnippet)}
              >
                copy
              </button>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="shader-debug-section">
      <div className="shader-debug-section-title">{title}</div>
      {children}
    </div>
  )
}

function SliderControl({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="shader-debug-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="shader-debug-value">{value.toFixed(2)}</span>
    </div>
  )
}

function SelectControl({ label, value, options, onChange }: {
  label: string; value: string; options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div className="shader-debug-row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function ColorControl({ label, color, alpha, onColorChange, onAlphaChange }: {
  label: string; color: string; alpha: number
  onColorChange: (v: string) => void; onAlphaChange: (v: number) => void
}) {
  return (
    <div className="shader-debug-row shader-debug-color-row">
      <label>{label}</label>
      <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} />
      <input type="range" min={0} max={1} step={0.05} value={alpha}
        onChange={(e) => onAlphaChange(parseFloat(e.target.value))} />
      <span className="shader-debug-value">{alpha.toFixed(2)}</span>
    </div>
  )
}
