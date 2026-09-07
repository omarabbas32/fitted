import type { StructuredCv, MatchNotes, ChatMode } from "./cv-schema";

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
  /** On user messages: how the request was interpreted. */
  mode: ChatMode;
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
  /** Null on an edit session: there is no job in play. */
  jobId: string | null;
  job: { title: string; company: string | null; description: string } | null;
  draft: StructuredCv | null;
  /** Scores are null on an edit session — nothing to score against. */
  lastResult: {
    changeSummary: string;
    matchScore: number | null;
    baseMatchScore: number | null;
    matchNotes: MatchNotes | null;
  } | null;
  messages: MessageDto[];
};
