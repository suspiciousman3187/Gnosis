
interface CombatParseRequest {
  conn: number;
  line: string;
}

interface MeasureMemoryRequest { id: number; type: 'measure-memory' }

self.addEventListener('message', async (ev: MessageEvent<CombatParseRequest | MeasureMemoryRequest>) => {
  const data = ev.data as CombatParseRequest | MeasureMemoryRequest;
  if ('type' in data && data.type === 'measure-memory') {
    const perf = performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      memory?: { usedJSHeapSize?: number };
    };
    let bytes: number | undefined;
    const jsHeap = perf.memory?.usedJSHeapSize;
    let error: string | undefined;
    if (typeof perf.measureUserAgentSpecificMemory === 'function') {
      try { bytes = (await perf.measureUserAgentSpecificMemory()).bytes; }
      catch (e) { error = String(e); }
    } else {
      error = 'measureUserAgentSpecificMemory unavailable';
    }
    (self as unknown as Worker).postMessage({ id: data.id, type: 'memory', ok: bytes != null, bytes, jsHeap, error });
    return;
  }
  const { conn, line } = data as CombatParseRequest;
  try {
    const msg = JSON.parse(line);
    (self as unknown as Worker).postMessage({ conn, ok: true, msg });
  } catch {
    (self as unknown as Worker).postMessage({ conn, ok: false });
  }
});
