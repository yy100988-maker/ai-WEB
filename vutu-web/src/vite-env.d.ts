/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端基地址；留空则走 vite 代理（/v1 → 127.0.0.1:3000） */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
