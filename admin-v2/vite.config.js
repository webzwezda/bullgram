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
    build: analyze
      ? {
          rollupOptions: {
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
          }
        }
      : undefined,
    server: {
      port: 4174
    }
  };
});
