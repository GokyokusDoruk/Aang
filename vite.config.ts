import { defineConfig } from 'vite';

// base: './' -> göreli yollar; Capacitor / PWA paketlemesinde dist/ doğrudan kullanılabilir.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
});
