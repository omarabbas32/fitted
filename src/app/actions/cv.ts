"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { extractPdfText } from "@/lib/pdf/extract";
import { parseCvFromText } from "@/lib/ai";
import type { StructuredCv } from "@/lib/cv-schema";
import type { CvDto } from "@/lib/dto";

function toCvDto(cv: {
  id: string;
  title: string;
  sourceFileName: string | null;
  structured: unknown;
  createdAt: Date;
}): CvDto {
  return {
    id: cv.id,
    title: cv.title,
    sourceFileName: cv.sourceFileName,
    structured: cv.structured as StructuredCv,
    createdAt: cv.createdAt.toISOString(),
  };
}

/** Upload a PDF CV: extract text, structure with AI, persist as a base CV. */
export async function uploadCv(formData: FormData): Promise<CvDto> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided.");

  const buffer = new Uint8Array(await file.arrayBuffer());
  const rawText = await extractPdfText(buffer);
  if (!rawText || rawText.length < 30) {
    throw new Error(
      "Could not read text from this PDF (it may be a scanned image)."
    );
  }

  const structured = await parseCvFromText(rawText);
  const title = structured.name
    ? `${structured.name} — CV`
    : file.name.replace(/\.pdf$/i, "");

  const cv = await prisma.cv.create({
    data: {
      title,
      sourceFileName: file.name,
      rawText,
      structured: structured as unknown as object,
    },
  });

  revalidatePath("/");
  return toCvDto(cv);
}

export async function listCvs(): Promise<CvDto[]> {
  const cvs = await prisma.cv.findMany({ orderBy: { createdAt: "desc" } });
  return cvs.map(toCvDto);
}

export async function deleteCv(id: string): Promise<void> {
  await prisma.cv.delete({ where: { id } });
  revalidatePath("/");
}
