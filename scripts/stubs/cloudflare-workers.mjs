// Test stand-in for the `cloudflare:workers` module: tests put bindings and secrets on globalThis.__TEST_ENV__.
export const env = new Proxy({}, { get: (_t, k) => (globalThis.__TEST_ENV__ ?? {})[k] });
