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
  "fontFamily": string   // OPTIONAL. Only set when the user asks to change the font.
                         // Must be exactly one of: "Georgia", "Times New Roman", "Cambria",
                         // "Garamond", "Calibri", "Arial", "Helvetica", "Segoe UI",
                         // "Verdana", "Trebuchet MS". Otherwise keep the existing value.
}
Omit unknown optional fields rather than inventing data. Dates are free-form strings (e.g. "Jan 2022", "2022", "Present").`;

export function emptyCv(): StructuredCv {
  return { name: "", contact: {}, skills: [], experience: [], education: [] };
}
