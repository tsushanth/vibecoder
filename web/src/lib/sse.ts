import { API_URL } from './constants';
import type { SSEEvent } from '@/types/sse';

export async function* streamSSE(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const url = `${API_URL}${path}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Server error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6)) as SSEEvent;
            yield parsed;
          } catch {
            // skip malformed events
          }
        }
        // Ignore heartbeat lines (":heartbeat")
      }
    }
  } finally {
    reader.releaseLock();
  }
}
