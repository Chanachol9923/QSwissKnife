import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ytHelper } from './server/ytHelper';

export default defineConfig({
  // ytHelper: local yt-dlp bridge for the YouTube Downloader (dev + preview servers only)
  plugins: [react(), ytHelper()],
  base: './',
  optimizeDeps: {
    // ffmpeg.wasm spawns its own worker; pre-bundling breaks the worker URL
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
