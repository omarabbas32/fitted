// Structural diff between the base CV and a tailored one.
//
// The point of this module is verification, not presentation: tailoring is a
// model rewriting a document, and the only cheap way to catch it inventing
// something is to see, item by item, what it changed. `unsupportedSkills` is
// the sharpest of those checks — a skill the tailored CV claims that appears
// nowhere in the base CV's text is, by definition, not surfaced but invented.

import type {
  CvEducation,
  CvExperience,
  CvProject,
  CvVolunteering,
  StructuredCv,
} from "./cv-schema";

export type BulletDiff =
  | { kind: "same"; text: string }
  | { kind: "reworded"; text: string; from: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

export type EntryDiff = {
  kind: "added" | "removed" | "kept";
  title: string;
  subtitle?: string;
  bullets: BulletDiff[];
};

export type SectionDiff = {
  key: string;
  label: string;
  entries: EntryDiff[];
};

export type FieldDiff = {
  label: string;
  before: string;
  after: string;
};

export type ListDiff = {
  key: string;
  label: string;
  added: string[];
  removed: string[];
  kept: string[];
};

export type CvDiff = {
  fields: FieldDiff[];
  lists: ListDiff[];
  sections: SectionDiff[];
  /** Skills the tailored CV claims that no text in the base CV supports. */
  unsupportedSkills: string[];
  counts: { added: number; removed: number; reworded: number };
  /** True when the tailored CV is textually identical to the base. */
  empty: boolean;
};

const norm = (s?: string) => (s || "").trim().toLowerCase();

/** Words of a phrase, minus punctuation and the noise words that would make
 *  any two CV bullets look similar. */
const STOP = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "by", "at",
  "from", "as", "is", "was", "were", "be", "been", "that", "this", "it", "its",
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Crude suffix stripping so "unit tests" in a bullet counts as evidence for
 *  the skill "unit testing". Both sides go through it, so it only has to be
 *  consistent, not linguistically correct. */
function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, "");
}

/** Jaccard overlap of two phrases' significant words, 0..1. */
function similarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/** Above this, a tailored bullet is a rewrite of a base bullet rather than a
 *  new claim. Tuned so "Built REST APIs in ASP.NET Core" still matches
 *  "Designed and shipped REST APIs using ASP.NET Core", but an unrelated
 *  bullet about Kubernetes does not. */
const REWORD_THRESHOLD = 0.34;

/** Pair each tailored bullet with its closest surviving base bullet. Anything
 *  left over on either side is a genuine addition or removal. */
function diffBullets(base: string[], tailored: string[]): BulletDiff[] {
  const remaining = base.map((text, i) => ({ text, i, taken: false }));
  const out: BulletDiff[] = [];

  for (const text of tailored) {
    let best: (typeof remaining)[number] | null = null;
    let bestScore = 0;
    for (const cand of remaining) {
      if (cand.taken) continue;
      const score = norm(cand.text) === norm(text) ? 1 : similarity(cand.text, text);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best && bestScore >= REWORD_THRESHOLD) {
      best.taken = true;
      out.push(
        norm(best.text) === norm(text)
          ? { kind: "same", text }
          : { kind: "reworded", text, from: best.text }
      );
    } else {
      out.push({ kind: "added", text });
    }
  }

  for (const left of remaining) {
    if (!left.taken) out.push({ kind: "removed", text: left.text });
  }
  return out;
}

type EntryShape<T> = {
  key: (item: T) => string;
  title: (item: T) => string;
  subtitle?: (item: T) => string | undefined;
  bullets?: (item: T) => string[];
};

/** Diff two lists of section entries, matching on a stable key (a company +
 *  role, a project name) and falling back to fuzzy title matching so a
 *  reworded role title doesn't read as "removed one job, added another". */
