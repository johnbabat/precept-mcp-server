import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped storage for the decrypted Precept API key.
 * Imported by both index.ts and tools.ts — lives in its own module
 * to avoid circular dependencies.
 */
export const apiKeyStorage = new AsyncLocalStorage<string | undefined>();
