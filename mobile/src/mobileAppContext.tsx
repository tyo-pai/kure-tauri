import 'react-native-get-random-values';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, Platform } from 'react-native';
import { Directory } from 'expo-file-system';
import { useShareIntent } from 'expo-share-intent';
import { getAppleAiDebugStatus, type AppleAiDebugStatus } from './aiEnrichment';
import {
  addBookmarkHistory,
  getBookmarkHistory,
  type BookmarkHistoryEntry,
} from './historyStorage';
import { router } from 'expo-router';
import { getOpenAiApiKey, setOpenAiApiKey } from './settingsStorage';
import {
  clearVaultDirectoryUri,
  getVaultDirectoryState,
  setVaultDirectoryUri,
} from './vaultStorage';
import { writeBookmarkToVault } from './writeVaultBookmark';

interface MobileAppContextValue {
  loading: boolean;
  vaultUri: string | null;
  vaultLabel: string;
  vaultStatus: string;
  vaultModalVisible: boolean;
  status: string;
  shareError: string | null;
  openAiKeyDraft: string;
  appleAiDebug: AppleAiDebugStatus | null;
  history: BookmarkHistoryEntry[];
  setOpenAiKeyDraft: (value: string) => void;
  saveOpenAiKey: () => Promise<void>;
  openVaultModal: () => void;
  closeVaultModal: () => void;
  pickVault: () => Promise<void>;
  forgetVault: () => Promise<void>;
}

const MobileAppContext = createContext<MobileAppContextValue | null>(null);

function extractUrlFromText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const m = text.trim().match(/https?:\/\/[^\s]+/i);
  return m ? m[0].replace(/[),.;]+$/, '') : null;
}

function displayNameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''));
    const parts = decoded.split('/').filter(Boolean);
    return parts[parts.length - 1] || decoded;
  } catch {
    return uri;
  }
}

