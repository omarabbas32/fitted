"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { renderCvPdf } from "@/lib/pdf/render";
import type { StructuredCv, MatchNotes, TailorResult } from "@/lib/cv-schema";
import type { VersionDto } from "@/lib/dto";

type VersionRow = {
  id: string;
  name: string;
  cvId: string;
  jobId: string;
  matchScore: number | null;
  baseMatchScore: number | null;
  changeSummary: string | null;
  matchNotes: unknown;
  structured: unknown;
  createdAt: Date;
  job: { title: string; company: string | null };
};

function toVersionDto(v: VersionRow): VersionDto {
  return {
    id: v.id,
    name: v.name,
    cvId: v.cvId,
    jobId: v.jobId,
    jobTitle: v.job.title,
    company: v.job.company,
    matchScore: v.matchScore,
    baseMatchScore: v.baseMatchScore,
    changeSummary: v.changeSummary,
    matchNotes: (v.matchNotes as MatchNotes | null) ?? null,
    structured: v.structured as StructuredCv,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Persist the conversation's current draft as a named version. */
export async function saveVersion(
  conversationId: string,
  name: string
): Promise<VersionDto> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { job: true },
  });
  const draft = conv.draft as TailorResult | null;
  if (!draft) throw new Error("Nothing to save — generate a tailored CV first.");
  // A version is a CV pinned to a job. An edit session has no job, so there is
  // nothing to pin it to — that draft is saved over the CV itself instead.
  if (!conv.job || !conv.jobId) {
    throw new Error(
      "This session has no job attached. Save it to your CV instead of as a version."
    );
  }

  const version = await prisma.cvVersion.create({
    data: {
      name: name.trim() || conv.job.title,
      cvId: conv.cvId,
      jobId: conv.jobId,
      conversationId: conv.id,
      structured: draft.cv as unknown as object,
      changeSummary: draft.changeSummary,
      matchNotes: draft.matchNotes as unknown as object,
      matchScore: draft.matchScore,
      baseMatchScore: draft.baseMatchScore,
    },
    include: { job: true },
  });

  revalidatePath("/");
  return toVersionDto(version);
}

export async function listVersions(cvId?: string): Promise<VersionDto[]> {
  const versions = await prisma.cvVersion.findMany({
    where: cvId ? { cvId } : undefined,
    orderBy: { createdAt: "desc" },
    include: { job: true },
  });
  return versions.map(toVersionDto);
}

export async function getVersion(id: string): Promise<VersionDto | null> {
  const v = await prisma.cvVersion.findUnique({
    where: { id },
    include: { job: true },
  });
  return v ? toVersionDto(v) : null;
}

export async function deleteVersion(id: string): Promise<void> {
  await prisma.cvVersion.delete({ where: { id } });
  revalidatePath("/");
}

/** Render a version to PDF; returns base64 for the client to download. */
export async function exportVersionPdf(
  id: string
): Promise<{ filename: string; base64: string }> {
  const v = await prisma.cvVersion.findUniqueOrThrow({
    where: { id },
    include: { job: true },
  });
  const cv = v.structured as unknown as StructuredCv;
  const pdf = await renderCvPdf(cv);
  const safe = (cv.name || v.job.title || "cv")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return {
    filename: `${safe}-${v.job.title.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
    base64: Buffer.from(pdf).toString("base64"),
  };
}

/** Render an ad-hoc structured CV (the live draft) to PDF without saving. */
export async function exportCvPdf(
  cv: StructuredCv,
  label: string
): Promise<{ filename: string; base64: string }> {
  const pdf = await renderCvPdf(cv);
  const safe = (cv.name || label || "cv")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return { filename: `${safe}.pdf`, base64: Buffer.from(pdf).toString("base64") };
}
