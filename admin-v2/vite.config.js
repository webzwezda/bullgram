import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(() => {
  const analyze = process.env.ANALYZE === 'true';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    base: '/app/',
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-tonconnect': ['@tonconnect/ui-react', '@tonconnect/sdk'],
            'vendor-ton-core': ['@ton/core', '@ton/crypto'],
            'vendor-ui': ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover', '@radix-ui/react-toast', '@radix-ui/react-tooltip', 'sonner', 'classnames', 'clsx', 'class-variance-authority', 'tailwind-merge']
          }
        },
        ...(analyze ? {
          plugins: [
            visualizer({
              filename: 'dist/bundle-stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true
            }),
            visualizer({
              filename: 'dist/bundle-stats.json',
              template: 'raw-data',
              gzipSize: true,
              brotliSize: true
            })
          ]
        } : {})
      }
    },
    server: {
      port: 4174,
      proxy: {
        '/tonconnect-manifest.json': 'http://localhost:3000',
        '/api': 'http://localhost:3000',
        '/auth': { target: 'https://bullgram.xyz', changeOrigin: true, secure: false },
        '/rest': { target: 'https://bullgram.xyz', changeOrigin: true, secure: false },
        '/realtime': { target: 'https://bullgram.xyz', ws: true, changeOrigin: true, secure: false }
      }
    }
  };
});
