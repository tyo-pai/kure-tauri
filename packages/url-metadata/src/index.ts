import { parse, type HTMLElement } from 'node-html-parser'

/** Remote bookmark attachments (e.g. X/Twitter multi-photo / video). */
export type BookmarkMediaKind = 'image' | 'video'

export interface BookmarkMediaItem {
  kind: BookmarkMediaKind
  url: string
  video_url?: string | null
}

export interface UrlMetadata {
  title: string
  description: string
  image: string | null
  mediaUrl: string | null
  mediaItems: BookmarkMediaItem[]
  author: string | null
  postText: string | null
  favicon: string | null
  siteName: string | null
  price: string | null
}

function extractPrice(root: HTMLElement, _html: string): string | null {
  try {
    const scripts = root.querySelectorAll('script[type="application/ld+json"]')
    for (let i = 0; i < scripts.length; i++) {
      const raw = scripts[i].textContent?.trim() || scripts[i].innerHTML?.trim()
      if (!raw) continue
      const data = JSON.parse(raw) as Record<string, unknown>
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const offer = (item as { offers?: unknown; Offers?: unknown }).offers ?? (item as { Offers?: unknown }).Offers
        const priceObj = Array.isArray(offer) ? offer[0] : offer
        const p = priceObj as { price?: unknown; priceCurrency?: string } | undefined
        if (p?.price) {
          const currency = p.priceCurrency || ''
          return formatPrice(String(p.price), currency)
        }
        const graph = (item as { '@graph'?: unknown[] })['@graph']
        if (Array.isArray(graph)) {
          for (const node of graph) {
            if (!node || typeof node !== 'object') continue
            const o = (node as { offers?: unknown; Offers?: unknown }).offers ?? (node as { Offers?: unknown }).Offers
            const po = Array.isArray(o) ? o[0] : o
            const px = po as { price?: unknown; priceCurrency?: string } | undefined
            if (px?.price) {
              return formatPrice(String(px.price), px.priceCurrency || '')
            }
          }
        }
      }
    }
  } catch {
    // ignore JSON parse errors
  }

  const ogPrice =
    root.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') ||
    root.querySelector('meta[property="og:price:amount"]')?.getAttribute('content')
  if (ogPrice) {
    const currency =
      root.querySelector('meta[property="product:price:currency"]')?.getAttribute('content') ||
      root.querySelector('meta[property="og:price:currency"]')?.getAttribute('content') ||
      ''
    return formatPrice(ogPrice, currency)
  }

  const priceSelectors = [
    '[data-price]',
    '.price .money',
    '.product-price',
    '.price-current',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price .a-offscreen',
    '[data-testid="price"]',
    '.sale-price',
    '.current-price',
    '.ProductPrice',
  ]
  for (const sel of priceSelectors) {
    const el = root.querySelector(sel)
    if (el) {
      const dataPrice = el.getAttribute('data-price')
      if (dataPrice) return formatPrice(dataPrice, '')
      const text = el.text.trim()
      if (text && /[\d.,]/.test(text)) return cleanPriceText(text)
    }
  }

  const priceRegex = /\$[\d,]+\.?\d{0,2}/
  const metaContent = root
    .querySelectorAll('meta')
    .map((m) => m.getAttribute('content') || '')
    .join(' ')
  const match = metaContent.match(priceRegex)
  if (match) return match[0]

  return null
}

function formatPrice(price: string, currency: string): string {
  const num = parseFloat(price.replace(/[^0-9.]/g, ''))
  if (isNaN(num)) return cleanPriceText(price)
  const symbol = currencySymbol(currency)
  return `${symbol}${num.toFixed(2)}`
}

function currencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    KRW: '₩',
    CAD: 'CA$',
    AUD: 'A$',
    IDR: 'Rp',
    SGD: 'S$',
  }
  return symbols[code.toUpperCase()] || (code ? `${code} ` : '$')
}

function cleanPriceText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s*[-–]\s*/)[0]
    .trim()
}

function isTwitterHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./, '')
  return h === 'twitter.com' || h === 'x.com' || h === 'mobile.twitter.com'
}

function extractTwitterStatusId(urlString: string): string | null {
  try {
    const u = new URL(urlString)
    if (!isTwitterHost(u.hostname)) return null
    const m = u.pathname.match(/\/(?:i\/)?status(?:es)?\/(\d+)/i)
    return m ? m[1] : null
  } catch {
    return null
  }
}

type VideoVariant = {
  content_type?: string
  url?: string
  bitrate?: number
  type?: string
  src?: string
}

type SyndicationTweet = {
  __typename?: string
  text?: string
  full_text?: string
  lang?: string
  note_tweet?: {
    text?: string
    note_tweet_results?: {
      result?: {
        text?: string
      }
    }
  }
  mediaDetails?: Array<{
    type?: string
    media_url_https?: string
    video_info?: { variants?: VideoVariant[] }
  }>
  photos?: Array<{ url?: string }>
  video?: {
    poster?: string
    variants?: VideoVariant[]
  }
  user?: {
    profile_image_url_https?: string
    name?: string
    screen_name?: string
    username?: string
  }
}

