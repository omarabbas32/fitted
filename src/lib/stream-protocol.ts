// The wire format between the streaming Route Handlers and the dashboard.
//
// One JSON object per line (NDJSON): a run of `delta` events carrying the
// model's raw output as it arrives, then exactly one terminal `done` or
// `error`. Line-delimited rather than SSE because both ends are ours and this
// needs no framing beyond "split on newline" — and JSON.stringify already
// escapes the newlines inside a delta, so a line is never ambiguous.

import type { ConversationDto } from "./dto";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; conversation: ConversationDto }
  | { type: "error"; message: string };

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  // no-transform keeps proxies from buffering the response into one chunk,
  // which would defeat the point of streaming it.
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff",
};

/** Run a tailoring operation, streaming its output, and end with the updated
 *  conversation. A failure is reported as a terminal `error` event rather than
 *  an HTTP status: by the time the model fails the response has usually
 *  started, so the status line is long gone. */
export function streamConversation(
  run: (onDelta: (text: string) => void) => Promise<ConversationDto>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away mid-generation. Stop writing; the work itself
          // still finishes and is persisted, so nothing is lost.
          open = false;
        }
      };

      try {
        const conversation = await run((text) => send({ type: "delta", text }));
        send({ type: "done", conversation });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Generation failed.",
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

/** Client side of the same protocol: read a response body line by line and
 *  hand each event over as it arrives. */
export async function readStream(
  response: Response,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  if (!response.body) throw new Error("The server returned no response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as StreamEvent);
        } catch {
          // A truncated final line can only happen if the connection died
          // mid-write; there is nothing useful to do with half an event.
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
}
