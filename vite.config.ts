import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@\/data\/repositories\/resilientOrdermentumViews$/,
        replacement: '/src/data/repositories/resilientOrdermentumViewsTimeoutSafe.ts'
      },
      {
        find: '@',
        replacement: '/src'
      }
    ]
  }
});
