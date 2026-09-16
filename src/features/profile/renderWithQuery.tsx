import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

/**
 * Test-only wrapper: every profile screen reads through TanStack Query, so it
 * needs a provider.
 *
 * `retry: false` lets an intentionally failing query reach the error branch on
 * the first attempt instead of timing the test out, and `gcTime: 0` drops the
 * cache as soon as the screen unmounts — otherwise its garbage-collection
 * timer keeps the Jest worker alive after the suite is done.
 */
export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
