import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createCanonKeeperApiClient } from './shared/api';
import { AppProviders, createCanonKeeperQueryClient } from './app/AppProviders';
import { CanonKeeperRouterProvider, createCanonKeeperRouter } from './routing/router';
import './styles/tokens.css';
import './styles/base.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

const api = createCanonKeeperApiClient();
const queryClient = createCanonKeeperQueryClient();
const router = createCanonKeeperRouter({ api, queryClient });

createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <CanonKeeperRouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
