/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TAURI_PLATFORM?: string
  readonly TAURI_FAMILY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
