import AsyncStorage from '@react-native-async-storage/async-storage';

const BOOKMARK_HISTORY_KEY = 'stash_bookmark_history_v1';
const MAX_HISTORY_ITEMS = 100;

export interface BookmarkHistoryEntry {
  id: string;
  title: string;
  source: string;
  savedAt: string;
}

export async function getBookmarkHistory(): Promise<BookmarkHistoryEntry[]> {
  const raw = await AsyncStorage.getItem(BOOKMARK_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BookmarkHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addBookmarkHistory(entry: BookmarkHistoryEntry): Promise<BookmarkHistoryEntry[]> {
  const current = await getBookmarkHistory();
  const next = [entry, ...current].slice(0, MAX_HISTORY_ITEMS);
  await AsyncStorage.setItem(BOOKMARK_HISTORY_KEY, JSON.stringify(next));
  return next;
}