function diffEntries<T>(
  base: T[] | undefined,
  tailored: T[] | undefined,
  shape: EntryShape<T>
): EntryDiff[] {
  const b = (base || []).map((item, i) => ({ item, i, taken: false }));
  const t = tailored || [];
  const out: EntryDiff[] = [];

  for (const item of t) {
    const key = norm(shape.key(item));
    let match = b.find((x) => !x.taken && norm(shape.key(x.item)) === key);
    if (!match) {
      let bestScore = 0;
      for (const cand of b) {
        if (cand.taken) continue;
        const score = similarity(shape.key(cand.item), shape.key(item));
        if (score > bestScore) {
          bestScore = score;
          match = cand;
        }
      }
      if (bestScore < 0.5) match = undefined;
    }

    const bullets = shape.bullets?.(item) || [];
    if (match) {
      match.taken = true;
      out.push({
        kind: "kept",
        title: shape.title(item),
        subtitle: shape.subtitle?.(item),
        bullets: diffBullets(shape.bullets?.(match.item) || [], bullets),
      });
    } else {
      out.push({
        kind: "added",
        title: shape.title(item),
        subtitle: shape.subtitle?.(item),
        bullets: bullets.map((text) => ({ kind: "added" as const, text })),
      });
    }
  }

  for (const left of b) {
    if (left.taken) continue;
    out.push({
      kind: "removed",
      title: shape.title(left.item),
      subtitle: shape.subtitle?.(left.item),
      bullets: (shape.bullets?.(left.item) || []).map((text) => ({
        kind: "removed" as const,
        text,
      })),
    });
  }
  return out;
}

function diffList(
  key: string,
  label: string,
  base: string[] | undefined,
  tailored: string[] | undefined
): ListDiff {
  const b = base || [];
  const t = tailored || [];
  const bn = b.map(norm);
  const tn = t.map(norm);
  return {
    key,
    label,
    added: t.filter((_, i) => !bn.includes(tn[i])),
    removed: b.filter((_, i) => !tn.includes(bn[i])),
    kept: t.filter((_, i) => bn.includes(tn[i])),
  };
}

/** Every piece of prose in a CV, lowercased — the corpus a claim must appear
 *  in to count as evidenced. */
function cvText(cv: StructuredCv): string {
  const parts: (string | undefined)[] = [
    cv.name,
    cv.headline,
    cv.summary,
    ...(cv.skills || []),
    ...(cv.certifications || []),
    ...(cv.languages || []).map((l) => `${l.name} ${l.level || ""}`),
    ...(cv.awards || []).map((a) => `${a.title} ${a.issuer || ""}`),
    ...(cv.publications || []).map((p) => `${p.title} ${p.venue || ""}`),
  ];
  for (const e of cv.experience || []) {
    parts.push(e.role, e.company, ...(e.bullets || []));
  }
  for (const p of cv.projects || []) {
    parts.push(p.name, p.description, ...(p.bullets || []));
  }
  for (const ed of cv.education || []) {
    parts.push(ed.school, ed.degree, ed.field, ed.details);
  }
  for (const v of cv.volunteering || []) {
    parts.push(v.org, v.role, ...(v.bullets || []));
  }
  return parts.filter(Boolean).join(" \n ").toLowerCase();
}

/** Skills in the tailored CV with no supporting text anywhere in the base CV.
 *
 *  A skill counts as evidenced if its own text appears in the base CV — either
 *  whole ("Kubernetes") or, for multi-word skills, every significant word of it
 *  ("REST API design" is evidenced by a bullet mentioning REST APIs and design).
 *  The check is deliberately generous: a false "unsupported" flag would train
 *  the user to ignore the list. */
export function unsupportedSkills(
  base: StructuredCv,
  tailored: StructuredCv
): string[] {
  const haystack = cvText(base);
  const tokens = new Set(words(haystack).map(stem));
  return (tailored.skills || []).filter((skill) => {
    const s = norm(skill);
    if (!s) return false;
    if (haystack.includes(s)) return false;
    const parts = words(skill).map(stem);
    return !(parts.length > 0 && parts.every((w) => tokens.has(w)));
  });
}

