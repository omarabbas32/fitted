"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { StructuredCv, TailorResult } from "@/lib/cv-schema";

/** Overwrite a base CV's structured content (manual edits). */
export async function updateBaseCv(
  cvId: string,
  structured: StructuredCv
): Promise<void> {
  await prisma.cv.update({
    where: { id: cvId },
    data: { structured: structured as unknown as object },
  });
  revalidatePath("/");
}

/** Overwrite the working draft CV inside a conversation (keeps match metadata). */
export async function updateDraftCv(
  conversationId: string,
  structured: StructuredCv
): Promise<void> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  const draft = (conv.draft as TailorResult | null) ?? {
    cv: structured,
    changeSummary: "",
    matchScore: 0,
    baseMatchScore: 0,
    matchNotes: { added: [], gaps: [], keywords: [] },
  };
  draft.cv = structured;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { draft: draft as unknown as object },
  });
  revalidatePath("/");
}

/** Overwrite a saved version's structured content. */
export async function updateVersionCv(
  versionId: string,
  structured: StructuredCv
): Promise<void> {
  await prisma.cvVersion.update({
    where: { id: versionId },
    data: { structured: structured as unknown as object },
  });
  revalidatePath("/");
}
