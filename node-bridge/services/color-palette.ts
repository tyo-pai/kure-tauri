import { getImagePath } from './image-store'
import fs from 'fs'

export interface ColorSwatch {
  hex: string
  name: string
  population: number
}

/** Jimp (used by node-vibrant) does not decode WebP; convert to PNG first. */
function isWebpBuffer(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
}

/**
 * Returns a path string or a PNG buffer that Jimp can read.
 * WebP (local or fetched URL) is converted with sharp.
 */
async function vibrantInput(thumbnail: string, imagePath: string): Promise<string | Buffer> {
  const sharp = require('sharp') as typeof import('sharp')

  if (thumbnail.startsWith('http://') || thumbnail.startsWith('https://')) {
    const res = await fetch(thumbnail)
    if (!res.ok) {
      throw new Error(`fetch failed ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (isWebpBuffer(buf)) {
      return await sharp(buf).png().toBuffer()
    }
    return buf
  }

  if (!fs.existsSync(imagePath)) {
    return imagePath
  }

  const fd = fs.openSync(imagePath, 'r')
  const header = Buffer.alloc(12)
  try {
    fs.readSync(fd, header, 0, 12, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (isWebpBuffer(header) || imagePath.toLowerCase().endsWith('.webp')) {
    return await sharp(imagePath).png().toBuffer()
  }
  return imagePath
}

export async function extractColorPalette(thumbnail: string, folderPath: string | null = null): Promise<ColorSwatch[]> {
  try {
    const imagePath = thumbnail.startsWith('http') ? thumbnail : getImagePath(thumbnail, folderPath)

    // Verify the file exists before processing
    if (!thumbnail.startsWith('http') && !fs.existsSync(imagePath)) {
      console.error('[color-palette] Image not found:', imagePath)
      return []
    }

    console.error('[color-palette] Extracting from:', imagePath)

    // node-vibrant@3: package `main` is the Node build (`lib/index.js` wires `ImageClass`).
    const Vibrant = require('node-vibrant') as {
      from: (src: string | Buffer) => { getPalette: () => Promise<Record<string, unknown>> }
    }
    const src = await vibrantInput(thumbnail, imagePath)
    const palette = await Vibrant.from(src).getPalette()

    const colors = Object.entries(palette)
      .filter(([, swatch]) => swatch && (swatch as any).population > 0)
      .map(([name, swatch]) => ({
        hex: (swatch as any).hex as string,
        name: name.replace(/([A-Z])/g, ' $1').trim().toLowerCase(),
        population: (swatch as any).population as number
      }))
      .sort((a, b) => b.population - a.population)

    console.error('[color-palette] Extracted:', colors.map((c) => c.hex))
    return colors
  } catch (err) {
    console.error('[color-palette] Extraction failed:', err)
    return []
  }
}
