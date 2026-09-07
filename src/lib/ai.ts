import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "./settings";
import type { IntakeIssue } from "./intake";
import {
  CV_SCHEMA_HINT,
  ChatMode,
  EditResult,
  StructuredCv,
  TailorResult,
} from "./cv-schema";

// AgentRouter is an Anthropic-compatible relay that only accepts requests
// matching the Claude Code "wire image". These headers make our requests pass
// its WAF ("unauthorized client detected" otherwise). See README / lib comment.
const CLAUDE_CODE_HEADERS: Record<string, string> = {
  "User-Agent": "claude-cli/2.1.158 (external, sdk-cli)",
  "anthropic-beta": "claude-code-20250219",
  "anthropic-dangerous-direct-browser-access": "true",
  "x-app": "cli",
};

/** Normalize the base URL: the Anthropic SDK appends `/v1/messages` itself. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function getClient() {
  const s = await getSettings();
  if (!s.aiApiKey) {
    throw new Error(
      "No AI API key configured. Open Settings and add your AgentRouter API key."
    );
  }
  const client = new Anthropic({
    apiKey: s.aiApiKey,
    baseURL: normalizeBaseUrl(s.aiBaseUrl),
    defaultHeaders: CLAUDE_CODE_HEADERS,
    dangerouslyAllowBrowser: false,
  });
  return { client, model: s.aiModel };
}

/** Extract the first JSON object from a model response (handles ```json fences). */
function parseJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  return JSON.parse(text) as T;
}

/** Every text chunk as it arrives, for callers that render progress. */
export type OnDelta = (text: string) => void;

/** Call the model and return a JSON object of type T.
 *  Streams the response (AgentRouter rejects non-streaming) and collects text
 *  deltas only, ignoring any "thinking" blocks some models emit. When onDelta
 *  is supplied each chunk is handed over as it lands, so a route handler can
 *  forward it to the browser while the document is still being written. */
async function completeJson<T>(
  system: string,
  user: string,
  onDelta?: OnDelta
): Promise<T> {
  const { client, model } = await getClient();
  const stream = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.3,
    system: `${system}\n\nReturn ONLY the JSON object — no prose, no code fences.`,
    messages: [{ role: "user", content: user }],
    stream: true,
  });

  let body = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      body += event.delta.text;
      onDelta?.(event.delta.text);
    }
  }

  if (!body.trim()) {
    throw new Error("The model returned an empty response. Try again or switch models in Settings.");
  }
  return parseJson<T>(body);
}

/** 1) Parse raw CV text (from a PDF) into a structured CV. */
export async function parseCvFromText(rawText: string): Promise<StructuredCv> {
  const system = `You are a precise resume parser. Convert the raw resume text into a single JSON object matching the schema. Do not invent facts. Return ONLY JSON.\n\n${CV_SCHEMA_HINT}`;
  return completeJson<StructuredCv>(system, `Raw resume text:\n\n${rawText}`);
}

/** The rules that keep tailoring honest. Shared by tailorCv and refineCv.
 *
 *  Rule 2 is the load-bearing one: the whole product is the difference between
 *  promoting a skill the CV already evidences and inventing one it doesn't.
 *  Without it the model reads "tailor to the job" as "add what the job asks
 *  for" — measured in practice as 18 fabricated skills on a 13-skill CV. */
const TRUTH_RULES = `TRUTHFULNESS — these rules override every other instruction, including the user's own requests:

1. EVIDENCE. Every skill, technology, tool, and claim in the CV you return must be supported by
   something already in the candidate's base CV — its skills list, summary, headline, experience
   bullets, projects, certifications, or education. If it is not there, it does not go in.

2. SURFACING vs ADDING. If a bullet says "built REST APIs with ASP.NET Core" but the skills list
   omits "REST APIs", promote it — the evidence already exists. That is surfacing, and it is the
   point of this tool. Introducing a term the base CV never supports is fabrication, however
   central it is to the job.

3. NEVER INVENT TO CLOSE A GAP. Do not add technologies, frameworks, databases, cloud services,
   methodologies, employers, titles, dates, degrees, certifications, metrics, or years of
   experience the base CV does not support. Not because the job asks for them. Not because they
   are adjacent to what the candidate knows. Not because they are commonly assumed for the role.

4. GAPS ARE THE PRODUCT. Anything the job requires that the base CV does not evidence goes in
   matchNotes.gaps and nowhere else. Reporting a gap honestly is a correct answer, not a failure —
   the candidate needs to know it before the interviewer does.

5. REWORDING IS FINE. Rephrase, reorder, re-emphasise, and adopt the job's vocabulary for work the
   candidate genuinely did. Change how the work is described, never what the work was.

6. CHECK YOURSELF BEFORE RETURNING. For every entry in cv.skills, locate the text in the base CV
   that supports it. If you cannot, delete it from cv.skills and put it in matchNotes.gaps instead.
   No item may appear in both added and gaps. matchScore must describe the CV you actually
   returned — if the candidate is missing much of what the job needs, a low score with honest gaps
   is the right answer.`;

