/** Two projects: fast unit tests (no DB) and integration tests against the docker-compose Postgres. */
const base = { preset: 'ts-jest', testEnvironment: 'node', rootDir: '.' };
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'integration', globalSetup: '<rootDir>/test/integration/global-setup.ts', testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'] },
  ],
};
