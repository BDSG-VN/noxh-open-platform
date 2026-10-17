import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Inactive unless NOXH_TEST_RUNTIME_ROLE=1 (least-privilege replay of the API suite).
    setupFiles: ['./src/test-runtime-role.ts'],
  },
});