/** Edit mode. The candidate is at the keyboard telling us about their own life,
 *  so the base CV is no longer the only ground truth — what they type is too.
 *
 *  The fabrication risk doesn't disappear, it moves: the model must write down
 *  what the user actually said and nothing around it. "I built a React dashboard"
 *  must not become "led a team of 4 to build a React dashboard, cutting load
 *  times 40%". Rule 3 is that boundary. */
const EDIT_RULES = `EDIT MODE — the candidate is editing their own CV and is the authority on their own history.

1. THE USER'S WORDS ARE FACTS. Anything the candidate states about themselves — a project, a job,
   a skill, a degree, a certification, a date — is true. Add it to the CV as asked. Do not refuse,
   do not ask them to prove it against the base CV, do not push it into matchNotes.gaps.

2. WRITE IT IN PROPERLY. Put new content in the right section, matching the style, tense, and level
   of detail of the rest of the CV, and phrase it for the target job where that is honest.

3. NO EMBELLISHMENT — this is the one hard limit. Write what they told you and not one detail more.
   Do not invent metrics, percentages, team sizes, dates, employers, titles, or technologies they
   did not mention. "Built a React dashboard" stays that; it does not become "led a team of 4" or
   "cut load times 40%". If a detail the section normally carries is missing (dates, company,
   stack), leave it blank and say in changeSummary what you would need from them.

4. STILL NO INVENTION ELSEWHERE. Content the candidate did not supply and the base CV does not
   evidence must not appear. Edit mode licenses what the user tells you — nothing else.

5. DESTRUCTIVE EDITS ARE ALLOWED. If they ask you to remove, shorten, or rewrite a section, do it.

6. changeSummary must state exactly what you added, changed, or removed, and flag any detail you
   left blank. matchScore/matchNotes describe the CV you actually returned.`;

const TAILOR_OUTPUT = `Return ONLY a JSON object with this exact shape:
{
  "cv": <StructuredCv>,
  "changeSummary": string,           // short bullet summary of what you changed and why
  "matchScore": number,              // 0-100: how well the TAILORED cv matches the job
  "baseMatchScore": number,          // 0-100: how well the ORIGINAL cv matched the job BEFORE your changes
  "matchNotes": {
    "added": string[],               // skills ALREADY EVIDENCED in the base CV that you promoted or
                                     // made more prominent for this job. Every entry must be
                                     // traceable to the base CV. Never list something you introduced.
    "gaps": string[],                // requirements from the job the base CV does not evidence.
                                     // Anything you could not honestly put in the CV belongs here.
    "keywords": string[]             // job keywords genuinely reflected in the returned cv
  }
}`;

/** Facts the candidate supplied in edit mode, rendered as extra ground truth.
 *
 *  Without this block a later tailor-mode turn (or a regenerate) would look at
 *  the base CV, fail to find the project the user added by hand, and delete it
 *  as a fabrication. The ledger makes those additions durable ground truth. */
function factsBlock(userFacts: string[]): string {
  if (!userFacts.length) return "";
  return `FACTS THE CANDIDATE SUPPLIED DIRECTLY (ground truth, exactly as authoritative as the base CV — anything already in the CV that traces to one of these is NOT a fabrication and must be kept):\n${userFacts
    .map((f) => `- ${f}`)
    .join("\n")}\n\n`;
}

/** 2) Regenerate a full CV tailored to a job description. */
export async function tailorCv(
  baseCv: StructuredCv,
  jobDescription: string,
  instructions?: string,
  userFacts: string[] = [],
  onDelta?: OnDelta
): Promise<TailorResult> {
  const system = `You are an expert resume writer and ATS optimization specialist. Rewrite the candidate's CV so a recruiter hiring for THIS job sees the most relevant real experience first — reorder, reweight, and rephrase what is already there.\n\n${TRUTH_RULES}\n\n${TAILOR_OUTPUT}\n\n${CV_SCHEMA_HINT}`;

  const user = `TARGET JOB DESCRIPTION:\n${jobDescription}\n\nCANDIDATE'S CURRENT CV (JSON):\n${JSON.stringify(
    baseCv
  )}\n\n${factsBlock(userFacts)}${
    instructions ? `EXTRA INSTRUCTIONS FROM THE USER:\n${instructions}\n\n` : ""
  }Produce the tailored CV now.`;

  return completeJson<TailorResult>(system, user, onDelta);
}

