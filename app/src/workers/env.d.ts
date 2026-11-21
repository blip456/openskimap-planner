/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** build target, set from the Vite mode (app/vite.config.ts) */
  readonly VITE_TARGET: 'pwa' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
