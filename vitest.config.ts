import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/vitest/**/*.test.ts'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
