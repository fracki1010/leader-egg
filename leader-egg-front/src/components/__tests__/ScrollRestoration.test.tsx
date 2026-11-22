import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ScrollRestoration } from '../ScrollRestoration.tsx';

let scrollY = 0;
const scrollToMock = vi.fn();

function Harness() {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate('/detail')}>go-detail</button>
      <button onClick={() => navigate(-1)}>go-back</button>
    </div>
  );
}

function renderApp(initialIndex = 0) {
  return render(
    <MemoryRouter initialEntries={['/list', '/detail']} initialIndex={initialIndex}>
      <ScrollRestoration />
      <Harness />
    </MemoryRouter>,
  );
}

/** Emulate the user scrolling the window to `y`. */
function scrollToY(y: number) {
  scrollY = y;
  fireEvent.scroll(window);
}

describe('ScrollRestoration', () => {
  beforeEach(() => {
    scrollY = 0;
    scrollToMock.mockReset();

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToMock,
    });
    // Tall enough that a target offset is always reachable on the first try.
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000,
    });
  });

  it('scrolls to the top on a PUSH navigation', async () => {
    renderApp();
    scrollToMock.mockReset();

    act(() => scrollToY(400));
    fireEvent.click(screen.getByText('go-detail'));

    await waitFor(() => expect(scrollToMock).toHaveBeenCalledWith(0, 0));
    expect(scrollToMock).not.toHaveBeenCalledWith(0, 400);
  });

  it('restores the saved scroll position on a POP navigation', async () => {
    renderApp();
    scrollToMock.mockReset();

    // Remember 400px for the list entry.
    act(() => scrollToY(400));

    fireEvent.click(screen.getByText('go-detail'));
    await waitFor(() => expect(scrollToMock).toHaveBeenCalledWith(0, 0));
    scrollToMock.mockReset();

    // Scroll the detail page, then go back (POP) to the list.
    act(() => scrollToY(50));
    fireEvent.click(screen.getByText('go-back'));

    await waitFor(() => expect(scrollToMock).toHaveBeenCalledWith(0, 400));
  });
});
