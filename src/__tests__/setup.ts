/**
 * Vitest setup file — named by `vite.config.ts`'s `test.setupFiles`
 * (16-frontend-foundation.md §2). Owned by the test agent.
 *
 * Responsibilities, and nothing else:
 *  - register `@testing-library/jest-dom`'s matchers,
 *  - unmount React trees between tests,
 *  - give every test file a clean `localStorage` AND a clean `sessionStorage`.
 *
 * NOTE: the two Web Storage areas are deliberately left as jsdom's real
 * implementations. Section 16 §5.13 and §6.6 turn on the *difference* between
 * them (`session_token` in `localStorage`, `host_secret` in `sessionStorage`),
 * so a test double that conflates them would make the most important storage
 * assertion in the section unfalsifiable.
 */
import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Guarantee both Web Storage areas exist.
 *
 * Node's own experimental `localStorage` global is `undefined` unless the
 * process was started with `--localstorage-file`, and on a Node newer than the
 * pinned 20.19/22.12 it shadows the one jsdom provides — so `window.localStorage`
 * comes back undefined while `window.sessionStorage` works. That is a property
 * of the runtime, not of anything section 16 builds, so the harness fills it in
 * rather than letting every storage assertion fail for the wrong reason.
 */
function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (window as unknown as Record<string, unknown>)[name] as Storage | undefined;
  if (existing && typeof existing.getItem === 'function') return;

  const entries = new Map<string, string>();
  const area: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => (entries.has(String(key)) ? (entries.get(String(key)) as string) : null),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
  };

  for (const target of new Set<object>([window, globalThis])) {
    Object.defineProperty(target, name, { value: area, writable: true, configurable: true });
  }
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

/**
 * Supply the Firebase web config the way `.env` does in development.
 *
 * §4.11 requires `firebase.ts` to fail loudly at module load when a required
 * `VITE_FIREBASE_*` variable is absent — a hardcoded fallback would silently
 * authenticate against a sibling game's project. That rule is correct and is
 * not weakened here: the harness provides the variables instead, so the module
 * is exercised as written. Any value that is really set (a developer's `.env`,
 * or CI) wins.
 */
const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

for (const key of FIREBASE_ENV_KEYS) {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  if (!env[key]) vi.stubEnv(key, `test-${key.toLowerCase()}`);
}

beforeEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* jsdom always provides both; ignore a hostile environment */
  }
  // Every test starts at the app root unless it navigates deliberately.
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom gaps that component code routinely assumes exist.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.scrollTo) {
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
}
