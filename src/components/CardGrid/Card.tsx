import { memo, useRef, useState, useEffect } from 'react'
import { Dithering, ImageDithering } from '@paper-design/shaders-react'
import { TypeDot } from '../common/TypeDot'
import { scanOverlay, imageDithering } from '../../lib/shader-config'
import { getItemAssetUrl } from '../../lib/assets'
import { displayStillUrl, displayUrlForBookmarkMedia, normalizeBookmarkMedia } from '../../lib/bookmarkMedia'
import { videoDebugHandlers } from '../../utils/videoDebug'
import type { EnrichmentStage, Item } from '../../types'

export interface LightboxData {
  rect: DOMRect
  element?: HTMLElement | null
  sourceItemId?: string
  /** Bookmark / wishlist — lightbox resolves media from item + shared attachment index */
  itemId?: string
  /** Image-type items (no `itemId`) */
  src?: string
  posterSrc?: string
  kind?: 'image' | 'video'
}

interface CardProps {
  item: Item
  selected: boolean
  enriching?: boolean
  enrichmentStage?: EnrichmentStage
  isNew?: boolean
  onSelect: (item: Item) => void
  onEnlarge?: (data: LightboxData) => void
  viewMode: 'grid' | 'list'
}

const GRID_MEDIA_WIDTH_PX = 960

const STAGE_WORDS: Record<EnrichmentStage, string[]> = {
  starting: ['waking', 'priming', 'hmm'],
  reading: ['reading', 'parsing', 'sifting'],
  seeing: ['seeing', 'glancing', 'noting'],
  tagging: ['tagging', 'sorting', 'filing'],
  indexing: ['indexing', 'linking', 'weaving'],
  finishing: ['polishing', 'settling', 'closing'],
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function getDomain(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return ''
  }
}

function isGif(src: string): boolean {
  return /\.gif($|\?)/i.test(src)
}

function stripMarkdownForPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNoteExcerpt(item: Item): string {
  const raw = item.body || item.description || ''
  if (!raw) return ''

  const cleanedLines = raw
    .split('\n')
    .map((line) => stripMarkdownForPreview(line))
    .filter(Boolean)

  if (cleanedLines.length === 0) return ''

  const normalizedTitle = stripMarkdownForPreview(item.title).toLowerCase()
  if (normalizedTitle && cleanedLines[0]?.toLowerCase() === normalizedTitle) {
    cleanedLines.shift()
  }

  return cleanedLines.join(' ').trim()
}

// Freezes a GIF by drawing its first frame to a canvas and returning a data URL
function useGifFirstFrame(src: string): string | null {
  const [frame, setFrame] = useState<string | null>(null)
  useEffect(() => {
    if (!isGif(src)) { setFrame(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        setFrame(canvas.toDataURL('image/png'))
      }
    }
    img.src = src
  }, [src])
  return frame
}

