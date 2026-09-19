/**
 * `errorMessage(err, fallback)` from `src/api/http.ts` (16 §3).
 *
 * Covers acceptance criterion 9 and failure mode 4.
 *
 * FastAPI returns `detail` as a STRING for `HTTPException` and as an ARRAY OF
 * OBJECTS for a 422 validation error (00-conventions §3). Putting that array
 * into React state and rendering it throws
 *   "Objects are not valid as a React child (found: object with keys
 *    {type, loc, msg, input, ctx, url})"
 * turning a readable validation message into a white screen  [HARD-WON].
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { errorMessage } from '../api/http';

/** The shape axios hands a caller for a non-2xx response. */
const axiosErr = (detail: unknown, status = 400) => ({
  isAxiosError: true,
  response: { status, data: { detail } },
  message: `Request failed with status code ${status}`,
});

/** A real FastAPI 422 body, copied field for field. */
const FASTAPI_422 = {
  detail: [
    {
      type: 'int_parsing',
      loc: ['body', 'config', 'weeks'],
      msg: 'Input should be a valid integer, unable to parse string as an integer',
      input: 'twelve',
      ctx: {},
      url: 'https://errors.pydantic.dev/2.5/v/int_parsing',
    },
    {
      type: 'greater_than_equal',
      loc: ['body', 'config', 'delay_weeks'],
      msg: 'Input should be greater than or equal to 1',
      input: 0,
      ctx: { ge: 1 },
      url: 'https://errors.pydantic.dev/2.5/v/greater_than_equal',
    },
  ],
};

describe('errorMessage — string detail (HTTPException)', () => {
  it('returns the detail string unchanged', () => {
    expect(errorMessage(axiosErr('Room not found'), 'fallback')).toBe('Room not found');
  });

  it('returns a generic-but-real server message as given', () => {
    expect(errorMessage(axiosErr('Not authorised', 403), 'fallback')).toBe('Not authorised');
  });
});

describe('errorMessage — array detail (422 validation)', () => {
  it('CRITERION 9: joins the `msg` values of a real FastAPI 422 body', () => {
    const out = errorMessage(axiosErr(FASTAPI_422.detail, 422), 'fallback');

    expect(typeof out).toBe('string');
    expect(out).toContain('unable to parse string as an integer');
    expect(out).toContain('greater than or equal to 1');
  });

  it('joins a single-entry array to just that message', () => {
    const out = errorMessage(axiosErr([{ msg: 'String should have at least 1 character' }], 422), 'fallback');
    expect(out).toBe('String should have at least 1 character');
  });

  it('never leaks an object or an array back to the caller', () => {
    const out = errorMessage(axiosErr(FASTAPI_422.detail, 422), 'fallback');
    expect(Array.isArray(out)).toBe(false);
    expect(out).not.toContain('[object Object]');
    expect(out).not.toMatch(/^\s*\[/);
  });
});

describe('errorMessage — fallback for anything else (criterion 9)', () => {
  const cases: Array<[string, unknown]> = [
    ['detail absent', axiosErr(undefined)],
    ['detail null', axiosErr(null)],
    ['detail empty string', axiosErr('')],
    ['detail empty array', axiosErr([])],
    ['detail array of unusable objects', axiosErr([{ no_msg: 1 }])],
    ['detail a bare object', axiosErr({ msg: 'buried' , loc: ['x'] })],
    ['detail a number', axiosErr(42)],
    ['no response at all (bare network error)', new Error('Network Error')],
    ['an axios error with no response', { isAxiosError: true, message: 'Network Error' }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
  ];

  for (const [name, input] of cases) {
    it(`returns the fallback for ${name}`, () => {
      expect(errorMessage(input, 'Something went wrong.')).toBe('Something went wrong.');
    });
  }
});

describe('errorMessage — always a string', () => {
  it('returns typeof "string" for every input shape', () => {
    const inputs: unknown[] = [
      axiosErr('plain'),
      axiosErr(FASTAPI_422.detail, 422),
      axiosErr({ msg: 'obj' }),
      axiosErr(42),
      new Error('Network Error'),
      null,
      undefined,
      0,
      [],
      {},
    ];
    for (const input of inputs) {
      expect(typeof errorMessage(input, 'fallback')).toBe('string');
    }
  });
});

describe('FAILURE MODE 4: the 422 array must not reach React as a child', () => {
  it('renders the flattened 422 message without throwing', () => {
    const message = errorMessage(axiosErr(FASTAPI_422.detail, 422), 'fallback');

    // This is the exact operation that crashed: the value goes straight into
    // the tree as a React child.
    expect(() =>
      render(createElement('div', { 'data-testid': 'api-error' }, message as unknown as string)),
    ).not.toThrow();

    const node = screen.getByTestId('api-error');
    expect(node).toBeInTheDocument();
    expect(node.textContent).toContain('unable to parse string as an integer');
  });

  it('demonstrates that the raw detail WOULD have crashed', () => {
    // Guards the test above from passing vacuously: if `errorMessage` ever
    // returned the array untouched, the render below is what the user sees.
    expect(() =>
      render(
        createElement(
          'div',
          null,
          FASTAPI_422.detail as unknown as string,
        ),
      ),
    ).toThrow();
  });
});
