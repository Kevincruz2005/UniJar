import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const manifest = JSON.parse(readFileSync(resolve(env.UNIJAR_MANIFEST ?? '../deployments/sepolia.json'), 'utf8'));
  if (manifest.chainId !== 11155111 && !(mode === 'test' && manifest.chainId === 31337)) {
    throw new Error('Production frontend must use the verified Sepolia deployment.');
  }
  const { chainId, sourceCommit, addresses, deployments } = manifest;
  const proxy = { '/api': { target: env.API_PROXY_TARGET ?? 'https://unijar-api.purplewater-5aec7560.centralindia.azurecontainerapps.io', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/, '') } };
  return {
    plugins: [react()],
    define: { __DEPLOYMENT__: JSON.stringify({ chainId, sourceCommit, addresses, deployments }) },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: { sourcemap: false },
  };
});
