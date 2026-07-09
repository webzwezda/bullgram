import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: '/pay-app/',
    build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                manualChunks: {
                    tonconnect: ['@tonconnect/ui-react', '@ton/core', 'buffer']
                }
            }
        }
    }
});
