import { runGenerate } from "@/lib/tailoring";
import { streamConversation } from "@/lib/stream-protocol";

/** Generate a tailored CV, streaming the model's output as it is written.
 *
 *  The Server Action equivalent (actions/tailor.ts) resolves only once the
 *  whole document exists, which is a minute of blank spinner; this exists so
 *  the preview can fill in live. */
export async function POST(request: Request) {
  let body: { conversationId?: string; instructions?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { conversationId, instructions } = body;
  if (!conversationId) {
    return Response.json({ error: "conversationId is required." }, { status: 400 });
  }

  return streamConversation((onDelta) =>
    runGenerate(conversationId, instructions, onDelta)
  );
}
