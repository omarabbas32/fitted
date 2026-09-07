// The session operations themselves, independent of how they were invoked.
//
// Each one is reachable two ways: as a Server Action (src/app/actions/tailor.ts)
// that resolves once, and through a streaming Route Handler (src/app/api/…)
// that forwards the model's output as it arrives. The work is identical, so it
// lives here rather than in either caller, and takes an optional onDelta the
// streaming path uses to relay chunks.
//
// A session may or may not have a job attached. With one it is a tailoring
// session, scored against that job. Without one it is an edit session over the
// CV itself, where there is nothing to score and the scores stay null.

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { Prisma } from "@/generated/prisma/client";
import { tailorCv, refineCv, editCv, type OnDelta } from "./ai";
import type {
  ChatMode,
  DraftState,
  StructuredCv,
  TailorResult,
} from "./cv-schema";
import type { ConversationDto, MessageDto } from "./dto";

export type ConvWithRelations = {
  id: string;
  cvId: string;
  jobId: string | null;
  draft: unknown;
  job: { title: string; company: string | null; description: string } | null;
  messages: {
    id: string;
    role: string;
    content: string;
    mode: string;
    createdAt: Date;
  }[];
};

export const include = {
  job: true,
  messages: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ConversationInclude;

/** Everything the candidate has asserted about themselves in edit mode.
 *  Passed to every later call so a tailor-mode turn doesn't delete additions
 *  it can't find in the base CV. */
export function userFacts(messages: ConvWithRelations["messages"]): string[] {
  return messages
    .filter((m) => m.role === "user" && m.mode === "edit")
    .map((m) => m.content);
}

/** The draft a session starts from: the CV exactly as it stands. An edit
 *  session's first turn has to have something to edit. */
function seedDraft(cv: StructuredCv): DraftState {
  return {
    cv,
    changeSummary: "",
    matchScore: null,
    baseMatchScore: null,
    matchNotes: null,
  };
}

export function toConversationDto(c: ConvWithRelations): ConversationDto {
  const draft = (c.draft as DraftState | null) ?? null;
  return {
    id: c.id,
    cvId: c.cvId,
    jobId: c.jobId,
    job: c.job,
    draft: draft?.cv ?? null,
    lastResult: draft
      ? {
          changeSummary: draft.changeSummary,
          matchScore: draft.matchScore ?? null,
          baseMatchScore: draft.baseMatchScore ?? null,
          matchNotes: draft.matchNotes ?? null,
        }
      : null,
    messages: c.messages.map(
      (m): MessageDto => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        mode: m.mode as ChatMode,
        createdAt: m.createdAt.toISOString(),
      })
    ),
  };
}

async function freshDto(conversationId: string): Promise<ConversationDto> {
  const fresh = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include,
  });
  revalidatePath("/");
  return toConversationDto(fresh);
}

/** Resume this CV's edit session, or start one.
 *
 *  Resuming rather than always creating is the point of persisting these: the
 *  chat is a record of what you have already told the model about yourself, and
 *  starting fresh every time would throw that away. */
export async function getOrCreateEditSession(
  cvId: string
): Promise<ConversationDto> {
  const existing = await prisma.conversation.findFirst({
    where: { cvId, jobId: null },
    orderBy: { updatedAt: "desc" },
    include,
  });
  if (existing) return toConversationDto(existing);

  const cv = await prisma.cv.findUniqueOrThrow({ where: { id: cvId } });
  const conversation = await prisma.conversation.create({
    data: {
      cv: { connect: { id: cvId } },
      draft: seedDraft(
        cv.structured as unknown as StructuredCv
      ) as unknown as object,
    },
    include,
  });

  revalidatePath("/");
  return toConversationDto(conversation);
}

/** Write an edit session's draft back over the CV it belongs to. */
export async function saveDraftToCv(conversationId: string): Promise<void> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  const draft = conv.draft as DraftState | null;
  if (!draft?.cv) throw new Error("There is nothing to save yet.");

  await prisma.cv.update({
    where: { id: conv.cvId },
    data: { structured: draft.cv as unknown as object },
  });
  revalidatePath("/");
}

