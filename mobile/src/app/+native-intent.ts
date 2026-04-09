export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // expo-share-intent opens the app with URLs like `stash://dataUrl=...`.
  // Expo Router treats that as a route unless we normalize it first.
  if (path.includes('dataUrl=')) {
    return '/';
  }

  return path;
}
