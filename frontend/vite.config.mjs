import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

function resolveBuildRev() {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
    if (sha) return sha;
  } catch (_err) { /* no .git, or git is not installed */ }
  return process.env.BUILD_REV || process.env.VITE_BUILD_REV || 'dev';
}

const buildRev = resolveBuildRev();

export default defineConfig({
  define: { __BUILD_REV__: JSON.stringify(buildRev) },
  plugins: [react()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  build: { outDir: 'build', assetsDir: 'static', manifest: true, emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 3001,
    proxy: {
      '/api': { target: process.env.REACT_APP_API_TARGET || 'https://localhost:3443', changeOrigin: true, secure: false },
      '/ws': { target: process.env.REACT_APP_API_TARGET || 'https://localhost:3443', changeOrigin: true, secure: false, ws: true }
    }
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/testSetup.js'], include: ['src/**/*.test.{js,jsx}'], restoreMocks: true }
});
