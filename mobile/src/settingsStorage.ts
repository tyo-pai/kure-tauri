import AsyncStorage from '@react-native-async-storage/async-storage';

const OPENAI_KEY = 'stash_openai_api_key';

export async function getOpenAiApiKey(): Promise<string> {
  return (await AsyncStorage.getItem(OPENAI_KEY)) ?? '';
}

export async function setOpenAiApiKey(key: string): Promise<void> {
  if (!key.trim()) {
    await AsyncStorage.removeItem(OPENAI_KEY);
    return;
  }
  await AsyncStorage.setItem(OPENAI_KEY, key.trim());
}
