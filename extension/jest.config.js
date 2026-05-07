module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/src/__mocks__/vscode.ts'
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/test/suite/',
    'extension.test.ts'
  ]
};
