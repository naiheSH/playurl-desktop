/// <reference types="vite/client" />

interface Window {
  playurl: {
    config(): Promise<{ apiBase: string; platform: string; version: string }>
    copy(value: string): Promise<void>
    login(provider: string): Promise<{ ok: boolean; message: string }>
  }
}
