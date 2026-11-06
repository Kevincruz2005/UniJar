// A query cancellation signal must not remove the request's own time limit.
export async function request<T>(url: string, body?: unknown, signal?: AbortSignal, timeout = 25000): Promise<T> {
  const deadline = AbortSignal.timeout(timeout);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline, method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Unable to load chain data.');
  return data as T;
}
