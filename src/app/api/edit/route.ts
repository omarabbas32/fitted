import { runEdit } from "@/lib/tailoring";
import { streamConversation } from "@/lib/stream-protocol";

/** One turn of an edit session — no job, no scoring — streamed as it is
 *  written. See /api/tailor for why this isn't a Server Action. */
export async function POST(request: Request) {
  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { conversationId, message } = body;
  if (!conversationId || !message?.trim()) {
    return Response.json(
      { error: "conversationId and message are required." },
      { status: 400 }
    );
  }

  return streamConversation((onDelta) =>
    runEdit(conversationId, message, onDelta)
  );
}
