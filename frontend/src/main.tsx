import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { TransactionProvider, walletConfig } from './wallet';
import { App } from './App';
import './base.css';
const query = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
createRoot(document.getElementById('root')!).render(<StrictMode><WagmiProvider config={walletConfig}><QueryClientProvider client={query}><TransactionProvider><App /></TransactionProvider></QueryClientProvider></WagmiProvider></StrictMode>);
