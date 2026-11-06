// Bounds provider work, including simultaneous reads from different HTTP routes.
// Pacing belongs before transport: JSON-RPC batches still consume provider quota.
export function rpcQueue(requestsPerSecond = 8, maxQueued = 128) {
  if (!Number.isInteger(requestsPerSecond) || requestsPerSecond < 1 || requestsPerSecond > 20) throw new Error('RPC request rate must be an integer from 1 to 20');
  const burst = Math.min(4, requestsPerSecond);
  const interval = Math.ceil(1000 * burst / requestsPerSecond);
  const queue: (() => void)[] = [];
  let nextStart = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function pump() {
    if (timer || !queue.length) return;
    const delay = Math.max(0, nextStart - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      nextStart = Date.now() + interval;
      for (const start of queue.splice(0, burst)) start();
      pump();
    }, delay);
  }
  return function schedule<T>(work: () => Promise<T>, priority = false): Promise<T> {
    if (queue.length >= maxQueued) return Promise.reject(Object.assign(new Error('RPC queue is full'), { name: 'RpcQueueFullError' }));
    return new Promise<T>((resolve, reject) => {
      const start = () => { void Promise.resolve().then(work).then(resolve, reject); };
      if (priority) queue.unshift(start); else queue.push(start);
      pump();
    });
  };
}
