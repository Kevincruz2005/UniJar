import { useQuery } from '@tanstack/react-query';
import { validateConfig, type Config, type Envelope, type Inventory, type Lot, type Credits, type Quote } from './domain';
export const deployment = __DEPLOYMENT__;
export const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
if (import.meta.env.PROD && apiBase !== '/api' && !apiBase.startsWith('https://')) throw new Error('Public API must use HTTPS.');
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { signal: signal ?? AbortSignal.timeout(25000), method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Unable to load chain data.');
  return data as T;
}
export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: async ({ signal }) => { const r = await api<Envelope<Config>>('/v1/config', undefined, signal); validateConfig(r.data, deployment); return r; }, staleTime: 30000, refetchInterval: 45000, retry: 1 });
export const useInventory = () => useQuery({ queryKey: ['inventory'], queryFn: ({ signal }) => api<Envelope<Inventory[]>>('/v1/inventory', undefined, signal), staleTime: 30000, refetchInterval: 45000, retry: 1 });
export const useLot = (id: string) => useQuery({ queryKey: ['lot', id], queryFn: ({ signal }) => api<Envelope<{ lot: Lot; nextActions: string[] }>>(`/v1/lots/${id}`, undefined, signal), enabled: /^[1-9]\d{0,77}$/.test(id), staleTime: 12000, refetchInterval: 20000, retry: 1 });
export const useQuote = (id: string, enabled: boolean) => useQuery({ queryKey: ['quote', id], queryFn: ({ signal }) => api<Envelope<Quote>>(`/v1/lots/${id}/quote`, undefined, signal), enabled, staleTime: 10000, refetchInterval: enabled ? 20000 : false, retry: 1 });
export const useCredits = (address?: string) => useQuery({ queryKey: ['credits', address], queryFn: ({ signal }) => api<Envelope<Credits>>(`/v1/credits/${address}`, undefined, signal), enabled: !!address, staleTime: 10000, refetchInterval: 30000, retry: 1 });
