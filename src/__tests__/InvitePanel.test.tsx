/**
 * `17-frontend-lobby.md §2.4` — the invite panel and its self-contained QR
 * encoder, `src/components/lobby/qrcode.ts`.
 *
 * Covers acceptance criteria 28 and 29.
 *
 * D16 pins the toolchain and `package.json` belongs to section 16, so this
 * section hand-writes a byte-mode encoder at error-correction level **M** for
 * versions 1-6 rather than re-opening a gated section for one projector
 * affordance. That makes it the only real algorithm this section owns, and an
 * owned algorithm with no test is the worst of both worlds.
 *
 * The oracle is external. `MASK_FIXTURES` below was produced by the Python
 * `qrcode` reference implementation - `QRCode(error_correction=ERROR_CORRECT_M,
 * border=0, mask_pattern=k)`, `add_data(url, optimize=0)` for a single
 * byte-mode segment, `make(fit=True)`, `get_matrix()` - so this file compares
 * the encoder against something that was not derived from it.
 *
 * **All eight mask patterns are fixtures, and matching any one of them passes**,
 * as AC 28 now requires. A QR symbol carries its mask in its own format
 * information and all eight decode to the same data, so ISO 18004 does not fix
 * the choice and neither does this section. The check stays complete: the data
 * encoding, the error-correction codewords, the module placement and the format
 * bits must all be exactly right for *any* of the eight to match.
 *
 * The byte-mode capacities at level M are 14, 26, 42, 62, 84 and 106 for
 * versions 1 to 6, which is where §2.4's 106-byte cut-off comes from: 107 bytes
 * needs version 7, and there is no version 7.
 */
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { encodeQr } from '../components/lobby/qrcode';
import * as InvitePanelModule from '../components/lobby/InvitePanel';

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

/** A real invite link in §3.1's shape: `${origin}/join/${roomCode}`. */
const FIXTURE_URL = 'https://beery.example.com/join/ABC234';

/**
 * The reference matrices for `FIXTURE_URL`: 37 bytes, so version 3 (29 x 29),
 * level M, no quiet zone, one entry per mask pattern. `#` is a dark module.
 */
