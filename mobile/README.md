# Stash mobile companion (Expo)

Share URLs from iOS or Android into the same filesystem vault the desktop app uses (e.g. a folder in iCloud Drive).

## Requirements

- **Dev client** — `expo-share-intent` does not run in Expo Go. Use a development or production native build.
- **New Architecture** — enabled in `app.json` for [`@react-native-ai/apple`](https://www.npmjs.com/package/@react-native-ai/apple) (Apple Foundation / Apple Intelligence on supported iOS).
- **npm** — `.npmrc` sets `legacy-peer-deps` for the Expo canary SDK.
- **Xcode patch** — `patch-package` runs on `npm install` and applies the `xcode` patch under `patches/`.

## First-time native project

```bash
cd mobile
npm install --legacy-peer-deps
npx expo prebuild
```

Open the workspace in Xcode, set your **Development Team** for the app and Share Extension targets, then run from Xcode or use `npx expo run:ios`.

After adding native modules (e.g. Apple LLM), run **`npx expo prebuild`** again before building.

## Vault folder on iOS

Use **Choose vault folder** and pick the same directory as on macOS. iOS grants write access for the **current session**; if writes fail after a cold start, pick the folder again.

## TurboModule `NativeAppleEmbeddings` error

`@react-native-ai/apple` used to call `getEnforcing` for **every** native submodule (embeddings, speech, etc.) as soon as the JS package loaded, even though Stash only uses **on-device chat** for tags/summary. If any of those modules were missing from the binary, the app crashed at startup.

We ship a **`patch-package`** patch ([`patches/@react-native-ai+apple+0.12.0.patch`](patches/@react-native-ai+apple+0.12.0.patch)) that uses `TurboModuleRegistry.get` + stubs for embeddings / speech / transcription so missing optional modules no longer abort the runtime. **Still run `npx expo prebuild` + a full Xcode rebuild** after native dependency changes so `NativeAppleLLM` is present for actual Apple Intelligence text.

## Metadata and AI

- **HTML scrape** — same pipeline as desktop via shared [`@stash/url-metadata`](../packages/url-metadata) (Open Graph, JSON-LD price, X/Twitter syndication).
- **Tags & summary** — on **iOS**, tries **Apple Intelligence** through `@react-native-ai/apple` + Vercel `ai` when `apple.isAvailable()`; otherwise falls back to **OpenAI** (`gpt-4o-mini`) if you save an API key in the app.
- **Embeddings** — **OpenAI only** (`text-embedding-3-small`), same as desktop, so semantic search stays compatible. Apple text embeddings are not written to vault notes.

## Verify Markdown matches desktop

```bash
npm run verify:vault-format
```

This runs `@stash/vault-io` tests that assert IDs, slugified filenames, and frontmatter match the desktop vault parser.

## E2E check with desktop

1. Pick an iCloud (or shared) vault folder in the mobile app and in desktop Stash.
2. Share a URL from Safari into **Stash**.
3. Confirm a new `.md` file appears in the vault on disk and shows up in the desktop library after sync.
