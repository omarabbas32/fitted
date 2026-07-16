"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { tailorCv, refineCv } from "@/lib/ai";
import type { StructuredCv, TailorResult } from "@/lib/cv-schema";
import type { ConversationDto, MessageDto } from "@/lib/dto";

type ConvWithRelations = {
  id: string;
  cvId: string;
  jobId: string;
  draft: unknown;
  job: { title: string; company: string | null; description: string };
  messages: { id: string; role: string; content: string; createdAt: Date }[];
};

function toConversationDto(c: ConvWithRelations): ConversationDto {
  const draft = (c.draft as TailorResult | null) ?? null;
  return {
    id: c.id,
    cvId: c.cvId,
    jobId: c.jobId,
    job: c.job,
    draft: draft?.cv ?? null,
    lastResult: draft
      ? {
          changeSummary: draft.changeSummary,
          matchScore: draft.matchScore,
          baseMatchScore: draft.baseMatchScore,
          matchNotes: draft.matchNotes,
        }
      : null,
    messages: c.messages.map(
      (m): MessageDto => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })
    ),
  };
}

const include = {
  job: true,
  messages: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ConversationInclude;

/** Start a tailoring session: create the Job + Conversation for a base CV. */
export async function createConversation(
  cvId: string,
  jobInput: { title?: string; company?: string; description: string }
): Promise<ConversationDto> {
  const description = jobInput.description.trim();
  if (!description) throw new Error("Job description is required.");

  const title =
    jobInput.title?.trim() ||
    description.split("\n").find((l) => l.trim())?.slice(0, 80) ||
    "Untitled role";

  const conversation = await prisma.conversation.create({
    data: {
      cv: { connect: { id: cvId } },
      job: {
        create: { title, company: jobInput.company?.trim() || null, description },
      },
    },
    include,
  });

  revalidatePath("/");
  return toConversationDto(conversation);
}

/** Regenerate the full CV tailored to the job. */
export async function generateTailoredCv(
  conversationId: string,
  instructions?: string
): Promise<ConversationDto> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { ...include, cv: true },
  });

  const baseCv = conv.cv.structured as unknown as StructuredCv;
  const result = await tailorCv(baseCv, conv.job.description, instructions);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draft: result as unknown as object,
      messages: {
        create: {
          role: "assistant",
          content: `Regenerated your CV for **${conv.job.title}** (match ~${result.matchScore}%).\n\n${result.changeSummary}`,
        },
      },
    },
  });

  const fresh = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include,
  });
  revalidatePath("/");
  return toConversationDto(fresh);
}

/** Refine the current draft with a chat instruction. */
export async function sendChatMessage(
  conversationId: string,
  message: string
): Promise<ConversationDto> {
  const text = message.trim();
  if (!text) throw new Error("Message is empty.");

  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include,
  });

  const draft = conv.draft as TailorResult | null;
  if (!draft) {
    throw new Error("Generate a tailored CV first, then refine it.");
  }

  await prisma.message.create({
    data: { conversationId, role: "user", content: text },
  });

  const history = conv.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  const result = await refineCv(draft.cv, conv.job.description, text, history);
  // The original CV's match score is fixed; keep the value from the first tailoring.
  result.baseMatchScore = draft.baseMatchScore ?? result.baseMatchScore;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      draft: result as unknown as object,
      messages: {
        create: {
          role: "assistant",
          content: `Updated ✅ (match ~${result.matchScore}%).\n\n${result.changeSummary}`,
        },
      },
    },
  });

  const fresh = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include,
  });
  revalidatePath("/");
  return toConversationDto(fresh);
}

export async function getConversation(
  id: string
): Promise<ConversationDto | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include,
  });
  return conv ? toConversationDto(conv) : null;
}
