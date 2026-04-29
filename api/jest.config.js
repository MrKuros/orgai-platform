module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['./tests/setEnv.ts'],
  setupFilesAfterEnv: ['./tests/setup.ts'],
  testTimeout: 30000
};