function AiScanOverlay() {
  return (
    <div className="card-ai-scan">
      <Dithering
        colorBack={scanOverlay.colorBack}
        colorFront={scanOverlay.colorFront}
        shape={scanOverlay.shape}
        type={scanOverlay.type}
        size={scanOverlay.size}
        speed={scanOverlay.speed}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

function pickNextWord(words: string[], current: string | null): string {
  if (words.length === 0) return 'examining'
  if (words.length === 1) return words[0]

  const options = current ? words.filter((word) => word !== current) : words
  return options[Math.floor(Math.random() * options.length)] || words[0]
}

function AiImageDithering({ src }: { src: string }) {
  return (
    <div className="card-ai-image-dither">
      <ImageDithering
        imageSrc={src}
        colorFront={imageDithering.colorFront}
        colorBack={imageDithering.colorBack}
        colorHighlight={imageDithering.colorHighlight}
        type={imageDithering.type}
        size={imageDithering.size}
        speed={imageDithering.speed}
        colorSteps={imageDithering.colorSteps}
        fit={imageDithering.fit}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

function CardInner({ item, selected, enriching, enrichmentStage, isNew, onSelect, onEnlarge, viewMode }: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const showImage = item.thumbnail && (item.type === 'image' || item.type === 'bookmark' || item.type === 'wishlist')
  const mediaList =
    item.type === 'bookmark' || item.type === 'wishlist' ? normalizeBookmarkMedia(item) : []
  const primary = mediaList[0]
  const excerpt = item.type === 'note' ? buildNoteExcerpt(item) : item.description || item.body
  const domain = getDomain(item.url)
  const stage = enrichmentStage || 'starting'
  const [stageWord, setStageWord] = useState('examining')

  useEffect(() => {
    if (!enriching) {
      setStageWord('examining')
      return
    }

    const words = STAGE_WORDS[stage] || ['examining']
    const nextWord = pickNextWord(words, null)
    setStageWord(nextWord)

    if (words.length < 2) return

    const interval = window.setInterval(() => {
      setStageWord((current) => pickNextWord(words, current))
    }, 1500)

    return () => window.clearInterval(interval)
  }, [enriching, stage])

  // New cards: hide image until enrichment is done (isNew becomes false)
  // Existing cards: show image immediately
  const hideImage = isNew || enriching
  const wasNew = useRef(isNew)
  if (isNew) wasNew.current = true
  // card-img-hidden: opacity 0, no transition (instant hide)
  // card-img-reveal: opacity 1 with transition (fade in after enrichment)
  // neither: default opacity (existing cards, no animation needed)
  const imgVisClass = hideImage ? 'card-img-hidden' : wasNew.current ? 'card-img-reveal' : ''

  // GIF handling: freeze by default, animate on hover
  const imgSrcFull = primary
    ? primary.kind === 'video'
      ? displayStillUrl(item, { kind: 'image', url: primary.url })
      : displayStillUrl(item, primary)
    : getItemAssetUrl(item) || ''
  const imgSrcGrid = primary
    ? primary.kind === 'video'
      ? displayStillUrl(item, { kind: 'image', url: primary.url }, { width: GRID_MEDIA_WIDTH_PX })
      : displayStillUrl(item, primary, { width: GRID_MEDIA_WIDTH_PX })
    : getItemAssetUrl(item, { width: GRID_MEDIA_WIDTH_PX }) || ''
  const gifFrame = useGifFirstFrame(imgSrcGrid)
  const isGifImage = isGif(imgSrcFull)
  const [hovering, setHovering] = useState(false)
  const displaySrc = isGifImage && gifFrame && !hovering ? gifFrame : imgSrcGrid

  if (viewMode === 'list') {
    return (
      <div
        className={`card-list-item ${selected ? 'selected' : ''}`}
        onClick={() => onSelect(item)}
      >
        <TypeDot type={item.type} />
        <div className="card-list-title">{item.title || 'untitled'}</div>
        {domain && <span className="card-list-domain">{domain}</span>}
        {item.price && <span className="card-list-price">{item.price}</span>}
        {item.tags && item.tags.length > 0 && (
          <span className="card-list-tag">{item.tags[0].name}</span>
        )}
        {item.status === 'favorite' && <span className="card-list-fav">*</span>}
        <span className="card-list-date">{formatDate(item.created_at)}</span>
      </div>
    )
  }

  const isImageType = item.type === 'image' && item.thumbnail

  if (isImageType) {
    return (
      <div
        ref={cardRef}
        className={`card card-image-cover card-media-sized ${selected ? 'selected' : ''} ${isGifImage ? 'card-gif' : ''}`}
        data-lightbox-source-id={item.id}
        onClick={() => {
          onSelect(item)
          const sourceRect = imgRef.current?.getBoundingClientRect() ?? cardRef.current?.getBoundingClientRect()
          const sourceElement = cardRef.current ?? imgRef.current
          if (sourceElement && sourceRect) {
            onEnlarge?.({
              rect: sourceRect,
              element: sourceElement,
              sourceItemId: item.id,
              src: imgSrcFull,
              kind: 'image'
            })
          }
        }}
        onMouseEnter={() => isGifImage && setHovering(true)}
        onMouseLeave={() => isGifImage && setHovering(false)}
      >
        <img
          ref={imgRef}
          className={`card-cover-img ${imgVisClass}`}
          src={displaySrc}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
        
        {isGifImage && !hovering && gifFrame && (
          <div className="card-gif-badge">GIF</div>
        )}
        {enriching && <AiImageDithering src={imgSrcFull} />}
        {enriching && <div className="card-ai-word">{stageWord}</div>}
        <div
          className="card-cover-enlarge"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(item)
            const sourceRect = imgRef.current?.getBoundingClientRect() ?? cardRef.current?.getBoundingClientRect()
            const sourceElement = cardRef.current ?? imgRef.current
            if (sourceElement && sourceRect) {
              onEnlarge?.({
                rect: sourceRect,
                element: sourceElement,
                sourceItemId: item.id,
                src: imgSrcFull,
                kind: 'image'
              })
            }
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </div>
        {enriching && <AiScanOverlay />}
      </div>
    )
  }

  const hasThumb = showImage && item.thumbnail
  const previewVideo =
    primary?.kind === 'video' && primary.video_url
      ? displayUrlForBookmarkMedia(item, primary)
      : undefined

  return (
    <div
      ref={cardRef}
      className={`card ${hasThumb ? 'card-has-thumb card-media-sized' : ''} ${item.type === 'note' ? 'card-note' : ''} ${selected ? 'selected' : ''}`}
      data-lightbox-source-id={hasThumb ? item.id : undefined}
      onClick={() => {
        onSelect(item)
        const mediaEl = previewVideo ? videoRef.current : imgRef.current
        const sourceRect = mediaEl?.getBoundingClientRect() ?? cardRef.current?.getBoundingClientRect()
        const sourceElement = cardRef.current ?? mediaEl
        if (hasThumb && sourceElement && sourceRect) {
            onEnlarge?.({
              rect: sourceRect,
              element: sourceElement,
              sourceItemId: item.id,
              itemId: item.id
            })
        }
      }}
      onMouseEnter={() => isGifImage && setHovering(true)}
      onMouseLeave={() => isGifImage && setHovering(false)}
    >
      {hasThumb && (
        <>
          {previewVideo ? (
            <video
              ref={videoRef}
              className={`card-image ${imgVisClass}`}
              src={previewVideo}
              poster={imgSrcGrid}
              muted
              loop
              playsInline
              preload="none"
              {...videoDebugHandlers('card-grid', { src: previewVideo })}
            />
          ) : (
            <img
              ref={imgRef}
              className={`card-image ${imgVisClass}`}
              src={displaySrc}
              alt=""
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          )}
          {enriching && (
            <AiImageDithering
              src={imgSrcFull
              }
            />
          )}
        </>
      )}

      {enriching && <div className="card-ai-word">{stageWord}</div>}
      {enriching && hasThumb && <AiScanOverlay />}

      {hasThumb && item.type === 'wishlist' && item.price && (
        <span className="card-thumb-price">{item.price}</span>
      )}

      {hasThumb && mediaList.length > 1 && (
        <span className="card-media-count">{mediaList.length}</span>
      )}

      {!hasThumb && (
        <div className="card-body">
          <div className="card-type-dot">
            <TypeDot type={item.type} />
          </div>

          {item.title && <div className="card-title">{item.title}</div>}

          <div className="card-footer">
            {domain && (item.type === 'bookmark' || item.type === 'wishlist') ? (
              <div className="card-source">
                {item.favicon_url ? (
                  <img
                    className="card-source-favicon"
                    src={item.favicon_url}
                    alt=""
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="card-source-favicon" />
                )}
                <span>{domain}</span>
              </div>
            ) : (
              <span />
            )}
            {item.tags && item.tags.length > 0 && (
              <span className="card-tag">{item.tags[0].name}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function areCardPropsEqual(prev: CardProps, next: CardProps) {
  return (
    prev.item === next.item &&
    prev.selected === next.selected &&
    prev.enriching === next.enriching &&
    prev.enrichmentStage === next.enrichmentStage &&
    prev.isNew === next.isNew &&
    prev.viewMode === next.viewMode &&
    prev.onSelect === next.onSelect &&
    prev.onEnlarge === next.onEnlarge
  )
}

export const Card = memo(CardInner, areCardPropsEqual)
