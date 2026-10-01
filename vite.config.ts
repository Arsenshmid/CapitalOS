import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/CapitalOS/',
  plugins: [react()],
  server: { watch: { ignored: ['**/all_files.txt'] } },
});