/** Regenerate the full CV tailored to the job. */
export async function runGenerate(
  conversationId: string,
  instructions?: string,
  onDelta?: OnDelta
): Promise<ConversationDto> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { ...include, cv: true },
  });
  if (!conv.job) {
    throw new Error("This session has no job to tailor against.");
  }

  const baseCv = conv.cv.structured as unknown as StructuredCv;
  const result = await tailorCv(
    baseCv,
    conv.job.description,
    instructions,
    userFacts(conv.messages),
    onDelta
  );

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draft: result as unknown as object,
      messages: {
        create: {
          role: "assistant",
          mode: "tailor", // a regeneration belongs to the tailor thread
          content: `Regenerated your CV for **${conv.job.title}** (match ~${result.matchScore}%).\n\n${result.changeSummary}`,
        },
      },
    },
  });

  return freshDto(conversationId);
}

/** Refine the current draft with a chat instruction, against the job. */
export async function runChat(
  conversationId: string,
  message: string,
  mode: ChatMode = "tailor",
  onDelta?: OnDelta
): Promise<ConversationDto> {
  const text = message.trim();
  if (!text) throw new Error("Message is empty.");

  // `cv` is loaded so refineCv can check the draft against the original — the
  // draft alone is model output and can't anchor the evidence rule.
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { ...include, cv: true },
  });
  if (!conv.job) {
    throw new Error("This session has no job attached.");
  }

  const draft = conv.draft as TailorResult | null;
  if (!draft) {
    throw new Error("Generate a tailored CV first, then refine it.");
  }

  await prisma.message.create({
    data: { conversationId, role: "user", content: text, mode },
  });

  // Tailor and Edit are two separate threads in the UI, so each gets only its
  // own history — edit-mode fact entry shouldn't read as context for a
  // tailoring tweak, or vice versa.
  const history = conv.messages
    .filter((m) => m.mode === mode)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  // userFacts spans BOTH threads on purpose: it is the one channel between
  // them, and it's what stops a tailor turn deleting a project added in edit.
  // The current message is passed as the instruction; the ledger holds the
  // earlier edit-mode ones so nothing added by hand gets dropped later.
  const result = await refineCv(
    conv.cv.structured as unknown as StructuredCv,
    draft.cv,
    conv.job.description,
    text,
    history,
    { mode, userFacts: userFacts(conv.messages), onDelta }
  );
  // The original CV's match score is fixed; keep the value from the first tailoring.
  result.baseMatchScore = draft.baseMatchScore ?? result.baseMatchScore;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draft: result as unknown as object,
      messages: {
        create: {
          role: "assistant",
          mode,
          content: `${
            mode === "edit" ? "Edited ✏️" : "Updated ✅"
          } (match ~${result.matchScore}%).\n\n${result.changeSummary}`,
        },
      },
    },
  });

  return freshDto(conversationId);
}

/** One turn of an edit session: no job, no scoring, just the CV. */
export async function runEdit(
  conversationId: string,
  message: string,
  onDelta?: OnDelta
): Promise<ConversationDto> {
  const text = message.trim();
  if (!text) throw new Error("Message is empty.");

  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { ...include, cv: true },
  });

  // A session created before its CV existed in this shape, or one whose draft
  // was never written, still edits something sensible.
  const draft =
    (conv.draft as DraftState | null) ??
    seedDraft(conv.cv.structured as unknown as StructuredCv);

  await prisma.message.create({
    data: { conversationId, role: "user", content: text, mode: "edit" },
  });

  const history = conv.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const result = await editCv(draft.cv, text, history, onDelta);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draft: {
        cv: result.cv,
        changeSummary: result.changeSummary,
        matchScore: null,
        baseMatchScore: null,
        matchNotes: null,
      } as unknown as object,
      messages: {
        create: {
          role: "assistant",
          mode: "edit",
          content: `Edited ✏️\n\n${result.changeSummary}`,
        },
      },
    },
  });

  return freshDto(conversationId);
}
