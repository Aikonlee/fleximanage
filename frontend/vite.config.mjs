import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  build: { outDir: 'build', assetsDir: 'static', manifest: true },
  server: {
    host: '127.0.0.1', port: 3001,
    proxy: {
      '/api': { target: process.env.REACT_APP_API_TARGET || 'https://localhost:3443', changeOrigin: true, secure: false },
      '/ws': { target: process.env.REACT_APP_API_TARGET || 'https://localhost:3443', changeOrigin: true, secure: false, ws: true }
    }
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/testSetup.js'], include: ['src/**/*.test.{js,jsx}'], restoreMocks: true }
});
