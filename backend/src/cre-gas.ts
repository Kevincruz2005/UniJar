// SPDX-License-Identifier: AGPL-3.0-only
import { GAS_SOURCE_URL, GAS_IDENTITY_URL, gasFailure, validateGasResponse, type GasResult } from './cre-domain.js';
export function advisoryGas(fetcher: typeof fetch = fetch) {
  let last: { key: string; time: number; result: Promise<GasResult> } | undefined;
  return (maxAge: number, maxPrice: bigint): Promise<GasResult> => {
    const key = `${maxAge}:${maxPrice}`;
    if (last?.key === key && Date.now() - last.time < 15000) return last.result;
    const result = (async () => {
      const observedAt = BigInt(Math.floor(Date.now() / 1000));
      try {
        const get = async (url: string) => {
          const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 UniJar-advisory/0.1' } });
          if (response.status !== 200 || !response.body) throw new Error('HTTP_UNAVAILABLE');
          const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          try {
            for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 100000) throw new Error('OVERSIZED_RESPONSE'); chunks.push(value); }
          } finally { await reader.cancel().catch(() => undefined); }
          return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        };
        // Both promises are observed, including partial failure.
        const values = await Promise.allSettled([get(GAS_SOURCE_URL), get(GAS_IDENTITY_URL)]);
        if (values[0].status !== 'fulfilled' || values[1].status !== 'fulfilled') return gasFailure('HTTP_UNAVAILABLE_OR_MALFORMED', observedAt);
        return validateGasResponse(values[0].value, values[1].value, observedAt, BigInt(maxAge), maxPrice);
      } catch { return gasFailure('HTTP_UNAVAILABLE_OR_MALFORMED', observedAt); }
    })();
    last = { key, time: Date.now(), result }; return result;
  };
}
