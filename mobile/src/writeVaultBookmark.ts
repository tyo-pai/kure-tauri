import { Directory, File } from 'expo-file-system';
import { fetchUrlMetadata } from '@stash/url-metadata';
import type { BookmarkMedia } from '@stash/vault-io';
import { buildBookmarkMarkdown } from '@stash/vault-io';
import { enrichBookmarkText, maybeGenerateEmbedding } from './aiEnrichment';

export interface SaveSharePayload {
  url: string;
  /** From share sheet raw text / title hint */
  titleHint?: string;
  textHint?: string;
  metaTitle?: string;
  shareMeta?: Record<string, string | undefined> | null;
  openaiApiKey?: string;
  /** Set false to skip AI (faster; metadata only) */
  enableAi?: boolean;
}

export interface BookmarkWriteResult {
  title: string;
  source: string;
  savedAt: string;
}

function toPosixPath(s: string): string {
  return s.replace(/\\/g, '/');
}

function pickTitle(metaTitle: string, hints: SaveSharePayload): string {
  const fromMeta = metaTitle?.trim();
  if (fromMeta) return fromMeta;
  const fromShare = hints.metaTitle?.trim() || hints.titleHint?.trim() || hints.textHint?.trim()?.split('\n')[0]?.slice(0, 200);
  return fromShare || hints.url;
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function isWeakTitle(value: string | null | undefined, url: string): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  const host = hostnameFromUrl(url);
  if (host && lower === host) return true;
  if (host && lower === `${host}/`) return true;
  if (['home', 'homepage', 'untitled', 'login', 'sign in'].includes(lower)) return true;
  return trimmed.length < 4;
}

function scoreText(value: string | null | undefined, url: string, kind: 'title' | 'description'): number {
  const trimmed = value?.trim();
  if (!trimmed) return -1;

  let score = trimmed.length;
  if (kind === 'title' && isWeakTitle(trimmed, url)) score -= 120;
  if (kind === 'description' && trimmed.length < 24) score -= 40;
  if (/^https?:\/\//i.test(trimmed)) score -= 80;
  return score;
}

function chooseBetterText(
  current: string | null | undefined,
  candidate: string | null | undefined,
  url: string,
  kind: 'title' | 'description'
): string | null {
  const currentScore = scoreText(current, url, kind);
  const candidateScore = scoreText(candidate, url, kind);
  return candidateScore > currentScore ? candidate?.trim() || null : current?.trim() || null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function extractShareSheetMetadata(meta: SaveSharePayload['shareMeta']) {
  const title = firstNonEmpty(meta?.title, meta?.['og:title'], meta?.['twitter:title']);
  const description = firstNonEmpty(
    meta?.['og:description'],
    meta?.['twitter:description'],
    meta?.description
  );
  const image = firstNonEmpty(
    meta?.['og:image'],
    meta?.['twitter:image'],
    meta?.['twitter:image:src']
  );
  const siteName = firstNonEmpty(meta?.['og:site_name'], meta?.site_name);

  return { title, description, image, siteName };
}

export async function writeBookmarkToVault(
  vaultDirectoryUri: string,
  payload: SaveSharePayload
): Promise<BookmarkWriteResult> {
  const meta = await fetchUrlMetadata(payload.url);
  const shareMeta = extractShareSheetMetadata(payload.shareMeta);
  console.log('[mobile-bookmark] metadata result', {
    url: payload.url,
    title: meta.title,
    description: meta.description?.slice(0, 240),
    image: meta.image,
    mediaUrl: meta.mediaUrl,
    mediaItems: meta.mediaItems?.length ?? 0,
    author: meta.author,
    postText: meta.postText?.slice(0, 240),
    favicon: meta.favicon,
    siteName: meta.siteName,
    price: meta.price,
  });
  console.log('[mobile-bookmark] share meta', shareMeta);

  const mergedTitle =
    chooseBetterText(meta.title, shareMeta.title, payload.url, 'title') ||
    chooseBetterText(shareMeta.title, payload.titleHint, payload.url, 'title') ||
    pickTitle(meta.title || shareMeta.title || '', payload);
  let title = pickTitle(mergedTitle, payload);

  const description =
    chooseBetterText(meta.description, shareMeta.description, payload.url, 'description') ||
    chooseBetterText(shareMeta.description, payload.textHint, payload.url, 'description') ||
    '';
  const bodyText = [description, payload.textHint?.trim()].filter(Boolean).join('\n\n').trim();
  const savedAt = new Date().toISOString();

  let tags: string[] = [];
  let ai_summary = '';
  let embedding: number[] | null = null;

  const runAi = payload.enableAi !== false;
  if (runAi) {
    const enriched = await enrichBookmarkText(payload.openaiApiKey, {
      title,
      description,
      url: payload.url,
    });
    tags = enriched.tags;
    ai_summary = enriched.ai_summary;

    const forEmbed = [title, description, bodyText, ai_summary, payload.url].filter(Boolean).join('\n');
    embedding = await maybeGenerateEmbedding(payload.openaiApiKey, forEmbed);
  }

  const bookmarkMedia: BookmarkMedia[] | undefined =
    meta.mediaItems?.length > 0
      ? meta.mediaItems.map((m) => ({
          kind: m.kind,
          url: toPosixPath(m.url),
          ...(m.video_url ? { video_url: m.video_url } : {}),
        }))
      : undefined;

  const thumbFromMedia = bookmarkMedia?.[0]?.url ?? null;
  const chosenImage = firstNonEmpty(meta.image, shareMeta.image);
  const thumbnail = chosenImage ? toPosixPath(chosenImage) : thumbFromMedia;
  const preview_video_url = meta.mediaUrl ?? undefined;

  const { markdown, fileName } = buildBookmarkMarkdown({
    title,
    url: payload.url,
    description,
    body: bodyText || description,
    favicon_url: meta.favicon,
    thumbnail,
    store_name: firstNonEmpty(meta.siteName, shareMeta.siteName) || undefined,
    bookmark_media: bookmarkMedia,
    preview_video_url,
    bookmark_author: meta.author,
    bookmark_post_text: meta.postText,
    price: meta.price,
    tags: tags.length > 0 ? tags : undefined,
    ai_summary: ai_summary || undefined,
    embedding: embedding ?? undefined,
  });
  console.log('[mobile-bookmark] markdown draft', {
    fileName,
    title,
    markdown: markdown.slice(0, 1200),
  });

  const vault = new Directory(vaultDirectoryUri);
  const file = new File(vault, fileName);

  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(markdown);
  console.log('[mobile-bookmark] write success', {
    fileName,
    vaultDirectoryUri,
  });

  return {
    title,
    source: firstNonEmpty(meta.siteName, shareMeta.siteName, hostnameFromUrl(payload.url)) || 'link',
    savedAt,
  };
}