const MASK_FIXTURES: string[][] = [
  // mask pattern 0
  [
    '#######...#....##.##..#######',
    '#.....#.#....####..#..#.....#',
    '#.###.#.....#.###..#..#.###.#',
    '#.###.#..##.##.##.#...#.###.#',
    '#.###.#.#....########.#.###.#',
    '#.....#.......##..###.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '.........####....####........',
    '#.#.#.#...#.#....#..#...#..#.',
    '#.##...###...#......#.#..#..#',
    '..#...####..#.#.....#.....###',
    '.....#.#....###..####..#...#.',
    '#...#.##..#...#.#####.##.#.##',
    '##.##..#..###.###...###..#..#',
    '###.###.#..#.#..##..##.###.##',
    '#.##...#..#......###.##..#.#.',
    '#.#..##...#.....##...##..#.##',
    '.##..#.####.##.##...###..##.#',
    '#.##.##.####..#..##..####..##',
    '.##......#...###.#.##....#.#.',
    '#.#..##.#.##..#.##.######....',
    '........#...#.###..##...#.###',
    '#######...####...#.##.#.##.##',
    '#.....#...##....###.#...##...',
    '#.###.#.#####..###..#####..##',
    '#.###.#...##.#.........##.###',
    '#.###.#.#...##..#.#.##.###..#',
    '#.....#...#####.#########..#.',
    '#######.#.#..#.###.##.#.#..##',
  ],
  // mask pattern 1
  [
    '#######.####.#..###...#######',
    '#.....#..#.#..#.##....#.....#',
    '#.###.#.##.####.##....#.###.#',
    '#.###.#...###...####..#.###.#',
    '#.###.#..#.#..#.#.#.#.#.###.#',
    '#.....#.##.#.##..##.#.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '..........#.##.#..#.#........',
    '#.#...##.#####.#...##..#..#.#',
    '###..#..#..#...#.#.#####...##',
    '.###.##.#..#####.#.###.#.##.#',
    '.#.#.....#.##.##..#.##...#...',
    '##.####..###.####.#.###.....#',
    '#...##...##.###.##.##.##...##',
    '#.###.####.....##..##...#...#',
    '###..#...###.#.#..#...##.....',
    '####..##.###.#.##..#..##....#',
    '..##....#.###...##.##.##..###',
    '###...###.#..###..##..#.##..#',
    '..##.#.#...#..#.....##.#.....',
    '####..#####..####...######.#.',
    '........##.####.##..#...###.#',
    '#######.###.#..#....#.#.#...#',
    '#.....#..##..#.##.###...#..#.',
    '#.###.#...#.##..#..#######..#',
    '#.###.#..##....#.#.#.#..###.#',
    '#.###.#.##.##..######...#..##',
    '#.....#..##.#.###.#.#.#.##...',
    '#######.####....#...######..#',
  ],
  // mask pattern 2
  [
    '#######..#....#...###.#######',
    '#.....#....##.#####...#.....#',
    '#.###.#.###.#......##.#.###.#',
    '#.###.#.####...###.#..#.###.#',
    '#.###.#.###..#...###..#.###.#',
    '#.....#.#..#####.#..#.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '........###..#......#........',
    '#.#####..#..#.####....#####..',
    '.###.#..##.##....####.###...#',
    '...##.##..#.#..##....##......',
    '##.........#..#.....#...##.#.',
    '#.##..####.....#.###.#.#.##..',
    '...###....#..############...#',
    '##.#.##..###.###.#....#####..',
    '.###.#....####.......####..#.',
    '#..####.##....##.#..#....##..',
    '#.#.....####...##########.#.#',
    '#...###....#...####.#..##.#..',
    '#.#..#.#.#.##.##..#.#..##..#.',
    '#..####..#.#...#.#.######.###',
    '........#..#.######.#...#####',
    '#######..#.#######.##.#.###..',
    '#.....#.#.#.##..#..##...#....',
    '#.###.#.#..##.#..#..#####.#..',
    '#.###.#.#.#.#....###.....####',
    '#.###.#.###.####..#...######.',
    '#.....#...#...#.#...###..#.#.',
    '#######.##...##..#.#.#..#.#..',
  ],
  // mask pattern 3
  [
    '#######.##....#...###.#######',
    '#.....#.##......#...#.#.....#',
    '#.###.#......#.##.#.#.#.###.#',
    '#.###.#.####...###.#..#.###.#',
    '#.###.#...######...##.#.###.#',
    '#.....#..###..#.#####.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '........#.######.##..........',
    '#.##.###..#..##..###..#..#.##',
    '.###.#..##.##....####.###...#',
    '#.#.########..#.###.#.###.##.',
    '...##..#.########.#####.....#',
    '#.##..####.....#.###.#.#.##..',
    '#.#.#...######..#..#..#...###',
    '....####...##.#.####.#.#..###',
    '.###.#....####.......####..#.',
    '..#.#.#....##.....#..#.###.#.',
    '.####..##..###...#..#..#.###.',
    '#...###....#...####.#..##.#..',
    '...#...##........#...#....#..',
    '.#...###..####..###.#######..',
    '........#..#.######.#...#####',
    '#######.#....#..#.###.#.##.#.',
    '#.....#.##.....#..#.#...##.##',
    '#.###.#....##.#..#..#####.#..',
    '#.###.#.####..##...###.###..#',
    '#.###.#.#.....#.#..#.#.#..#.#',
    '#.....#...#...#.#...###..#.#.',
    '#######.#..###.#..###..#...#.',
  ],
  // mask pattern 4
  [
    '#######.#....#.#..#...#######',
    '#.....#..#.###..#####.#.....#',
    '#.###.#..#.#....#####.#.###.#',
    '#.###.#.##..#..#..##..#.###.#',
    '#.###.#.#.#...##.##.#.#.###.#',
    '#.....#.##.##....#.#..#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '........##.###..###.#........',
    '#...#.###...##..##.#######..#',
    '.....#.#...#####.##..########',
    '#..#.###...#...#.##..#.##...#',
    '.#..##....#.#.#.###.#.##.#.##',
    '##....#......##..##.#..#...#.',
    '.##.##.####.....###...#######',
    '.#.##.#..#..#####.#......##.#',
    '#####........#..###..#.....##',
    '###.####.....#...#.#.#.....#.',
    '##.#...#..##.##.###...####.##',
    '......#...#.#..#....#.#...#.#',
    '..#.#..#.##...####..#.#....##',
    '###.#####..#.##..#..######..#',
    '........##.#....#####...#...#',
    '#######.###..###..###.#.###.#',
    '#.....#....#.#...####...#...#',
    '#.###.#.##.###.#.#.#######.#.',
    '#.###.#..##.####.##.##......#',
    '#.###.#..#.#.#####.......####',
    '#.....#....##.#..##.##.###.##',
    '#######.#......#.#..#...##.#.',
  ],
  // mask pattern 5
  [
    '#######..###.#..###...#######',
    '#.....#.##.##.#.###...#.....#',
    '#.###.#.###.#......##.#.###.#',
    '#.###.#.#..#..#..#.##.#.###.#',
    '#.###.#..##..#...###..#.###.#',
    '#.....#..#.####..#..#.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '........#.#..#.#....#........',
    '#.....#.##..#.####...##..###.',
    '.#..##....###.######.#.##.##.',
    '...##.##..#.#..##....##......',
    '##.#.....#.#..##....##..##...',
    '##.####..###.####.#.###.....#',
    '....##...##..##.#####.###..##',
    '##.#.##..###.###.#....#####..',
    '.#..##..##.######...#..##.#.#',
    '#..####.##....##.#..#....##..',
    '#.##....#.##....#####.###.###',
    '###...###.#..###..##..#.##..#',
    '#.##.#.#...##.#...#.##.##....',
    '#..####..#.#...#.#.######.###',
    '........####.#...##.#...##...',
    '#######..#.#######.##.#.###..',
    '#.....#..##.##.##..##...#..#.',
    '#.###.#...#.##..#..#######..#',
    '#.###.#..##.#..#.###.#...##.#',
    '#.###.#..##.####..#...######.',
    '#.....#..#.....#.........##.#',
    '#######.##...##..#.#.#..#.#..',
  ],
  // mask pattern 6
  [
    '#######.####.#..###...#######',
    '#.....#.##.###..#####.#.....#',
    '#.###.#.##..##..#...#.#.###.#',
    '#.###.#....#..#..#.##.#.###.#',
    '#.###.#.####.##...###.#.###.#',
    '#.....#..##.###.#...#.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '..........#...##...#.........',
    '#..########.####.#.#.#..#.###',
    '.#..##....###.######.#.##.##.',
    '..#######.###.####..####..#..',
    '##.###...##...####..######..#',
    '##.####..###.####.#.###.....#',
    '.##.##.####.....###...#######',
    '#..#####.#.#..####.#...##.#.#',
    '.#..##..##.######...#..##.#.#',
    '#.###.#..#.#...#.......#.#...',
    '#.####..#.........###...#.##.',
    '###...###.#..###..##..#.##..#',
    '##.#.#..#..###....##.#.####..',
    '##.#.###.###.#.###..########.',
    '........####.#...##.#...##...',
    '#######.##..##.##..##.#.##...',
    '#.....#.##.###.#.#.##...#..##',
    '#.###.#.#.#.##..#..#######..#',
    '#.###.#.###.####.##.##......#',
    '#.###.#..#..#.###.##...##.###',
    '#.....#..#.....#.........##.#',
    '#######.##.#.#.....###.##....',
  ],
  // mask pattern 7
  [
    '#######...#....##.##..#######',
    '#.....#...#...##......#.....#',
    '#.###.#....##..###.##.#.###.#',
    '#.###.#..##.##.##.#...#.###.#',
    '#.###.#...#...##.##.#.#.###.#',
    '#.....#.#..#...#.###..#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '.........#.###..###.#........',
    '#..#.##.#.###.#......#.#.....',
    '#.##...###...#......#.#..#..#',
    '.##.#.#.###.###.#..##.#..###.',
    '..#....##..###....##......##.',
    '#...#.##..#...#.#####.##.#.##',
    '#..#.......#####...###.......',
    '##..#.#......##.#....#..#####',
    '#.##...#..#......###.##..#.#.',
    '###.####.....#...#.#.#.....#.',
    '.#.....#.#########...###.#..#',
    '#.##.##.####..#..##..####..##',
    '..#.#..#.##...####..#.#....##',
    '#.....#...#.....#..######.#..',
    '........#...#.###..##...#.###',
    '#######....##...##..#.#.#..#.',
    '#.....#.#.#...#.#.#.#...###..',
    '#.###.#..####..###..#####..##',
    '#.###.#.#..#....#..#..######.',
    '#.###.#....####.###..#..###.#',
    '#.....#...#####.#########..#.',
    '#######.#......#.#..#...##.#.',
  ],
];

