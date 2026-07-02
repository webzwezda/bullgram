import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/app/telegram-web/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 4175
  }
});