/** Diff a tailored (or edited) CV against the base CV it came from. */
export function diffCv(base: StructuredCv, tailored: StructuredCv): CvDiff {
  const fields: FieldDiff[] = [];
  const field = (label: string, b?: string, t?: string) => {
    if (norm(b) !== norm(t)) fields.push({ label, before: b || "", after: t || "" });
  };
  field("Headline", base.headline, tailored.headline);
  field("Summary", base.summary, tailored.summary);

  const lists: ListDiff[] = [
    diffList("skills", "Skills", base.skills, tailored.skills),
    diffList("certifications", "Certifications", base.certifications, tailored.certifications),
    diffList(
      "languages",
      "Languages",
      (base.languages || []).map((l) => (l.level ? `${l.name} (${l.level})` : l.name)),
      (tailored.languages || []).map((l) => (l.level ? `${l.name} (${l.level})` : l.name))
    ),
    diffList(
      "awards",
      "Awards",
      (base.awards || []).map((a) => a.title),
      (tailored.awards || []).map((a) => a.title)
    ),
    diffList(
      "publications",
      "Publications",
      (base.publications || []).map((p) => p.title),
      (tailored.publications || []).map((p) => p.title)
    ),
  ].filter((l) => l.added.length > 0 || l.removed.length > 0);

  const expShape: EntryShape<CvExperience> = {
    key: (e) => `${e.company} ${e.role}`,
    title: (e) => e.role || e.company,
    subtitle: (e) =>
      [e.company, [e.start, e.end].filter(Boolean).join(" — ")]
        .filter(Boolean)
        .join(" · "),
    bullets: (e) => e.bullets || [],
  };
  const projShape: EntryShape<CvProject> = {
    key: (p) => p.name,
    title: (p) => p.name,
    subtitle: (p) => p.description,
    bullets: (p) => p.bullets || [],
  };
  const eduShape: EntryShape<CvEducation> = {
    key: (e) => `${e.school} ${e.degree || ""}`,
    title: (e) => [e.degree, e.field].filter(Boolean).join(", ") || e.school,
    subtitle: (e) => e.school,
  };
  const volShape: EntryShape<CvVolunteering> = {
    key: (v) => `${v.org} ${v.role || ""}`,
    title: (v) => v.role || v.org,
    subtitle: (v) => (v.role ? v.org : undefined),
    bullets: (v) => v.bullets || [],
  };

  const sections: SectionDiff[] = [
    { key: "experience", label: "Experience", entries: diffEntries(base.experience, tailored.experience, expShape) },
    { key: "projects", label: "Projects", entries: diffEntries(base.projects, tailored.projects, projShape) },
    { key: "education", label: "Education", entries: diffEntries(base.education, tailored.education, eduShape) },
    { key: "volunteering", label: "Volunteering", entries: diffEntries(base.volunteering, tailored.volunteering, volShape) },
  ]
    // Drop entries that came through untouched — the diff should show what
    // changed, not restate the whole CV.
    .map((s) => ({
      ...s,
      entries: s.entries.filter(
        (e) => e.kind !== "kept" || e.bullets.some((b) => b.kind !== "same")
      ),
    }))
    .filter((s) => s.entries.length > 0);

  let added = 0;
  let removed = 0;
  let reworded = 0;
  for (const s of sections) {
    for (const e of s.entries) {
      if (e.kind === "added") added++;
      if (e.kind === "removed") removed++;
      for (const b of e.bullets) {
        if (b.kind === "added") added++;
        else if (b.kind === "removed") removed++;
        else if (b.kind === "reworded") reworded++;
      }
    }
  }
  for (const l of lists) {
    added += l.added.length;
    removed += l.removed.length;
  }
  reworded += fields.length;

  return {
    fields,
    lists,
    sections,
    unsupportedSkills: unsupportedSkills(base, tailored),
    counts: { added, removed, reworded },
    empty: fields.length === 0 && lists.length === 0 && sections.length === 0,
  };
}
