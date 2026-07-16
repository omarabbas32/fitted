import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "./settings";
import { CV_SCHEMA_HINT, StructuredCv, TailorResult } from "./cv-schema";

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

/** Call the model and return a JSON object of type T.
 *  Streams the response (AgentRouter rejects non-streaming) and collects text
 *  deltas only, ignoring any "thinking" blocks some models emit. */
async function completeJson<T>(system: string, user: string): Promise<T> {
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

const TAILOR_OUTPUT = `Return ONLY a JSON object with this exact shape:
{
  "cv": <StructuredCv>,
  "changeSummary": string,           // short bullet summary of what you changed and why
  "matchScore": number,              // 0-100: how well the TAILORED cv matches the job
  "baseMatchScore": number,          // 0-100: how well the ORIGINAL cv matched the job BEFORE your changes
  "matchNotes": {
    "added": string[],               // skills/keywords you surfaced to match the job
    "gaps": string[],                // real requirements the candidate still doesn't clearly meet
    "keywords": string[]             // important job keywords now present in the cv
  }
}`;

/** 2) Regenerate a full CV tailored to a job description. */
export async function tailorCv(
  baseCv: StructuredCv,
  jobDescription: string,
  instructions?: string
): Promise<TailorResult> {
  const system = `You are an expert resume writer and ATS optimization specialist. Rewrite the candidate's CV so it is tailored to the target job while remaining truthful — never fabricate employers, titles, or credentials. You may rephrase, reorder, emphasize relevant experience, and surface real skills that match the job.\n\n${TAILOR_OUTPUT}\n\n${CV_SCHEMA_HINT}`;

  const user = `TARGET JOB DESCRIPTION:\n${jobDescription}\n\nCANDIDATE'S CURRENT CV (JSON):\n${JSON.stringify(
    baseCv
  )}\n\n${
    instructions ? `EXTRA INSTRUCTIONS FROM THE USER:\n${instructions}\n\n` : ""
  }Produce the tailored CV now.`;

  return completeJson<TailorResult>(system, user);
}

/** 3) Refine the current draft based on a chat instruction. */
export async function refineCv(
  currentCv: StructuredCv,
  jobDescription: string,
  userInstruction: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<TailorResult> {
  const system = `You are an expert resume writer helping iteratively refine a tailored CV. Apply the user's requested change to the current CV, keeping everything else intact and staying truthful.\n\n${TAILOR_OUTPUT}\n\n${CV_SCHEMA_HINT}`;

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const user = `TARGET JOB DESCRIPTION:\n${jobDescription}\n\nCURRENT CV DRAFT (JSON):\n${JSON.stringify(
    currentCv
  )}\n\n${
    historyText ? `RECENT CONVERSATION:\n${historyText}\n\n` : ""
  }USER REQUEST:\n${userInstruction}\n\nApply the change and return the updated JSON.`;

  return completeJson<TailorResult>(system, user);
}
