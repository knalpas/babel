import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves from https://<user>.github.io/<repo>/
  base: process.env.VITE_BASE ?? '/babel/',
})