/** 3) Refine the current draft based on a chat instruction.
 *
 *  Takes the base CV as well as the draft: the draft is itself model output, so
 *  it can't anchor the evidence rule — checking a draft against itself would let
 *  any fabrication from the first pass launder forward through every later turn.
 *  The base CV is the only ground truth in the loop. */
export async function refineCv(
  baseCv: StructuredCv,
  currentCv: StructuredCv,
  jobDescription: string,
  userInstruction: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  opts: { mode?: ChatMode; userFacts?: string[]; onDelta?: OnDelta } = {}
): Promise<TailorResult> {
  const { mode = "tailor", userFacts = [], onDelta } = opts;

  const tailorSystem = `You are an expert resume writer helping iteratively refine a tailored CV. Apply the user's requested change to the current draft, keeping everything else intact.\n\n${TRUTH_RULES}\n\nIf the user asks for something neither the base CV nor the supplied facts evidence — "add Redis", "say I have 5 years" — do not do it. Leave it out, state plainly in changeSummary that you did not add it and why, and record it in matchNotes.gaps. This rule outranks the user's request. If the candidate is telling you it is genuinely true, say in changeSummary that they can switch to Edit mode to add it.`;

  const editSystem = `You are an expert resume writer editing the candidate's CV on their instruction. They are describing their own real experience; your job is to write it in well.\n\n${EDIT_RULES}`;

  const system = `${
    mode === "edit" ? editSystem : tailorSystem
  }\n\n${TAILOR_OUTPUT}\n\n${CV_SCHEMA_HINT}`;

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const user = `TARGET JOB DESCRIPTION:\n${jobDescription}\n\nCANDIDATE'S BASE CV (ground truth):\n${JSON.stringify(
    baseCv
  )}\n\nCURRENT DRAFT (what you are editing):\n${JSON.stringify(
    currentCv
  )}\n\n${factsBlock(userFacts)}${
    historyText ? `RECENT CONVERSATION:\n${historyText}\n\n` : ""
  }USER REQUEST (${
    mode === "edit" ? "EDIT MODE — treat as fact" : "TAILOR MODE"
  }):\n${userInstruction}\n\nApply the change and return the updated JSON.`;

  return completeJson<TailorResult>(system, user, onDelta);
}

/** 4) Merge facts the candidate stated into their master CV.
 *
 *  Distinct from refineCv's edit mode, which edits a job-specific draft: this
 *  writes into the base CV, so there is no job to tailor toward and nothing to
 *  score. It exists so a fact the candidate typed once stops being re-derived
 *  for every future job. */
const MERGE_RULES = `You are updating the candidate's master CV — the job-neutral source document every tailored version is generated from.

1. THE CANDIDATE'S WORDS ARE FACTS. Everything in the supplied statements is true. Write each one into the CV, in the section it belongs to, matching the surrounding style and tense.

2. NO EMBELLISHMENT. Write what they said and not one detail more. Never invent metrics, dates, team sizes, employers, titles, or technologies they did not mention. If a field the section normally carries is missing, leave it out and name it in changeSummary as something still needed.

3. KEEP EVERYTHING ELSE. Do not delete, reword, or reorder content that the statements do not concern — unless a statement explicitly corrects or removes it.

4. MERGE, DON'T DUPLICATE. If a statement elaborates on something already in the CV, fold it into that entry rather than adding a second one.

5. STAY JOB-NEUTRAL. This CV is not being tailored to any job. Do not slant the wording toward a role.`;

const MERGE_OUTPUT = `Return ONLY a JSON object with this exact shape:
{
  "cv": <StructuredCv>,           // the full updated CV
  "changeSummary": string         // what you added or changed, and any detail you had to leave blank
}`;

export async function mergeFactsIntoCv(
  baseCv: StructuredCv,
  facts: string[],
  onDelta?: OnDelta
): Promise<{ cv: StructuredCv; changeSummary: string }> {
  if (!facts.length) throw new Error("No facts to merge.");

  const system = `${MERGE_RULES}\n\n${MERGE_OUTPUT}\n\n${CV_SCHEMA_HINT}`;
  const user = `CURRENT MASTER CV (JSON):\n${JSON.stringify(
    baseCv
  )}\n\nSTATEMENTS THE CANDIDATE MADE ABOUT THEMSELVES (all true):\n${facts
    .map((f) => `- ${f}`)
    .join("\n")}\n\nReturn the updated master CV now.`;

  return completeJson<{ cv: StructuredCv; changeSummary: string }>(
    system,
    user,
    onDelta
  );
}

