import { runChat } from "@/lib/tailoring";
import { streamConversation } from "@/lib/stream-protocol";
import type { ChatMode } from "@/lib/cv-schema";

/** Apply a chat instruction to the working draft, streaming the rewritten CV
 *  as it is produced. See /api/tailor for why this isn't a Server Action. */
export async function POST(request: Request) {
  let body: { conversationId?: string; message?: string; mode?: string };
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

  const mode: ChatMode = body.mode === "edit" ? "edit" : "tailor";

  return streamConversation((onDelta) =>
    runChat(conversationId, message, mode, onDelta)
  );
}
