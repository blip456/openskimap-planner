/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** build target, set from the Vite mode (app/vite.config.ts) */
  readonly VITE_TARGET: 'pwa' | 'desktop';
  /** app version from package.json */
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
