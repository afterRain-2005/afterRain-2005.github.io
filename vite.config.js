import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteOAuthPlugin from './vite-plugin-oauth.js'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteOAuthPlugin(), cloudflare()],
  base: '/',
  build: {
    outDir: 'dist',
  },
})