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
  MAX_DISPLAY_NAME_LENGTH,
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
  getDisplayName,
  setDisplayName,
  getBoardView,
  setBoardView,
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

/** The key currently holding exactly this value, or null. Never a literal. */
function keyHolding(area: Storage, value: string): string | null {
  for (let i = 0; i < area.length; i += 1) {
    const key = area.key(i);
    if (key !== null && area.getItem(key) === value) return key;
  }
  return null;
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

describe('display name — display data, sanitised on write, localStorage', () => {
  it('exports the one copy of the length limit', () => {
    // Section 17's input fields need it for maxLength; a second copy of 24 in
    // another section is a copy that drifts.
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(24);
  });

  it('round-trips a clean name and starts null', () => {
    expect(getDisplayName()).toBeNull();
    setDisplayName('Ana');
    expect(getDisplayName()).toBe('Ana');
  });

  it('writes to localStorage, not sessionStorage — it is browser-scoped, not tab-scoped', () => {
    setDisplayName('Ana');

    expect(holds(window.localStorage, 'Ana')).toBe(true);
    expect(holds(window.sessionStorage, 'Ana')).toBe(false);

    openFreshTab();
    expect(getDisplayName()).toBe('Ana');
  });

  it('REMOVES a non-whitespace control character — it is invisible junk, not a separator', () => {
    // NUL, BEL and ESC arrive in pasted text and are not word separators, so
    // "A<NUL>n<BEL>a<ESC>" is the one word "Ana". Replacing them with a space
    // instead would split one word into three, and the collapse step cannot put
    // it back together again (§3, step 1).
    setDisplayName('A\u0000n\u0007a\u001b');
    expect(getDisplayName()).toBe('Ana');
  });

  it('REPLACES a whitespace control character with a space — a spreadsheet paste is tab-separated', () => {
    // The other half of step 1, and the reason a blanket "strip U+0000–U+001F"
    // is wrong: \t, \n, \r, \v and \f all live in that range, so deleting them
    // would join the words around them into "GraceHopper".
    setDisplayName('Grace\tHopper');
    expect(getDisplayName()).toBe('Grace Hopper');
  });

  it('replaces every one of the five whitespace control characters', () => {
    for (const [name, char] of [
      ['tab', '\t'],
      ['newline', '\n'],
      ['carriage return', '\r'],
      ['vertical tab', '\v'],
      ['form feed', '\f'],
    ] as const) {
      setDisplayName(`Grace${char}Hopper`);
      expect(`${name}:${getDisplayName()}`).toBe(`${name}:Grace Hopper`);
    }
  });

  it('applies both halves of step 1 in one value', () => {
    // A tab separates; a NUL vanishes. Getting either class wrong is visible here.
    setDisplayName('Grace\tHo\u0000pper');
    expect(getDisplayName()).toBe('Grace Hopper');
  });

  it('a run of mixed control characters collapses to exactly one space', () => {
    setDisplayName('Grace\t\u0000\n\u0007 Hopper');
    expect(getDisplayName()).toBe('Grace Hopper');
  });

  it('a leading or trailing control character leaves no edge whitespace', () => {
    setDisplayName('\tGrace Hopper\n');
    expect(getDisplayName()).toBe('Grace Hopper');
  });

  it('collapses runs of whitespace and trims', () => {
    setDisplayName('   Ana    Maria \t\n Silva   ');
    expect(getDisplayName()).toBe('Ana Maria Silva');
  });

  it(`clamps to ${24} characters`, () => {
    const long = 'A'.repeat(40);
    setDisplayName(long);

    const stored = getDisplayName();
    expect(stored).not.toBeNull();
    expect((stored as string).length).toBe(MAX_DISPLAY_NAME_LENGTH);
    expect(stored).toBe('A'.repeat(MAX_DISPLAY_NAME_LENGTH));
  });

  it('trims again after clamping, when the boundary lands on a space (§3, step 5)', () => {
    // 23 characters, a space, then one more: the clamp cuts at 24, which is
    // exactly the space, and an un-trimmed result would end in it.
    const input = `${'A'.repeat(23)} B`;
    expect(input.length).toBeGreaterThan(MAX_DISPLAY_NAME_LENGTH);

    setDisplayName(input);

    const stored = getDisplayName();
    expect(stored).toBe('A'.repeat(23));
    expect(stored).not.toMatch(/\s$/);
  });

  it('clamps after sanitising, not before', () => {
    // Twenty-four visible characters separated by runs of whitespace: if the
    // clamp ran first it would cut inside the padding and lose real characters.
    setDisplayName(`${'  '}${'B'.repeat(10)}${'   '}${'C'.repeat(10)}${'  '}`);
    expect(getDisplayName()).toBe(`${'B'.repeat(10)} ${'C'.repeat(10)}`);
  });

  it('a value that sanitises to empty CLEARS the stored name', () => {
    setDisplayName('Ana');
    expect(getDisplayName()).toBe('Ana');

    setDisplayName('   \u0000  \t ');

    // Cleared, not stored as an empty string — a stored "" would be echoed back
    // to the user and put on the wire as a name they never chose.
    expect(getDisplayName()).toBeNull();
    expect(holds(window.localStorage, 'Ana')).toBe(false);
  });

  it('an empty string clears it too', () => {
    setDisplayName('Ana');
    setDisplayName('');
    expect(getDisplayName()).toBeNull();
  });

  it('is not a secret and is not room-scoped', () => {
    setDisplayName('Ana');
    // Nothing about the name is per-room or per-tab; it is the same value for
    // every room this browser joins.
    expect(getDisplayName()).toBe('Ana');
    openFreshTab();
    expect(getDisplayName()).toBe('Ana');
  });
});

describe('board view — a display preference, not a credential (24 §2.3)', () => {
  it('starts null, so an unchosen browser falls through to VITE_BOARD_VIEW', () => {
    expect(getBoardView()).toBeNull();
  });

  it("round-trips '2D'", () => {
    setBoardView('2D');
    expect(getBoardView()).toBe('2D');
  });

  it("round-trips '3D'", () => {
    setBoardView('3D');
    expect(getBoardView()).toBe('3D');
  });

  it('an unrecognised stored value reads as null — unset, not an error', () => {
    // Somebody's stale key, or a hand-edited one. 24 §2.2 treats it as UNSET so
    // it falls through to the env default: the resolution order already has an
    // answer for "no preference", and a throw here would turn a junk string
    // into a broken game screen.
    //
    // The corrupt value is written through whichever key the accessor itself
    // just used, so this test does not name a key either — the key name is not
    // part of the frozen surface, and a renamed key must fail this test rather
    // than pass it vacuously.
    setBoardView('3D');
    const key = keyHolding(window.localStorage, '3D');
    expect(key).not.toBeNull();

    window.localStorage.setItem(key as string, 'VR');
    expect(getBoardView()).toBeNull();

    window.localStorage.setItem(key as string, '');
    expect(getBoardView()).toBeNull();
  });

  it('lands in localStorage and leaves sessionStorage untouched', () => {
    setBoardView('3D');

    // Which AREA holds it is the frozen part, not the key name, so this scans
    // for the value the way every other test in this file does.
    expect(holds(window.localStorage, '3D')).toBe(true);
    expect(values(window.sessionStorage)).toEqual([]);
  });

  it('survives a fresh tab — the preference is not tab-scoped', () => {
    // The one preference a player should not have to re-make in a second tab.
    setBoardView('3D');
    openFreshTab();
    expect(getBoardView()).toBe('3D');
  });
});
