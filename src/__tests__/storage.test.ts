/**
 * `src/utils/storage.ts` — the whole public surface of 16 §3.
 *
 * Covers acceptance criteria 8, 13, 16 and failure modes 6 and 10.
 *
 * Key NAMES (other than `GUEST_ID_KEY`) are not part of the frozen surface, so
 * nothing here asserts on one: the tests scan the storage area for the *value*
 * instead. What is frozen is which storage area each secret lands in, and that
 * is what is asserted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GUEST_ID_KEY,
  getAlias,
  setAlias,
  getGuestId,
  getOrCreateGuestId,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  getHostSecret,
  setHostSecret,
  clearHostSecret,
  setHostRoom,
  isHostForRoom,
  clearHostRoom,
} from '../utils/storage';

const ROOM = 'ABCD12';
const OTHER_ROOM = 'ZZZZ99';

/** Every value currently held in a storage area, regardless of key naming. */
function values(area: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < area.length; i += 1) {
    const key = area.key(i);
    if (key === null) continue;
    const value = area.getItem(key);
    if (value !== null) out.push(value);
  }
  return out;
}

/** True when the value appears anywhere in the area — as a value or inside one. */
function holds(area: Storage, value: string): boolean {
  return values(area).some((v) => v === value || v.includes(value));
}