function pickBestMp4FromVariants(variants: VideoVariant[] | undefined): string | null {
  if (!variants?.length) return null
  const mp4s = variants.filter((v) => {
    if (v.content_type === 'video/mp4' && v.url) return true
    if (v.type === 'video/mp4' && v.src) return true
    return false
  })
  if (mp4s.length === 0) return null
  mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  const best = mp4s[0]
  return best.url || best.src || null
}

function mp4FromTopLevelVideo(video: SyndicationTweet['video']): string | null {
  if (!video?.variants?.length) return null
  return pickBestMp4FromVariants(video.variants)
}

function buildTwitterMediaItems(data: SyndicationTweet): BookmarkMediaItem[] {
  const out: BookmarkMediaItem[] = []
  const details = data.mediaDetails
  if (details?.length) {
    for (const md of details) {
      const t = md.type
      if (t === 'photo' && md.media_url_https) {
        out.push({ kind: 'image', url: md.media_url_https })
        continue
      }
      if ((t === 'video' || t === 'animated_gif') && md.media_url_https) {
        const mp4 = pickBestMp4FromVariants(md.video_info?.variants) || mp4FromTopLevelVideo(data.video)
        if (mp4) {
          out.push({ kind: 'video', url: md.media_url_https, video_url: mp4 })
        } else {
          out.push({ kind: 'image', url: md.media_url_https })
        }
      }
    }
    return out
  }
  if (data.photos?.length) {
    for (const p of data.photos) {
      if (p.url) out.push({ kind: 'image', url: p.url })
    }
  }
  const mp4 = mp4FromTopLevelVideo(data.video)
  if (mp4) {
    const poster = data.video?.poster || out.find((x) => x.kind === 'image')?.url || ''
    if (poster) {
      out.push({ kind: 'video', url: poster, video_url: mp4 })
    }
  }
  return out
}

function firstCoverFromMediaItems(items: BookmarkMediaItem[]): string | null {
  return items[0]?.url ?? null
}

function firstMp4FromMediaItems(items: BookmarkMediaItem[]): string | null {
  const v = items.find((i) => i.kind === 'video' && i.video_url)
  return v?.video_url ?? null
}

function cleanPostText(text: string | null | undefined): string | null {
  if (!text) return null
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned || null
}

function twitterAuthorLabel(data: SyndicationTweet): string | null {
  const displayName = cleanPostText(data.user?.name)
  const handleRaw = cleanPostText(data.user?.screen_name || data.user?.username)
  const handle = handleRaw ? (handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`) : null
  if (displayName && handle) return `${displayName} (${handle})`
  return displayName || handle
}

function twitterPostText(data: SyndicationTweet): string | null {
  return (
    cleanPostText(data.full_text) ||
    cleanPostText(data.text) ||
    cleanPostText(data.note_tweet?.text) ||
    cleanPostText(data.note_tweet?.note_tweet_results?.result?.text) ||
    null
  )
}

function buildTwitterBookmarkTitle(author: string | null, postText: string | null): string {
  const authorShort = cleanPostText(author)?.replace(/\s*\(@[^)]+\)\s*$/, '') || author || 'Post on X'
  const postShort = cleanPostText(postText)
  if (!postShort) return authorShort
  const clipped = postShort.length > 72 ? `${postShort.slice(0, 69).trimEnd()}...` : postShort
  return `${authorShort}: ${clipped}`
}

function normalizeTwitterUrlForApis(urlString: string): string {
  try {
    const u = new URL(urlString)
    if (!isTwitterHost(u.hostname)) return urlString
    u.hostname = 'twitter.com'
    u.search = ''
    return u.toString()
  } catch {
    return urlString
  }
}

async function fetchTwitterOEmbed(
  urlString: string
): Promise<{ author: string | null; postText: string | null } | null> {
  try {
    const normalized = normalizeTwitterUrlForApis(urlString)
    const endpoint = `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(normalized)}`
    const data = await fetchJsonWithFallback<{
      author_name?: string
      html?: string
    }>(endpoint, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: maybeTimeoutSignal(8000),
    })
    if (!data) return null

    const author = cleanPostText(data.author_name)
    const html = data.html || ''
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()

    const postText = cleanPostText(
      text
        .replace(/^“|”$/g, '')
        .replace(/\s+https?:\/\/t\.co\/\S+/gi, '')
        .replace(/\s+pic\.twitter\.com\/\S+/gi, '')
        .replace(/\s+—\s+.*$/, '')
    )

    return { author, postText }
  } catch {
    return null
  }
}

async function fetchTwitterSyndication(tweetId: string): Promise<{
  image: string | null
  mediaUrl: string | null
  mediaItems: BookmarkMediaItem[]
  author: string | null
  postText: string | null
}> {
  try {
    const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=0`
    const data = await fetchJsonWithFallback<SyndicationTweet>(syndicationUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: maybeTimeoutSignal(8000),
    })
    if (!data) return { image: null, mediaUrl: null, mediaItems: [], author: null, postText: null }
    if (data.__typename === 'TweetTombstone') {
      return { image: null, mediaUrl: null, mediaItems: [], author: null, postText: null }
    }

    let mediaItems = buildTwitterMediaItems(data)
    if (mediaItems.length === 0 && data.video?.variants?.length) {
      const mp4 = mp4FromTopLevelVideo(data.video)
      const poster = data.video?.poster || ''
      if (mp4 && poster) {
        mediaItems = [{ kind: 'video', url: poster, video_url: mp4 }]
      }
    }

    let image = firstCoverFromMediaItems(mediaItems)
    let mediaUrl = firstMp4FromMediaItems(mediaItems)
    if (!mediaUrl) {
      mediaUrl = mp4FromTopLevelVideo(data.video)
    }

    if (!image && data.photos?.[0]?.url) image = data.photos[0].url
    if (!image && data.video?.poster) image = data.video.poster
    if (!image && data.user?.profile_image_url_https) {
      image = data.user.profile_image_url_https.replace('_normal', '_bigger')
    }

    return {
      image,
      mediaUrl,
      mediaItems,
      author: twitterAuthorLabel(data),
      postText: twitterPostText(data),
    }
  } catch {
    return { image: null, mediaUrl: null, mediaItems: [], author: null, postText: null }
  }
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function maybeTimeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : undefined
  } catch {
    return undefined
  }
}