/** Byte-mode capacity at level M, by version. */
const CAPACITY: Array<{ version: number; bytes: number; size: number }> = [
  { version: 1, bytes: 14, size: 21 },
  { version: 2, bytes: 26, size: 25 },
  { version: 3, bytes: 42, size: 29 },
  { version: 4, bytes: 62, size: 33 },
  { version: 5, bytes: 84, size: 37 },
  { version: 6, bytes: 106, size: 41 },
];

const MAX_BYTES = 106;

// ---------------------------------------------------------------------------
// Reading the matrix
// ---------------------------------------------------------------------------

type Matrix = boolean[][];

/**
 * Drops a quiet zone if the encoder includes one.
 *
 * §2.4 declares a square matrix of modules and says nothing about the
 * four-module quiet zone either way. A quiet zone is by definition entirely
 * light, and a QR symbol's outermost row always contains finder-pattern dark
 * modules, so trimming all-light edges stops exactly at the symbol boundary.
 */
function trimQuietZone(matrix: Matrix): Matrix {
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix.length - 1;

  const rowIsLight = (y: number) => matrix[y].slice(left, right + 1).every((cell) => !cell);
  const colIsLight = (x: number) => matrix.slice(top, bottom + 1).every((row) => !row[x]);

  while (top < bottom && rowIsLight(top)) top += 1;
  while (bottom > top && rowIsLight(bottom)) bottom -= 1;
  while (left < right && colIsLight(left)) left += 1;
  while (right > left && colIsLight(right)) right -= 1;

  return matrix.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}

