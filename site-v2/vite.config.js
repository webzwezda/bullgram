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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-tonconnect': ['@tonconnect/ui-react', '@tonconnect/sdk'],
          'vendor-ton-core': ['@ton/core'],
          'vendor-ui': ['lucide-react', 'clsx', 'class-variance-authority', 'tailwind-merge']
        }
      }
    }
  },
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

