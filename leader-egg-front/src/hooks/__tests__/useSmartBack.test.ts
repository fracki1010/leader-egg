import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSmartBack } from '../useSmartBack.ts';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

describe('useSmartBack', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('navigates back when history has a previous entry', () => {
    window.history.replaceState({ idx: 2 }, '');

    const { result } = renderHook(() => useSmartBack('/orders'));
    result.current();

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('navigates to the fallback with replace when history has no previous entry', () => {
    window.history.replaceState({ idx: 0 }, '');

    const { result } = renderHook(() => useSmartBack('/orders'));
    result.current();

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/orders', { replace: true });
  });

  it('treats a missing history state as no previous entry', () => {
    window.history.replaceState(null, '');

    const { result } = renderHook(() => useSmartBack('/dashboard'));
    result.current();

    expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true });
  });
});
