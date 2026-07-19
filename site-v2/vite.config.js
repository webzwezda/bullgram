import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  base: '/',
  server: {
    port: 5174,
    proxy: {
      '/tonconnect-manifest.json': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/auth': { target: 'https://bullgram.xyz', changeOrigin: true, secure: false },
      '/rest': { target: 'https://bullgram.xyz', changeOrigin: true, secure: false },
      '/realtime': { target: 'https://bullgram.xyz', ws: true, changeOrigin: true, secure: false }
    }
  }
});
