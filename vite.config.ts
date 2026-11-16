import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: /csp-sitepulse/; Cloudflare Pages: set VITE_BASE_PATH=/ .
export default defineConfig({
  plugins:[react()],
  base:process.env.VITE_BASE_PATH || '/csp-sitepulse/',
  build:{outDir:'dist',emptyOutDir:true},
  server:{port:5173}
});
