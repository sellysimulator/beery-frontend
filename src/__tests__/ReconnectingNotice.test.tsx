/**
 * The "Reconnecting…" banner on the player and host screens: shown while
 * `store.reconnecting` is set (a drop after a working connection), gone once
 * the socket is back, and never blocking the screen beneath it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useGameStore } from '../store/gameStore';
import type { ReactElement } from 'react';
import ReconnectingNotice from '../components/shared/ReconnectingNotice';
import { route as gameRoutes } from '../pages/GameRoom';
import { route as hostRoute } from '../pages/HostRoom';

beforeEach(() => {
  useGameStore.getState().reset();
});

describe('ReconnectingNotice', () => {
  it('renders nothing while connected', () => {
    const { container } = render(<ReconnectingNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is reconnecting while the socket is down, without blocking clicks', () => {
    render(<ReconnectingNotice />);
    act(() => useGameStore.getState().setReconnecting(true));

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Reconnecting…');
    expect(notice.className).toContain('pointer-events-none');

    act(() => useGameStore.getState().setReconnecting(false));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('where it is mounted', () => {
  function mounts(element: unknown): boolean {
    const children = (element as ReactElement<{ children?: unknown }>).props.children;
    return (Array.isArray(children) ? children : [children]).some(
      (child) => (child as ReactElement | null)?.type === ReconnectingNotice,
    );
  }

  it('on the player screen (lobby and game) and on the host screen (lobby and console)', () => {
    const game = gameRoutes.find((r) => r.path === '/game/:roomCode');
    expect(mounts(game?.element)).toBe(true);
    expect(mounts(hostRoute.element)).toBe(true);
  });
});
