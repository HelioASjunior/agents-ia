import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.XINOIA_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // A interface pode ser servida de qualquer pasta, como dentro do app empacotado.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/ws': { target: api, ws: true },
    },
  },
});
