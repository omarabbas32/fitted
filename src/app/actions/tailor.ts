"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateEditSession,
  include,
  runChat,
  runEdit,
  runGenerate,
  saveDraftToCv,
  toConversationDto,
} from "@/lib/tailoring";
import type { ChatMode } from "@/lib/cv-schema";
import type { ConversationDto } from "@/lib/dto";

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

/** Regenerate the full CV tailored to the job.
 *
 *  The UI drives generation through /api/tailor so it can render the CV as it
 *  streams; this stays as the non-streaming entry point. */
export async function generateTailoredCv(
  conversationId: string,
  instructions?: string
): Promise<ConversationDto> {
  return runGenerate(conversationId, instructions);
}

/** Refine the current draft with a chat instruction (non-streaming path — see
 *  /api/chat for the one the UI uses). */
export async function sendChatMessage(
  conversationId: string,
  message: string,
  mode: ChatMode = "tailor"
): Promise<ConversationDto> {
  return runChat(conversationId, message, mode);
}

/** Open (or resume) the jobless edit session for a CV. */
export async function startEditSession(cvId: string): Promise<ConversationDto> {
  return getOrCreateEditSession(cvId);
}

/** One edit turn (non-streaming path — see /api/edit for the one the UI uses). */
export async function sendEditMessage(
  conversationId: string,
  message: string
): Promise<ConversationDto> {
  return runEdit(conversationId, message);
}

/** Write an edit session's draft back over its CV. */
export async function saveEditToCv(conversationId: string): Promise<void> {
  return saveDraftToCv(conversationId);
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
