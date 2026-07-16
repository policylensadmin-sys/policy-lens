import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite build/dev configuration for the PolicyLens frontend SPA.
// Test configuration lives separately in vitest.config.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
