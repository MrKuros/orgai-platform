/**
 * Minimal SSE parser for fetch() streaming responses.
 * Yields `data:` payloads as strings (already concatenated per event).
 */
export async function* sseDataIterator(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on double newlines (end of SSE event)
    while (true) {
      const idx = buffer.indexOf('\n\n');
      if (idx === -1) break;
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      // Collect data: lines
      const dataLines = event
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.replace(/^data:\s?/, ''));

      if (dataLines.length > 0) {
        yield dataLines.join('\n');
      }
    }
  }
}

