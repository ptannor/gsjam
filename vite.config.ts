import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  define: {
    // Determine strict process.env polyfill for libraries that might need it
    'process.env': {}
  }
});