function render2d(matrix: Matrix): string[] {
  return matrix.map((row) => row.map((cell) => (cell ? '#' : '.')).join(''));
}

function sameGrid(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((row, index) => row === b[index]);
}

/** How many modules differ, for picking the most readable failure diff. */
function gridDistance(a: string[], b: string[]): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let differences = 0;
  for (let y = 0; y < a.length; y += 1) {
    for (let x = 0; x < a[y].length; x += 1) {
      if (a[y][x] !== b[y][x]) differences += 1;
    }
  }
  return differences;
}

function nearestFixture(rendered: string[]): number {
  let best = 0;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  MASK_FIXTURES.forEach((fixture, index) => {
    const distance = gridDistance(fixture, rendered);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** The encoder's answer, normalised and stripped of any quiet zone. */
function matrixFor(data: string): Matrix | null {
  const result = encodeQr(data);
  return result === null ? null : trimQuietZone(result.map((row) => row.map((cell) => Boolean(cell))));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function ascii(bytes: number): string {
  return 'a'.repeat(bytes);
}

// ---------------------------------------------------------------------------
// Criterion 28 - the matrix
// ---------------------------------------------------------------------------

describe('CRITERION 28: the QR encoder produces a decodable matrix', () => {
  it('matches the reference encoder module for module, under some mask', () => {
    const matrix = matrixFor(FIXTURE_URL);
    expect(matrix).not.toBeNull();

    const rendered = render2d(matrix as Matrix);
    const matched = MASK_FIXTURES.findIndex((fixture) => sameGrid(fixture, rendered));

    if (matched === -1) {
      // Diff against the nearest reference so the failure shows two grids side
      // by side rather than "no mask matched".
      expect(rendered).toEqual(MASK_FIXTURES[nearestFixture(rendered)]);
    }
    expect(matched).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic - the same URL gives the same matrix every time', () => {
    const first = render2d(matrixFor(FIXTURE_URL) as Matrix);
    const second = render2d(matrixFor(FIXTURE_URL) as Matrix);

    expect(second).toEqual(first);
  });

  it('returns a square, row-major matrix of booleans (§2.4)', () => {
    const matrix = encodeQr(FIXTURE_URL) as Matrix;

    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.every((row) => Array.isArray(row) && row.length === matrix.length)).toBe(true);
    expect(matrix.every((row) => row.every((cell) => typeof cell === 'boolean'))).toBe(true);
  });

  it('sizes the symbol at 4 x version + 17', () => {
    const matrix = matrixFor(FIXTURE_URL) as Matrix;

    // 37 bytes exceeds version 2's 26 and fits version 3's 42.
    expect(byteLength(FIXTURE_URL)).toBe(37);
    expect(matrix.length).toBe(29);
  });

  it('places a finder pattern in each of the three corners', () => {
    const matrix = matrixFor(FIXTURE_URL) as Matrix;
    const size = matrix.length;
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];

    const corner = (top: number, left: number) =>
      render2d(matrix.slice(top, top + 7).map((row) => row.slice(left, left + 7)));

    expect(corner(0, 0)).toEqual(finder);
    expect(corner(0, size - 7)).toEqual(finder);
    expect(corner(size - 7, 0)).toEqual(finder);
  });

  it('encodes the invite URL this app actually builds (§3.1)', () => {
    const matrix = matrixFor(`${window.location.origin}/join/ABC234`);

    expect(matrix).not.toBeNull();
    expect(CAPACITY.map((c) => c.size)).toContain((matrix as Matrix).length);
  });

  it('chooses the smallest version each payload fits in', () => {
    for (const { bytes, size } of CAPACITY) {
      const matrix = matrixFor(ascii(bytes));
      expect(`${bytes}:${matrix === null ? 'null' : (matrix as Matrix).length}`).toBe(`${bytes}:${size}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 28 - the fallback
// ---------------------------------------------------------------------------

describe('CRITERION 28: above 106 bytes the encoder declines', () => {
  it('encodes exactly 106 bytes, the version 6 capacity at level M', () => {
    const matrix = matrixFor(ascii(MAX_BYTES));

    expect(matrix).not.toBeNull();
    expect((matrix as Matrix).length).toBe(41);
  });

  it('returns null at 107 bytes, because there is no version 7', () => {
    // §2.4: the panel then shows the link as text, which is a real fallback
    // rather than a broken image.
    expect(encodeQr(ascii(MAX_BYTES + 1))).toBeNull();
  });

  it('returns null well above the limit rather than throwing', () => {
    expect(encodeQr(ascii(500))).toBeNull();
  });

  it('counts bytes, not characters', () => {
    // AC 28: 53 two-byte characters are 106 bytes and fit version 6; 54 are 108
    // bytes and do not - while `.length` is 54, far below 106. An encoder
    // measuring `data.length` passes every other assertion in this file and
    // produces a corrupt symbol exactly here.
    const within = '\u00e9'.repeat(53);
    const beyond = '\u00e9'.repeat(54);

    expect(byteLength(within)).toBe(106);
    expect(byteLength(beyond)).toBe(108);
    expect(beyond.length).toBeLessThan(MAX_BYTES);

    expect(matrixFor(within)).not.toBeNull();
    expect(encodeQr(beyond)).toBeNull();
  });

  it('answers an empty string without throwing', () => {
    expect(() => encodeQr('')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Criterion 29 - the toggle and the text fallback
// ---------------------------------------------------------------------------

const SHOW_QR = /^Show QR code$/i;

/** A URL of 118 bytes: past version 6's capacity, so `encodeQr` declines. */
const OVERLONG_URL = `https://beery.example.com/join/ABC234?${'x'.repeat(80)}`;

type LoosePanel = (props: Record<string, unknown>) => ReactElement | null;

function invitePanel(): LoosePanel {
  const module = InvitePanelModule as unknown as Record<string, unknown>;
  const candidate = module.InvitePanel ?? module.default;
  if (typeof candidate !== 'function') {
    throw new Error(
      'src/components/lobby/InvitePanel.tsx exports no component. ' +
        `Exports seen: ${Object.keys(module).join(', ') || '(none)'}.`,
    );
  }
  return candidate as LoosePanel;
}

/**
 * §2.4 says the panel "takes the URL it renders as a **prop**" but does not name
 * that prop, so every plausible spelling is passed with the same value. The
 * panel reads whichever one it declares; the rest are inert.
 */
function renderPanel(url: string) {
  const Panel = invitePanel();
  return render(
    <Panel url={url} inviteUrl={url} inviteLink={url} link={url} href={url} roomCode="ABC234" />,
  );
}

/**
 * The rendered QR, if it is on screen.
 *
 * The matrix may be drawn as an svg, a canvas, an img, a table or a grid; §2.4
 * fixes none of that. Candidates inside an interactive element are excluded, so
 * an icon inside the toggle itself is never mistaken for the code.
 */
function qrNode(): Element | null {
  const candidates = Array.from(
    document.querySelectorAll('svg, canvas, img, table, [role="img"], [data-testid*="qr" i]'),
  );
  return (
    candidates.find(
      (node) => !node.closest('button, a, [role="button"], [hidden], [aria-hidden="true"]'),
    ) ?? null
  );
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

describe('CRITERION 29: the QR toggle shows and hides the code', () => {
  it('starts with the code hidden and offers the toggle', () => {
    renderPanel(FIXTURE_URL);

    expect(screen.getByRole('button', { name: SHOW_QR })).toBeInTheDocument();
    expect(qrNode()).toBeNull();
  });

  it('shows the code when the toggle is pressed', async () => {
    const user = userEvent.setup();
    renderPanel(FIXTURE_URL);

    await user.click(screen.getByRole('button', { name: SHOW_QR }));

    expect(qrNode()).not.toBeNull();
  });

  it('hides it again on a second press', async () => {
    const user = userEvent.setup();
    renderPanel(FIXTURE_URL);

    const toggle = screen.getByRole('button', { name: SHOW_QR });
    await user.click(toggle);
    expect(qrNode()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: SHOW_QR }));

    expect(qrNode()).toBeNull();
  });
});

describe('CRITERION 29: past capacity the panel shows the link as text', () => {
  it('encodeQr declines this URL, which is what the fallback is for', () => {
    expect(byteLength(OVERLONG_URL)).toBeGreaterThan(MAX_BYTES);
    expect(encodeQr(OVERLONG_URL)).toBeNull();
  });

  it('draws no QR for it', async () => {
    const user = userEvent.setup();
    renderPanel(OVERLONG_URL);

    await user.click(screen.getByRole('button', { name: SHOW_QR }));

    // A real fallback rather than a broken image (§2.4).
    expect(qrNode()).toBeNull();
  });

  it('renders the invite link as text instead', async () => {
    const user = userEvent.setup();
    renderPanel(OVERLONG_URL);

    await user.click(screen.getByRole('button', { name: SHOW_QR }));

    expect(bodyText()).toContain(OVERLONG_URL);
  });

  it('renders the URL it was given, not one built from window.location', () => {
    // §2.4: the panel takes the URL as a prop precisely so this branch is
    // reachable - an origin that cannot be injected makes it permanently
    // unexercisable.
    renderPanel(OVERLONG_URL);

    expect(bodyText()).not.toContain(`${window.location.origin}/join/ABC234`);
  });
});
