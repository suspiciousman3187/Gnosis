import { parseEncounterText, type ParseRequest, type ParseOk, type ParseErr } from './parseEncounterCore';

interface MeasureMemoryRequest { id: number; type: 'measure-memory' }
interface MeasureMemoryReply { id: number; type: 'memory'; ok: boolean; bytes?: number; jsHeap?: number; error?: string }

self.addEventListener('message', async (ev: MessageEvent<ParseRequest | MeasureMemoryRequest>) => {
  const data = ev.data as ParseRequest | MeasureMemoryRequest;
  if ('type' in data && data.type === 'measure-memory') {
    const perf = performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      memory?: { usedJSHeapSize?: number };
    };
    let bytes: number | undefined;
    let jsHeap = perf.memory?.usedJSHeapSize;
    let error: string | undefined;
    if (typeof perf.measureUserAgentSpecificMemory === 'function') {
      try { bytes = (await perf.measureUserAgentSpecificMemory()).bytes; }
      catch (e) { error = String(e); }
    } else {
      error = 'measureUserAgentSpecificMemory unavailable';
    }
    const reply: MeasureMemoryReply = { id: data.id, type: 'memory', ok: bytes != null, bytes, jsHeap, error };
    (self as unknown as Worker).postMessage(reply);
    return;
  }
  const { id, path, buf, wantMetrics, ts } = data as ParseRequest;
  const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
  const result = parseEncounterText(path, text, wantMetrics, ts);
  if (result) {
    const summaryJson = JSON.stringify(result.summary);
    const lootJson = JSON.stringify(result.loot);
    const reply: ParseOk = { id, ok: true, summary: result.summary, loot: result.loot, summaryJson, lootJson };
    (self as unknown as Worker).postMessage(reply);
  } else {
    const reply: ParseErr = { id, ok: false };
    (self as unknown as Worker).postMessage(reply);
  }
});

export type { ParseRequest, ParseReply } from './parseEncounterCore';
export type { MeasureMemoryRequest, MeasureMemoryReply };
