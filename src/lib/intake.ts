// What the CV is still missing, worked out without asking the model.
//
// Most of what makes a CV thin is structural — a role with no dates, a project
// with no description, no contact email — and a rule can see all of it for
// free and instantly. The model is only worth spending on the judgement calls
// (is this bullet actually saying anything?), which is what
// `suggestIntakeQuestions` in lib/ai handles on top of this.

import type { StructuredCv } from "./cv-schema";

export type IntakeSeverity = "high" | "medium" | "low";

export type IntakeIssue = {
  /** Stable within one CV, so the UI can track which prompts were dismissed. */
  id: string;
  /** Where in the CV this is about, e.g. "Experience — Acme". */
  section: string;
  /** The problem, stated flatly. */
  title: string;
  /** What to ask the candidate to fix it. Doubles as the prefilled answer prompt. */
  question: string;
  severity: IntakeSeverity;
};

const WEIGHT: Record<IntakeSeverity, number> = { high: 12, medium: 6, low: 3 };

/** Does any bullet carry a number? Unquantified bullets are the single most
 *  common weakness in a CV, but only worth mentioning once per role. */
const hasMetric = (bullets: string[]) => bullets.some((b) => /\d/.test(b));

const label = (s: string | undefined, fallback: string) =>
  (s || "").trim() || fallback;

/** Everything a rule can tell is missing, worst first. */
export function findIntakeIssues(cv: StructuredCv): IntakeIssue[] {
  const out: IntakeIssue[] = [];
  const add = (
    id: string,
    section: string,
    title: string,
    question: string,
    severity: IntakeSeverity
  ) => out.push({ id, section, title, question, severity });

  if (!cv.name?.trim()) {
    add("name", "Header", "No name on the CV", "What name should the CV carry?", "high");
  }
  if (!cv.contact?.email?.trim()) {
    add("email", "Header", "No email address", "What email address should employers use?", "high");
  }
  if (!cv.contact?.phone?.trim()) {
    add("phone", "Header", "No phone number", "What phone number should the CV list?", "medium");
  }
  if (!cv.contact?.location?.trim()) {
    add("location", "Header", "No location", "Which city and country are you based in?", "low");
  }
  if (!(cv.contact?.links || []).length) {
    add("links", "Header", "No links", "Do you have a LinkedIn, GitHub, or portfolio URL to include?", "low");
  }
  if (!cv.headline?.trim()) {
    add("headline", "Header", "No headline", "What job title do you want to be read as — e.g. \"Backend Engineer\"?", "medium");
  }

  if (!cv.summary?.trim()) {
    add("summary", "Summary", "No professional summary", "In two or three sentences, what do you do and what are you best at?", "medium");
  } else if (cv.summary.trim().length < 80) {
    add("summary-thin", "Summary", "Summary is very short", "Can you say more about your focus and strongest areas?", "low");
  }

  const skills = cv.skills || [];
  if (skills.length === 0) {
    add("skills", "Skills", "No skills listed", "Which technologies and tools do you actually work with?", "high");
  } else if (skills.length < 5) {
    add("skills-thin", "Skills", "Only a few skills listed", "What other tools, languages, or frameworks do you use regularly?", "low");
  }

  const experience = cv.experience || [];
  if (experience.length === 0) {
    add("experience", "Experience", "No work experience", "What roles have you held? Company, title, dates, and what you did.", "high");
  }
  experience.forEach((e, i) => {
    const where = `Experience — ${label(e.company, `role ${i + 1}`)}`;
    if (!e.company?.trim()) {
      add(`exp-${i}-company`, where, "No company name", `Who did you work for as ${label(e.role, "this role")}?`, "high");
    }
    if (!e.role?.trim()) {
      add(`exp-${i}-role`, where, "No job title", `What was your title at ${label(e.company, "this company")}?`, "high");
    }
    if (!e.start?.trim() || !e.end?.trim()) {
      add(`exp-${i}-dates`, where, "Missing dates", `When did you start and finish at ${label(e.company, "this company")}?`, "high");
    }
    const bullets = e.bullets || [];
    if (bullets.length === 0) {
      add(`exp-${i}-bullets`, where, "No bullets", `What did you actually build or own at ${label(e.company, "this company")}?`, "high");
    } else if (bullets.length < 2) {
      add(`exp-${i}-thin`, where, "Only one bullet", `What else did you do at ${label(e.company, "this company")}?`, "medium");
    } else if (!hasMetric(bullets)) {
      add(`exp-${i}-metrics`, where, "No numbers in any bullet", `Any figures for your work at ${label(e.company, "this company")} — users, latency, team size, volume?`, "low");
    }
  });

  if ((cv.education || []).length === 0) {
    add("education", "Education", "No education listed", "What did you study, where, and when?", "medium");
  }
  (cv.education || []).forEach((ed, i) => {
    if (!ed.degree?.trim() && !ed.field?.trim()) {
      add(`edu-${i}-degree`, `Education — ${label(ed.school, `entry ${i + 1}`)}`, "No degree or field", `What did you study at ${label(ed.school, "this school")}?`, "low");
    }
  });

  (cv.projects || []).forEach((p, i) => {
    if (!p.description?.trim() && !(p.bullets || []).length) {
      add(`proj-${i}`, `Projects — ${label(p.name, `project ${i + 1}`)}`, "Project has no detail", `What is ${label(p.name, "this project")}, and what did you build it with?`, "medium");
    }
  });

  if ((cv.projects || []).length === 0 && experience.length < 2) {
    add("projects", "Projects", "No projects listed", "Built anything on your own worth showing — a side project, an open-source contribution?", "medium");
  }

  const order: IntakeSeverity[] = ["high", "medium", "low"];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/** A 0-100 readiness figure derived from the same issues, so the UI can show
 *  progress rather than just a list that never empties. */
export function completenessScore(cv: StructuredCv): number {
  const penalty = findIntakeIssues(cv).reduce((n, i) => n + WEIGHT[i.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}
