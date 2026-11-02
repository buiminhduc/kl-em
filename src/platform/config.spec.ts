import { loadConfig } from './config';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('enables Swagger by default outside production', () => {
    expect(loadConfig({ ...base }).swaggerEnabled).toBe(true);
  });
  it('disables Swagger by default in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).swaggerEnabled).toBe(false);
  });
  it('lets SWAGGER_ENABLED override the default', () => {
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).swaggerEnabled,
    ).toBe(true);
    expect(loadConfig({ ...base, SWAGGER_ENABLED: 'false' }).swaggerEnabled).toBe(false);
  });
  it('rejects a malformed flag', () => {
    expect(() => loadConfig({ ...base, SWAGGER_ENABLED: 'yes' })).toThrow(/SWAGGER_ENABLED/);
  });
});
