/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RISEIN_CONTRACT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
