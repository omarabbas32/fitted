import type { StructuredCv, MatchNotes } from "./cv-schema";

export type CvDto = {
  id: string;
  title: string;
  sourceFileName: string | null;
  structured: StructuredCv;
  createdAt: string;
};

export type MessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type VersionDto = {
  id: string;
  name: string;
  cvId: string;
  jobId: string;
  jobTitle: string;
  company: string | null;
  matchScore: number | null;
  baseMatchScore: number | null;
  changeSummary: string | null;
  matchNotes: MatchNotes | null;
  structured: StructuredCv;
  createdAt: string;
};

export type ConversationDto = {
  id: string;
  cvId: string;
  jobId: string;
  job: { title: string; company: string | null; description: string };
  draft: StructuredCv | null;
  lastResult: {
    changeSummary: string;
    matchScore: number;
    baseMatchScore: number;
    matchNotes: MatchNotes;
  } | null;
  messages: MessageDto[];
};
