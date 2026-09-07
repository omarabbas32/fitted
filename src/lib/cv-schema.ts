// Shared structured-CV shape used by parse, tailor, refine, preview, and PDF render.

export type CvContact = {
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

export type CvExperience = {
  company: string;
  role: string;
  location?: string;
  start?: string;
  end?: string;
  bullets: string[];
};

export type CvEducation = {
  school: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
  details?: string;
};

export type CvProject = {
  name: string;
  description?: string;
  link?: string;
  bullets?: string[];
};

/** A spoken/written language and how well the candidate uses it. */
export type CvLanguage = {
  name: string;
  /** Free-form proficiency, e.g. "Native", "Fluent", "B2". */
  level?: string;
};

export type CvAward = {
  title: string;
  issuer?: string;
  year?: string;
};

export type CvPublication = {
  title: string;
  /** Journal, conference, publisher, or site. */
  venue?: string;
  year?: string;
  link?: string;
};

export type CvVolunteering = {
  org: string;
  role?: string;
  start?: string;
  end?: string;
  bullets?: string[];
};

export type StructuredCv = {
  name: string;
  headline?: string;
  contact: CvContact;
  summary?: string;
  skills: string[];
  experience: CvExperience[];
  education: CvEducation[];
  projects?: CvProject[];
  certifications?: string[];
  languages?: CvLanguage[];
  awards?: CvAward[];
  publications?: CvPublication[];
  volunteering?: CvVolunteering[];
  /** Font for the rendered CV; one of the allowed font ids (see lib/fonts). */
  fontFamily?: string;
};

export type MatchNotes = {
  /** Skills/keywords added to better match the job. */
  added: string[];
  /** Requirements the CV still does not clearly cover. */
  gaps: string[];
  /** Job keywords now reflected in the CV. */
  keywords: string[];
};

/** Result of a tailor/refine operation. */
export type TailorResult = {
  cv: StructuredCv;
  changeSummary: string;
  matchScore: number; // 0-100 for the tailored CV
  baseMatchScore: number; // 0-100 for the original (main) CV vs the job
  matchNotes: MatchNotes;
};

/** Result of an edit turn with no job attached — nothing to score. */
export type EditResult = {
  cv: StructuredCv;
  changeSummary: string;
};

/** A session's working draft.
 *
 *  A tailoring session fills in the scores; an edit session has no job to
 *  score against and leaves them null rather than reporting a meaningless 0%. */
export type DraftState = {
  cv: StructuredCv;
  changeSummary: string;
  matchScore: number | null;
  baseMatchScore: number | null;
  matchNotes: MatchNotes | null;
};

/** How a chat message is interpreted.
 *  "tailor" — nothing may be claimed that the base CV doesn't evidence.
 *  "edit"   — the candidate is stating new facts about themselves; write them in. */
export type ChatMode = "tailor" | "edit";

/** Human-readable schema block embedded in prompts so any model returns the right shape. */
export const CV_SCHEMA_HINT = `StructuredCv JSON shape:
{
  "name": string,
  "headline": string,                 // short professional title, e.g. "Senior Frontend Engineer"
  "contact": { "email": string, "phone": string, "location": string, "links": string[] },
  // links MUST be full URLs (e.g. "https://linkedin.com/in/omar", "https://github.com/omar"),
  // never bare labels like "LinkedIn". Use the HYPERLINKS list in the input to fill real URLs.
  "summary": string,                  // 2-3 sentence professional summary
  "skills": string[],
  "experience": [
    { "company": string, "role": string, "location": string,
      "start": string, "end": string, "bullets": string[] }
  ],
  "education": [
    { "school": string, "degree": string, "field": string, "start": string, "end": string, "details": string }
  ],
  "projects": [ { "name": string, "description": string, "link": string, "bullets": string[] } ],
  "certifications": string[],
  "languages": [ { "name": string, "level": string } ],   // level e.g. "Native", "Fluent", "B2"
  "awards": [ { "title": string, "issuer": string, "year": string } ],
  "publications": [ { "title": string, "venue": string, "year": string, "link": string } ],
  "volunteering": [ { "org": string, "role": string, "start": string, "end": string, "bullets": string[] } ],
  "fontFamily": string   // OPTIONAL. Only set when the user asks to change the font.
                         // Must be exactly one of: "Georgia", "Times New Roman", "Cambria",
                         // "Garamond", "Calibri", "Arial", "Helvetica", "Segoe UI",
                         // "Verdana", "Trebuchet MS". Otherwise keep the existing value.
}
Omit unknown optional fields rather than inventing data. Never emit an empty array for an optional
section — leave the key out. Dates are free-form strings (e.g. "Jan 2022", "2022", "Present").`;

export function emptyCv(): StructuredCv {
  return { name: "", contact: {}, skills: [], experience: [], education: [] };
}

/** Shape a partially-streamed object into something the preview can render.
 *
 *  Mid-stream the model may have written half an experience entry or an array
 *  of one string; the preview must survive that without a crash, so every
 *  field is taken only if it already has the right type. Returns null when
 *  there is nothing CV-shaped yet. */
export function coercePartialCv(value: unknown): StructuredCv | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  const strs = (x: unknown) =>
    Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  const objs = (x: unknown) =>
    Array.isArray(x)
      ? (x.filter(
          (i) => i && typeof i === "object" && !Array.isArray(i)
        ) as Record<string, unknown>[])
      : [];

  const contact = (v.contact && typeof v.contact === "object"
    ? (v.contact as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    name: str(v.name) ?? "",
    headline: str(v.headline),
    contact: {
      email: str(contact.email),
      phone: str(contact.phone),
      location: str(contact.location),
      links: strs(contact.links),
    },
    summary: str(v.summary),
    skills: strs(v.skills),
    experience: objs(v.experience).map((e) => ({
      company: str(e.company) ?? "",
      role: str(e.role) ?? "",
      location: str(e.location),
      start: str(e.start),
      end: str(e.end),
      bullets: strs(e.bullets),
    })),
    education: objs(v.education).map((e) => ({
      school: str(e.school) ?? "",
      degree: str(e.degree),
      field: str(e.field),
      start: str(e.start),
      end: str(e.end),
      details: str(e.details),
    })),
    projects: objs(v.projects).map((p) => ({
      name: str(p.name) ?? "",
      description: str(p.description),
      link: str(p.link),
      bullets: strs(p.bullets),
    })),
    certifications: strs(v.certifications),
    languages: objs(v.languages).map((l) => ({
      name: str(l.name) ?? "",
      level: str(l.level),
    })),
    awards: objs(v.awards).map((a) => ({
      title: str(a.title) ?? "",
      issuer: str(a.issuer),
      year: str(a.year),
    })),
    publications: objs(v.publications).map((p) => ({
      title: str(p.title) ?? "",
      venue: str(p.venue),
      year: str(p.year),
      link: str(p.link),
    })),
    volunteering: objs(v.volunteering).map((w) => ({
      org: str(w.org) ?? "",
      role: str(w.role),
      start: str(w.start),
      end: str(w.end),
      bullets: strs(w.bullets),
    })),
    fontFamily: str(v.fontFamily),
  };
}
