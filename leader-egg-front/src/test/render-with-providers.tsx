import { useState, type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../theme/ThemeProvider.tsx';

/**
 * Create a QueryClient tuned for tests: no retries, no cache retention between
 * tests. Every call returns a brand-new instance so state never leaks.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface ProvidersProps {
  children: ReactNode;
  /** Optional client override — mainly for tests that assert on the client. */
  queryClient?: QueryClient;
}

/**
 * App-equivalent providers for component tests: a fresh QueryClient plus the
 * MUI CssVarsProvider theme. The client is created once per mount so re-renders
 * do not reset query state.
 */
export function AllProviders({ children, queryClient }: ProvidersProps) {
  const [client] = useState(() => queryClient ?? createTestQueryClient());

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Render a component wrapped in QueryClientProvider (fresh client per test) and
 * the ThemeProvider. Use this for the page tests migrating to TanStack Query.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient } = {},
): RenderResult {
  const { queryClient, ...renderOptions } = options;

  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders queryClient={queryClient}>{children}</AllProviders>
    ),
    ...renderOptions,
  });
}
