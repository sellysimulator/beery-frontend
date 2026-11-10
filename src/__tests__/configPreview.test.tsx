/**
 * `useConfigPreview` under the backend's rate limit: a 429 on the debounced
 * `POST /rooms/preview` fails quietly — the last good preview stays on screen
 * and no error is shown.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ConfigPreview } from '../types/game';

const previewConfig = vi.hoisted(() => vi.fn());
vi.mock('../api/rooms', () => ({ previewConfig }));
vi.mock('../../firebase', () => ({ auth: { currentUser: null } }));

import { resetPreviewCacheForTests, useConfigPreview } from '../components/config/useConfigPreview';

const GOOD = {
  demand_series: [4, 4, 8, 8],
  demand_is_example: false,
  lead_times: { RETAILER: 2, WHOLESALER: 2, DISTRIBUTOR: 2, FACTORY: 2 },
} as unknown as ConfigPreview;

const rateLimited = () =>
  Object.assign(new Error('Request failed with status code 429'), {
    isAxiosError: true,
    response: {
      status: 429,
      headers: { 'retry-after': '60' },
      data: { detail: 'Too many requests. Please slow down and try again.' },
    },
  });

beforeEach(() => {
  resetPreviewCacheForTests();
  previewConfig.mockReset();
});

describe('useConfigPreview — a rate-limited preview fails quietly', () => {
  it('keeps the last good preview and shows no error on a 429', async () => {
    previewConfig.mockResolvedValueOnce(GOOD).mockRejectedValueOnce(rateLimited());

    const { result, rerender } = renderHook(({ draft }) => useConfigPreview(draft), {
      initialProps: { draft: { weeks: 20 } as object },
    });
    await waitFor(() => expect(result.current.preview).toEqual(GOOD));

    rerender({ draft: { weeks: 21 } });
    await waitFor(() => expect(previewConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.preview).toEqual(GOOD);
  });

  it('with no earlier answer, a 429 leaves the placeholder, not an error', async () => {
    previewConfig.mockRejectedValueOnce(rateLimited());

    const { result } = renderHook(() => useConfigPreview({ weeks: 30 }));
    await waitFor(() => expect(previewConfig).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.error).toBeNull();
    expect(result.current.preview).toBeNull();
  });

  it('a refused draft (422) still shows the server text', async () => {
    previewConfig.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { detail: 'weeks must be at most 52' } },
    });

    const { result } = renderHook(() => useConfigPreview({ weeks: 99 }));
    await waitFor(() => expect(result.current.error).toBe('weeks must be at most 52'));
  });
});
