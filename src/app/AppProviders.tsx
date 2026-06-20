import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

export function createCanonKeeperQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        retry: 1,
        staleTime: 30 * 1000,
      },
    },
  });
}

export function AppProviders({ children, queryClient: providedQueryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [queryClient] = useState(
    () => providedQueryClient ?? createCanonKeeperQueryClient(),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
