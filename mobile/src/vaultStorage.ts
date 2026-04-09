import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

const VAULT_URI_KEY = 'stash_vault_directory_uri';

interface NativeBookmarkRecord {
  uri: string;
  name?: string | null;
  hasAccess?: boolean;
}

interface VaultBookmarkNativeModule {
  saveBookmark(uri: string): Promise<NativeBookmarkRecord | null>;
  restoreBookmark(): Promise<NativeBookmarkRecord | null>;
  clearBookmark(): Promise<void>;
}

const nativeVaultBookmark = NativeModules.StashVaultBookmark as VaultBookmarkNativeModule | undefined;

export interface VaultDirectoryState {
  uri: string | null;
  name?: string | null;
  message?: string | null;
  needsRelink: boolean;
}

export async function getVaultDirectoryState(): Promise<VaultDirectoryState> {
  if (Platform.OS === 'ios' && nativeVaultBookmark?.restoreBookmark) {
    const cachedUri = await AsyncStorage.getItem(VAULT_URI_KEY);
    try {
      const restored = await nativeVaultBookmark.restoreBookmark();
      const uri = restored?.uri ?? null;
      if (uri) {
        await AsyncStorage.setItem(VAULT_URI_KEY, uri);
        return {
          uri,
          name: restored?.name ?? null,
          message: null,
          needsRelink: false,
        };
      } else {
        await AsyncStorage.removeItem(VAULT_URI_KEY);
        return {
          uri: null,
          name: null,
          message: cachedUri ? 'Vault access expired. Choose the folder again to keep it bookmarked.' : null,
          needsRelink: Boolean(cachedUri),
        };
      }
    } catch (error) {
      console.warn('[vault-storage] could not restore security-scoped bookmark', error);
      await AsyncStorage.removeItem(VAULT_URI_KEY);
      return {
        uri: null,
        name: null,
        message: cachedUri ? 'Vault access expired. Choose the folder again to keep it bookmarked.' : null,
        needsRelink: Boolean(cachedUri),
      };
    }
  }

  const uri = await AsyncStorage.getItem(VAULT_URI_KEY);
  return {
    uri,
    name: uri ? decodeURIComponent(uri.replace(/^file:\/\//, '').split('/').filter(Boolean).pop() || uri) : null,
    message: null,
    needsRelink: false,
  };
}

export async function setVaultDirectoryUri(uri: string): Promise<NativeBookmarkRecord | null> {
  let result: NativeBookmarkRecord | null = null;
  if (Platform.OS === 'ios' && nativeVaultBookmark?.saveBookmark) {
    result = await nativeVaultBookmark.saveBookmark(uri);
  }
  await AsyncStorage.setItem(VAULT_URI_KEY, uri);
  return result;
}

export async function clearVaultDirectoryUri(): Promise<void> {
  if (Platform.OS === 'ios' && nativeVaultBookmark?.clearBookmark) {
    await nativeVaultBookmark.clearBookmark();
  }
  await AsyncStorage.removeItem(VAULT_URI_KEY);
}
