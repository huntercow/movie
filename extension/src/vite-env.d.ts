/// <reference types="vite/client" />

interface ImportMeta {
  readonly env: {
    readonly DEV: boolean;
    readonly VITE_TRACE_ENABLED?: string;
  };
}