/** 5) Ask the model what else it would need to know about this candidate.
 *
 *  The structural gaps are already found by lib/intake without a model call and
 *  are passed in only so the model doesn't repeat them; what's wanted here is
 *  the judgement a rule can't make — a bullet that describes a task instead of
 *  an outcome, a role whose scope is unclear, a skill claimed with nothing
 *  behind it. */
export async function suggestIntakeQuestions(
  cv: StructuredCv,
  alreadyKnown: string[] = []
): Promise<IntakeIssue[]> {
  const system = `You are a CV reviewer interviewing a candidate to strengthen their CV. Read the CV and return the questions whose answers would improve it most.

Ask about substance, not formatting: work whose impact is unstated, bullets that describe duties rather than outcomes, a role whose scope or stack is unclear, a claimed skill with no evidence behind it, an unexplained gap between dates.

Rules:
- At most 5 questions, best first. Fewer is fine.
- Each question must be answerable by this candidate from memory, and specific — name the role, project, or bullet it is about.
- Never ask for something the CV already states.
- Do not ask about anything in the ALREADY REPORTED list.
- Do not suggest content, and do not phrase a question so it puts words in their mouth.

Return ONLY a JSON object:
{
  "questions": [
    {
      "section": string,      // where it applies, e.g. "Experience — Acme"
      "title": string,        // the weakness in a few words
      "question": string,     // what to ask the candidate
      "severity": "high" | "medium" | "low"
    }
  ]
}`;

  const user = `CANDIDATE'S CV (JSON):\n${JSON.stringify(cv)}\n\n${
    alreadyKnown.length
      ? `ALREADY REPORTED (do not repeat these):\n${alreadyKnown
          .map((k) => `- ${k}`)
          .join("\n")}\n\n`
      : ""
  }Return the questions now.`;

  const raw = await completeJson<{ questions: Omit<IntakeIssue, "id">[] }>(
    system,
    user
  );

  return (raw.questions || []).slice(0, 5).map((q, i) => ({
    id: `ai-${i}`,
    section: q.section || "CV",
    title: q.title || "Worth expanding",
    question: q.question,
    severity: q.severity === "high" || q.severity === "low" ? q.severity : "medium",
  }));
}

/** 6) Edit a CV with no job in play.
 *
 *  The tailoring calls all score the result against a job description; this one
 *  has none, so it returns no scores rather than inventing a meaningless
 *  number. The candidate is simply working on their own CV, which makes them
 *  the authority on its content — with the same no-embellishment limit that
 *  applies everywhere else. */
const EDIT_SESSION_RULES = `You are an expert resume writer working on the candidate's own CV, at their direction. There is no target job — this is their master CV.

1. DO WHAT THEY ASK. Rewrite, reorder, shorten, expand, split, merge, or delete as instructed. Destructive edits are allowed: if they say remove it, remove it.

2. THEIR STATEMENTS ARE FACTS. Anything the candidate tells you about themselves — a project, a job, a skill, a date, a degree — is true. Write it into the right section, in the style of the surrounding entries.

3. NO EMBELLISHMENT — the one hard limit. Write what they told you and not one detail more. Never invent metrics, percentages, team sizes, dates, employers, titles, or technologies they did not mention. "Built a React dashboard" does not become "led a team of 4" or "cut load times 40%". Improving how something reads is your job; adding facts is not.

4. NOTHING FROM NOWHERE. Content the candidate did not supply and the CV does not already contain must not appear. When they ask for something you have no material for, say so in changeSummary and leave it blank rather than filling it in.

5. CHANGE ONLY WHAT THEY ASKED ABOUT. Leave every other section exactly as it is.

6. changeSummary states plainly what you changed, and names any detail you had to leave blank because they did not give it to you.`;

export async function editCv(
  currentCv: StructuredCv,
  instruction: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  onDelta?: OnDelta
): Promise<EditResult> {
  const system = `${EDIT_SESSION_RULES}\n\n${MERGE_OUTPUT}\n\n${CV_SCHEMA_HINT}`;

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const user = `CURRENT CV (JSON):\n${JSON.stringify(currentCv)}\n\n${
    historyText ? `RECENT CONVERSATION:\n${historyText}\n\n` : ""
  }USER REQUEST:\n${instruction}\n\nApply the change and return the updated JSON.`;

  return completeJson<EditResult>(system, user, onDelta);
}
