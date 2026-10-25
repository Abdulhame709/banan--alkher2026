/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_EDGE_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