/** Simulates opening a brand-new browser tab: sessionStorage is per-tab. */
function openFreshTab(): void {
  window.sessionStorage.clear();
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('alias — the public, server-assigned id', () => {
  it('round-trips through localStorage and starts null', () => {
    expect(getAlias()).toBeNull();
    setAlias('P3');
    expect(getAlias()).toBe('P3');
    expect(holds(window.localStorage, 'P3')).toBe(true);
  });

  it('survives a fresh tab — the alias is not tab-scoped', () => {
    setAlias('P2');
    openFreshTab();
    expect(getAlias()).toBe('P2');
  });
});

describe('guest identity (criterion 8, failure mode 10)', () => {
  it('getGuestId() is null before anything mints one', () => {
    expect(getGuestId()).toBeNull();
  });

  it('getOrCreateGuestId() matches /^guest_[0-9a-f-]{36}$/', () => {
    const id = getOrCreateGuestId();
    expect(id).toMatch(/^guest_[0-9a-f-]{36}$/);
  });

  it('getOrCreateGuestId() returns the same value across calls (criterion 8)', () => {
    const first = getOrCreateGuestId();
    expect(getOrCreateGuestId()).toBe(first);
    expect(getGuestId()).toBe(first);
  });

  it('FAILURE MODE 10: ten calls mint exactly one id', () => {
    // A regenerated guest id loses the player's seat on reconnect: the server
    // matches a reconnecting player by identity (00-conventions §2), so a new
    // `guest_<uuid4>` is a different person.
    const seen = new Set<string>();
    for (let i = 0; i < 10; i += 1) seen.add(getOrCreateGuestId());
    expect(seen.size).toBe(1);
  });

  it('persists under the frozen GUEST_ID_KEY in localStorage', () => {
    expect(GUEST_ID_KEY).toBe('guest_id');
    const id = getOrCreateGuestId();
    expect(window.localStorage.getItem(GUEST_ID_KEY)).toBe(id);
    // localStorage, not sessionStorage: the identity must survive a new tab.
    expect(window.sessionStorage.getItem(GUEST_ID_KEY)).toBeNull();
    openFreshTab();
    expect(getGuestId()).toBe(id);
  });
});

describe('session_token — secret, per room, localStorage (criterion 13)', () => {
  it('setSessionToken writes to localStorage and NOT to sessionStorage', () => {
    setSessionToken(ROOM, 'tok-abc');

    expect(getSessionToken(ROOM)).toBe('tok-abc');
    expect(holds(window.localStorage, 'tok-abc')).toBe(true);
    expect(holds(window.sessionStorage, 'tok-abc')).toBe(false);
  });

  it('is scoped per room', () => {
    setSessionToken(ROOM, 'tok-abc');
    expect(getSessionToken(OTHER_ROOM)).toBeNull();

    setSessionToken(OTHER_ROOM, 'tok-zzz');
    expect(getSessionToken(ROOM)).toBe('tok-abc');
    expect(getSessionToken(OTHER_ROOM)).toBe('tok-zzz');
  });

  it('clearSessionToken removes only that room', () => {
    setSessionToken(ROOM, 'tok-abc');
    setSessionToken(OTHER_ROOM, 'tok-zzz');

    clearSessionToken(ROOM);

    expect(getSessionToken(ROOM)).toBeNull();
    expect(getSessionToken(OTHER_ROOM)).toBe('tok-zzz');
    expect(holds(window.localStorage, 'tok-abc')).toBe(false);
  });

  it('survives a fresh tab — reconnect must work after the tab is reopened', () => {
    setSessionToken(ROOM, 'tok-abc');
    openFreshTab();
    expect(getSessionToken(ROOM)).toBe('tok-abc');
  });
});

describe('host_secret — secret, per room, sessionStorage (criterion 13, failure mode 6)', () => {
  it('FAILURE MODE 6: setHostSecret writes to sessionStorage ONLY', () => {
    // localStorage would leak host authority into every tab of the browser,
    // including one opened from an invite link. D18's identity recovery buys
    // back the durability this costs; widening the storage scope does not.
    setHostSecret(ROOM, 'hs-secret');

    expect(getHostSecret(ROOM)).toBe('hs-secret');
    expect(holds(window.sessionStorage, 'hs-secret')).toBe(true);
    expect(holds(window.localStorage, 'hs-secret')).toBe(false);
  });

  it('is gone in a fresh tab — this is the case D18 recovery exists for', () => {
    setHostSecret(ROOM, 'hs-secret');
    openFreshTab();
    expect(getHostSecret(ROOM)).toBeNull();
  });

  it('is scoped per room and cleared per room', () => {
    setHostSecret(ROOM, 'hs-a');
    setHostSecret(OTHER_ROOM, 'hs-b');
    expect(getHostSecret(ROOM)).toBe('hs-a');
    expect(getHostSecret(OTHER_ROOM)).toBe('hs-b');

    clearHostSecret(ROOM);

    expect(getHostSecret(ROOM)).toBeNull();
    expect(getHostSecret(OTHER_ROOM)).toBe('hs-b');
  });

  it('returns null for a room that never had one', () => {
    expect(getHostSecret(ROOM)).toBeNull();
  });
});

describe('host claim — UI hint only, tab-scoped (criterion 16)', () => {
  it('setHostRoom/isHostForRoom round-trip, per room', () => {
    expect(isHostForRoom(ROOM)).toBe(false);

    setHostRoom(ROOM);

    expect(isHostForRoom(ROOM)).toBe(true);
    expect(isHostForRoom(OTHER_ROOM)).toBe(false);
  });

  it('CRITERION 16: false in a fresh tab even when localStorage holds a session token', () => {
    setHostRoom(ROOM);
    setSessionToken(ROOM, 'tok-abc');
    expect(isHostForRoom(ROOM)).toBe(true);

    openFreshTab(); // same browser, new tab: localStorage survives, sessionStorage does not

    expect(getSessionToken(ROOM)).toBe('tok-abc'); // still there...
    expect(isHostForRoom(ROOM)).toBe(false); // ...but the host claim is not
  });

  it('the host claim never lands in localStorage', () => {
    setHostRoom(ROOM);
    expect(holds(window.localStorage, ROOM)).toBe(false);
  });

  it('clearHostRoom drops the claim', () => {
    setHostRoom(ROOM);
    clearHostRoom();
    expect(isHostForRoom(ROOM)).toBe(false);
  });
});