export function MobileAppProvider({ children }: { children: ReactNode }) {
  const [vaultUri, setVaultUri] = useState<string | null>(null);
  const [vaultLabel, setVaultLabel] = useState('');
  const [vaultStatus, setVaultStatus] = useState('');
  const [vaultModalVisible, setVaultModalVisible] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState('');
  const [appleAiDebug, setAppleAiDebug] = useState<AppleAiDebugStatus | null>(null);
  const [history, setHistory] = useState<BookmarkHistoryEntry[]>([]);
  const processedShareKey = useRef<string | null>(null);

  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntent({
    resetOnBackground: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const restoredVault = await getVaultDirectoryState();
        if (restoredVault.uri) {
          setVaultUri(restoredVault.uri);
          setVaultLabel(restoredVault.name || displayNameFromUri(restoredVault.uri));
        }
        if (restoredVault.message) {
          setVaultStatus(restoredVault.message);
        }
        if (restoredVault.needsRelink) {
          setVaultModalVisible(true);
        }

        const [savedKey, existingHistory] = await Promise.all([
          getOpenAiApiKey(),
          getBookmarkHistory(),
        ]);

        setOpenAiKeyDraft(savedKey);
        setHistory(existingHistory);

        const debug = getAppleAiDebugStatus(Boolean(savedKey.trim()));
        setAppleAiDebug(debug);
        console.log('[mobile-ai] startup', debug);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const debug = getAppleAiDebugStatus(Boolean(openAiKeyDraft.trim()));
    setAppleAiDebug(debug);
    console.log('[mobile-ai] updated', debug);
  }, [openAiKeyDraft]);

  const pickVault = useCallback(async () => {
    setVaultStatus('');
    try {
      const dir = await Directory.pickDirectoryAsync(vaultUri ?? undefined);
      const saved = await setVaultDirectoryUri(dir.uri);
      const label = saved?.name || dir.name || displayNameFromUri(dir.uri);
      setVaultUri(saved?.uri || dir.uri);
      setVaultLabel(label);
      setVaultStatus('Vault folder bookmarked and linked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open folder picker';
      if (/cancel/i.test(message)) {
        setVaultStatus('Folder selection cancelled.');
      } else {
        setVaultStatus(message);
      }
    }
  }, [vaultUri]);

  const forgetVault = useCallback(async () => {
    await clearVaultDirectoryUri();
    setVaultUri(null);
    setVaultLabel('');
    setVaultStatus('Saved vault bookmark removed.');
  }, []);

  const openVaultModal = useCallback(() => {
    setVaultModalVisible(true);
  }, []);

  const closeVaultModal = useCallback(() => {
    setVaultModalVisible(false);
  }, []);

  const saveOpenAiKey = useCallback(async () => {
    await setOpenAiApiKey(openAiKeyDraft);
    setStatus(openAiKeyDraft.trim() ? 'API key saved.' : 'OpenAI API key cleared.');
    const debug = getAppleAiDebugStatus(Boolean(openAiKeyDraft.trim()));
    setAppleAiDebug(debug);
    console.log('[mobile-ai] manual-refresh', debug);
  }, [openAiKeyDraft]);

  useEffect(() => {
    if (loading || !hasShareIntent || vaultUri) return;
    setVaultStatus('Choose the folder you want Stash to keep bookmarked before saving shared links.');
    setVaultModalVisible(true);
    router.replace('/settings');
    resetShareIntent();
  }, [loading, hasShareIntent, vaultUri, resetShareIntent]);

  useEffect(() => {
    if (loading || !hasShareIntent || !vaultUri) return;

    const run = async () => {
      const url = shareIntent.webUrl || extractUrlFromText(shareIntent.text);
      if (!url) {
        Alert.alert('Nothing to save', 'No URL found in this share.');
        resetShareIntent();
        return;
      }

      const title =
        (shareIntent.meta && typeof shareIntent.meta === 'object' && 'title' in shareIntent.meta
          ? String((shareIntent.meta as Record<string, string>).title || '')
          : '') ||
        shareIntent.text?.trim().split('\n')[0]?.slice(0, 200) ||
        url;

      const dedupeKey = `${url}:${title}`;
      if (processedShareKey.current === dedupeKey) {
        resetShareIntent();
        return;
      }
      processedShareKey.current = dedupeKey;

      setStatus('Fetching page, optional AI…');
      try {
        const metaTitle =
          shareIntent.meta && typeof shareIntent.meta === 'object' && 'title' in shareIntent.meta
            ? String((shareIntent.meta as Record<string, string>).title || '')
            : undefined;

        const result = await writeBookmarkToVault(vaultUri, {
          url,
          titleHint: title || url,
          textHint: shareIntent.text ?? undefined,
          metaTitle,
          shareMeta: shareIntent.meta ?? undefined,
          openaiApiKey: openAiKeyDraft.trim() || undefined,
        });

        const nextHistory = await addBookmarkHistory({
          id: `${result.savedAt}:${url}`,
          title: result.title,
          source: result.source,
          savedAt: result.savedAt,
        });

        setHistory(nextHistory);
        setStatus('Saved to vault. It will sync to Stash on desktop via iCloud.');
        resetShareIntent();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus('');
        processedShareKey.current = null;
        if (Platform.OS === 'ios') {
          if (/bookmark|access|permission|scoped|folder/i.test(message)) {
            setVaultStatus(`${message}\n\nChoose the folder again to restore bookmark access.`);
            setVaultModalVisible(true);
            router.replace('/settings');
          } else {
            Alert.alert('Could not write', message);
          }
        } else {
          Alert.alert('Could not write', message);
        }
      }
    };

    void run();
  }, [loading, hasShareIntent, vaultUri, shareIntent, resetShareIntent, openAiKeyDraft]);

  const value = useMemo<MobileAppContextValue>(
    () => ({
      loading,
      vaultUri,
      vaultLabel,
      vaultStatus,
      vaultModalVisible,
      status,
      shareError: shareError ?? null,
      openAiKeyDraft,
      appleAiDebug,
      history,
      setOpenAiKeyDraft,
      saveOpenAiKey,
      openVaultModal,
      closeVaultModal,
      pickVault,
      forgetVault,
    }),
    [
      loading,
      vaultUri,
      vaultLabel,
      vaultStatus,
      vaultModalVisible,
      status,
      shareError,
      openAiKeyDraft,
      appleAiDebug,
      history,
      saveOpenAiKey,
      openVaultModal,
      closeVaultModal,
      pickVault,
      forgetVault,
    ]
  );

  return <MobileAppContext.Provider value={value}>{children}</MobileAppContext.Provider>;
}

export function useMobileAppContext(): MobileAppContextValue {
  const value = useContext(MobileAppContext);
  if (!value) {
    throw new Error('useMobileAppContext must be used within MobileAppProvider');
  }
  return value;
}
