import { Platform } from 'react-native';
import { generateText } from 'ai';
import { apple } from '@react-native-ai/apple';
import OpenAI from 'openai';

export interface AppleAiDebugStatus {
  platform: string;
  appleProviderExposed: boolean;
  appleProviderAvailable: boolean;
  mode: 'apple' | 'openai' | 'none';
  reason: string;
}

function clipForLog(value: string, limit = 800): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

const TAG_SYSTEM_PROMPT =
  'You are a tagging assistant for a personal knowledge base. Given content (which may be a bookmark, note, image, or wishlist item), return 2-4 relevant lowercase tags as a JSON array of strings. Tags should be single words or short hyphenated phrases that categorize the content by topic, domain, or theme. Even if only a title is provided, infer relevant tags from it. Only return the JSON array, nothing else.';

const SUMMARY_SYSTEM_PROMPT =
  'You are a concise summarizer. Summarize the given content in 1-2 sentences. Be direct and informative. Only return the summary text, nothing else.';

function buildTagUserPrompt(type: string, title: string, body: string): string {
  const contentSection = body?.trim() ? `Content: ${body.slice(0, 2000)}` : '(no additional content)';
  return `Given the following content, return 2-4 relevant lowercase tags as a JSON array of strings. Tags should be single words or short hyphenated phrases that categorize the content by topic, domain, or theme. Even if only a title is provided, infer relevant tags from it. Only return the JSON array, nothing else.\n\nType: ${type}\nTitle: ${title}\n${contentSection}`;
}

function buildSummaryUserPrompt(type: string, title: string, body: string): string {
  return `Summarize the following content in 1-2 sentences. Be direct and informative. Only return the summary text, nothing else.\n\nType: ${type}\nTitle: ${title}\nContent: ${body.slice(0, 3000)}`;
}

function parseTags(raw: string): string[] {
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
      const tags = JSON.parse(match[0]) as string[];
      return tags
        .filter((t) => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .slice(0, 4);
    }
  } catch {
    // ignore
  }
  return [];
}

export function getAppleAiDebugStatus(hasOpenAiKey: boolean): AppleAiDebugStatus {
  if (Platform.OS !== 'ios') {
    return {
      platform: Platform.OS,
      appleProviderExposed: typeof apple === 'function',
      appleProviderAvailable: false,
      mode: hasOpenAiKey ? 'openai' : 'none',
      reason: 'Apple Foundation Models are iOS-only.',
    };
  }

  const appleProviderExposed = typeof apple === 'function';
  if (!appleProviderExposed) {
    return {
      platform: Platform.OS,
      appleProviderExposed,
      appleProviderAvailable: false,
      mode: hasOpenAiKey ? 'openai' : 'none',
      reason: 'Apple provider JS package is not loaded.',
    };
  }

  try {
    const appleProviderAvailable =
      typeof apple.isAvailable === 'function' ? apple.isAvailable() : false;

    return {
      platform: Platform.OS,
      appleProviderExposed,
      appleProviderAvailable,
      mode: appleProviderAvailable ? 'apple' : hasOpenAiKey ? 'openai' : 'none',
      reason: appleProviderAvailable
        ? 'Apple Foundation Models are available on this device.'
        : hasOpenAiKey
          ? 'Apple provider loaded, but Apple Intelligence is unavailable. OpenAI fallback will be used.'
          : 'Apple provider loaded, but Apple Intelligence is unavailable and no OpenAI key is set.',
    };
  } catch (error) {
    return {
      platform: Platform.OS,
      appleProviderExposed,
      appleProviderAvailable: false,
      mode: hasOpenAiKey ? 'openai' : 'none',
      reason: `Apple availability check threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function tryAppleFoundation(prompt: string, system: string): Promise<string> {
  if (Platform.OS !== 'ios') return '';
  try {
    if (typeof apple.isAvailable === 'function' && !apple.isAvailable()) return '';
    console.log('[mobile-ai] apple request', {
      system: clipForLog(system, 300),
      prompt: clipForLog(prompt),
    });
    const { text } = await generateText({
      model: apple(),
      system,
      prompt,
    });
    const output = text?.trim() ?? '';
    console.log('[mobile-ai] apple response', {
      output: clipForLog(output),
    });
    return output;
  } catch (error) {
    console.log('[mobile-ai] apple error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

async function openAiTags(apiKey: string, type: string, title: string, body: string): Promise<string[]> {
  const userPrompt = `Type: ${type}\nTitle: ${title}\n${body?.trim() ? `Content: ${body.slice(0, 2000)}` : '(no additional content)'}`;
  console.log('[mobile-ai] openai tags request', {
    system: clipForLog(TAG_SYSTEM_PROMPT, 300),
    prompt: clipForLog(userPrompt),
  });
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 100,
    messages: [
      { role: 'system', content: TAG_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });
  const raw = response.choices[0]?.message?.content?.trim() || '[]';
  console.log('[mobile-ai] openai tags response', {
    output: clipForLog(raw),
  });
  return parseTags(raw);
}

async function openAiSummary(apiKey: string, type: string, title: string, body: string): Promise<string> {
  const userPrompt = `Type: ${type}\nTitle: ${title}\nContent: ${body.slice(0, 3000)}`;
  console.log('[mobile-ai] openai summary request', {
    system: clipForLog(SUMMARY_SYSTEM_PROMPT, 300),
    prompt: clipForLog(userPrompt),
  });
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 150,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });
  const raw = response.choices[0]?.message?.content?.trim() || '';
  console.log('[mobile-ai] openai summary response', {
    output: clipForLog(raw),
  });
  return raw;
}

/** Same prompts as desktop `node-bridge/services/ai.ts`: Apple Intelligence first (iOS 26+ / New Arch), then OpenAI. */
export async function enrichBookmarkText(
  openaiApiKey: string | undefined,
  ctx: { title: string; description: string; url: string },
): Promise<{ tags: string[]; ai_summary: string }> {
  const type = 'bookmark';
  const body = [ctx.title, ctx.description, ctx.url].filter(Boolean).join('\n');

  let tags: string[] = [];
  let ai_summary = '';

  const tagUser = buildTagUserPrompt(type, ctx.title, body);
  const tagApple = await tryAppleFoundation(tagUser, TAG_SYSTEM_PROMPT);
  if (tagApple) tags = parseTags(tagApple);
  if (tags.length === 0 && openaiApiKey) {
    try {
      tags = await openAiTags(openaiApiKey, type, ctx.title, body);
    } catch {
      tags = [];
    }
  }

  const sumUser = buildSummaryUserPrompt(type, ctx.title, body);
  ai_summary = await tryAppleFoundation(sumUser, SUMMARY_SYSTEM_PROMPT);
  if (!ai_summary && openaiApiKey) {
    try {
      ai_summary = await openAiSummary(openaiApiKey, type, ctx.title, body);
    } catch {
      ai_summary = '';
    }
  }

  return { tags, ai_summary };
}

/** Match desktop: OpenAI text-embedding-3-small only (compatible with Stash semantic search). */
export async function maybeGenerateEmbedding(
  openaiApiKey: string | undefined,
  text: string,
): Promise<number[] | null> {
  if (!openaiApiKey?.trim() || !text.trim()) return null;
  try {
    console.log('[mobile-ai] openai embedding request', {
      input: clipForLog(text),
    });
    const client = new OpenAI({ apiKey: openaiApiKey });
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    });
    const embedding = response.data[0].embedding;
    console.log('[mobile-ai] openai embedding response', {
      dimensions: embedding.length,
    });
    return embedding;
  } catch (error) {
    console.log('[mobile-ai] openai embedding error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