async function fetchTextWithFallback(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const response = await fetch(url, init)
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    }
  } catch {
    return { ok: false, status: 0, text: '' }
  }
}

async function fetchJsonWithFallback<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  const attempts = [await fetchTextWithFallback(url, init)]
  if (init) attempts.push(await fetchTextWithFallback(url))

  for (const attempt of attempts) {
    if (!attempt.ok || !attempt.text.trim()) continue
    try {
      return JSON.parse(attempt.text) as T
    } catch {
      // try next attempt
    }
  }

  return null
}

/** Fetch Open Graph / Twitter card metadata plus syndication for X posts. Same behavior as desktop `metadata-scraper`. */
export async function fetchUrlMetadata(url: string): Promise<UrlMetadata> {
  try {
    let twitterOembed: { author: string | null; postText: string | null } | null = null
    const tweetId = extractTwitterStatusId(url)
    if (tweetId) {
      twitterOembed = await fetchTwitterOEmbed(url)
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      signal: maybeTimeoutSignal(8000),
    })

    const html = await response.text()
    const root = parse(html)

    let title =
      root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      root.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
      root.querySelector('title')?.text.trim() ||
      ''

    let description =
      root.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      root.querySelector('meta[name="description"]')?.getAttribute('content') ||
      root.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
      ''

    let image =
      root.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      root.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
      root.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content') ||
      root.querySelector('meta[property="twitter:image"]')?.getAttribute('content') ||
      root.querySelector('meta[property="twitter:image:src"]')?.getAttribute('content') ||
      null

    if (image && !image.startsWith('http')) {
      const base = new URL(url)
      image = new URL(image, base.origin).href
    }

    let mediaUrl: string | null = null
    let mediaItems: BookmarkMediaItem[] = []
    let author: string | null = null
    let postText: string | null = null
    if (tweetId) {
      const synd = await fetchTwitterSyndication(tweetId)
      mediaItems = synd.mediaItems
      author = synd.author || twitterOembed?.author || null
      postText = synd.postText || twitterOembed?.postText || null
      if (!description.trim() && postText) {
        description = postText
      }
      if (!title.trim() || /^x$/i.test(title.trim()) || /^twitter$/i.test(title.trim())) {
        title = buildTwitterBookmarkTitle(author, postText)
      }
      if (synd.image) {
        image = synd.image
      }
      mediaUrl = synd.mediaUrl
    }

    const faviconRaw =
      root.querySelector('link[rel="icon"]')?.getAttribute('href') ||
      root.querySelector('link[rel="shortcut icon"]')?.getAttribute('href') ||
      `${new URL(url).origin}/favicon.ico`

    const faviconUrl =
      faviconRaw && !faviconRaw.startsWith('http')
        ? new URL(faviconRaw, new URL(url).origin).href
        : faviconRaw

    const siteName =
      root.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
      new URL(url).hostname.replace('www.', '')

    const price = extractPrice(root, html)

    return {
      title: title.trim(),
      description: description.trim(),
      image,
      mediaUrl,
      mediaItems,
      author,
      postText,
      favicon: faviconUrl,
      siteName,
      price,
    }
  } catch {
    try {
      const hostname = new URL(url).hostname.replace('www.', '')
      return {
        title: hostname,
        description: '',
        image: null,
        mediaUrl: null,
        mediaItems: [],
        author: null,
        postText: null,
        favicon: `${new URL(url).origin}/favicon.ico`,
        siteName: hostname,
        price: null,
      }
    } catch {
      return {
        title: url,
        description: '',
        image: null,
        mediaUrl: null,
        mediaItems: [],
        author: null,
        postText: null,
        favicon: null,
        siteName: null,
        price: null,
      }
    }
  }
}
