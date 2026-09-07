"use server";

import { prisma } from "@/lib/prisma";
import { mergeFactsIntoCv, suggestIntakeQuestions } from "@/lib/ai";
import { findIntakeIssues, type IntakeIssue } from "@/lib/intake";
import type { StructuredCv } from "@/lib/cv-schema";

async function baseCv(cvId: string): Promise<StructuredCv> {
  const cv = await prisma.cv.findUniqueOrThrow({ where: { id: cvId } });
  return cv.structured as unknown as StructuredCv;
}

/** Ask the model what else it would want to know about this candidate.
 *
 *  The structural gaps are found without a model call (lib/intake runs in the
 *  browser); they are passed along only so the questions that come back don't
 *  duplicate what the user is already looking at. */
export async function askIntakeQuestions(cvId: string): Promise<IntakeIssue[]> {
  const cv = await baseCv(cvId);
  const known = findIntakeIssues(cv).map((i) => `${i.section}: ${i.title}`);
  return suggestIntakeQuestions(cv, known);
}

/** Fold statements the candidate made into their master CV — and return the
 *  result without saving it.
 *
 *  Nothing here writes to the database on purpose. This is a model rewriting
 *  the one document every tailored version is derived from, so the user sees
 *  the diff and decides; the UI saves through updateBaseCv if they accept. */
export async function proposeCvUpdate(
  cvId: string,
  facts: string[]
): Promise<{ cv: StructuredCv; changeSummary: string }> {
  const clean = facts.map((f) => f.trim()).filter(Boolean);
  if (!clean.length) throw new Error("Nothing to add yet.");

  const cv = await baseCv(cvId);
  return mergeFactsIntoCv(cv, clean);
}
