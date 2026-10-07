import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // The Supabase URL and key are baked into the site at build time; without them the app would ship blank.
  const env = loadEnv(mode, '.')
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) throw new Error('Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env before building.')
  return { plugins: [react()], build: { chunkSizeWarningLimit: 800 } }
})
