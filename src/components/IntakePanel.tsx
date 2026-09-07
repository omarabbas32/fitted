"use client";

import { useMemo, useState } from "react";
import { ListChecks, Sparkles, Wand2 } from "lucide-react";
import type { StructuredCv } from "@/lib/cv-schema";
import {
  completenessScore,
  findIntakeIssues,
  type IntakeIssue,
} from "@/lib/intake";
import { askIntakeQuestions, proposeCvUpdate } from "@/app/actions/intake";

/** The guided intake: what this CV is still missing, and a place to answer.
 *
 *  The structural checks run here in the browser — they are pure rules over the
 *  CV object, so there is no reason to spend a round trip, let alone a model
 *  call, to notice a role with no dates. The model is only asked for the
 *  judgement questions, and only when the user asks for them. */
export function IntakePanel({
  cvId,
  cv,
  onProposal,
  onError,
}: {
  cvId: string;
  cv: StructuredCv;
  onProposal: (proposal: { cv: StructuredCv; changeSummary: string }) => void;
  onError: (message: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [aiIssues, setAiIssues] = useState<IntakeIssue[] | null>(null);
  const [busy, setBusy] = useState<"ask" | "apply" | null>(null);

  const issues = useMemo(() => findIntakeIssues(cv), [cv]);
  const score = useMemo(() => completenessScore(cv), [cv]);
  const all = [...issues, ...(aiIssues || [])];

  const answered = all.filter((i) => answers[i.id]?.trim());

  async function handleAsk() {
    setBusy("ask");
    try {
      setAiIssues(await askIntakeQuestions(cvId));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not get questions.");
    } finally {
      setBusy(null);
    }
  }

  async function handleApply() {
    if (!answered.length) return;
    setBusy("apply");
    try {
      // Each fact carries the question as well as the answer: on its own, "two
      // years, about 40 people" is not something the model can file anywhere.
      const facts = answered.map(
        (i) => `${i.section} — ${i.question}\nAnswer: ${answers[i.id].trim()}`
      );
      onProposal(await proposeCvUpdate(cvId, facts));
      setAnswers({});
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the CV.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="intake">
      <div className="intake-hero">
        <div className="meter">
          <div className="meter-bar">
            <span style={{ width: `${score}%` }} />
          </div>
          <b>{score}%</b>
        </div>
        <div className="intake-hero-txt">
          <b>
            {all.length === 0
              ? "Nothing obvious missing"
              : `${all.length} thing${all.length === 1 ? "" : "s"} worth filling in`}
          </b>
          <span>
            Answer any of these and they get written into your base CV — so every
            future tailoring starts from them.
          </span>
        </div>
      </div>

      {all.length === 0 && (
        <div className="hint">
          The structural checks are all clear. Ask for a review below if you want
          the harder questions — the ones about whether your bullets actually say
          anything.
        </div>
      )}

      {all.map((issue) => (
        <div className={`intake-row sev-${issue.severity}`} key={issue.id}>
          <div className="intake-row-head">
            <span className="intake-sec">{issue.section}</span>
            <span className={`sev-dot ${issue.severity}`} />
          </div>
          <b>{issue.title}</b>
          <p>{issue.question}</p>
          <textarea
            className="input"
            rows={2}
            placeholder="Your answer — only what's true; it gets written in as-is."
            value={answers[issue.id] || ""}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [issue.id]: e.target.value }))
            }
          />
        </div>
      ))}

      <div className="intake-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleAsk}
          disabled={busy !== null}
        >
          {busy === "ask" ? (
            <>
              <span className="spin" /> Reviewing…
            </>
          ) : (
            <>
              <Sparkles size={13} />
              {aiIssues ? "Review again" : "Ask AI what else it needs"}
            </>
          )}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleApply}
          disabled={busy !== null || answered.length === 0}
        >
          {busy === "apply" ? (
            <>
              <span className="spin" /> Writing…
            </>
          ) : (
            <>
              <Wand2 size={13} /> Add {answered.length || ""} answer
              {answered.length === 1 ? "" : "s"} to my CV
            </>
          )}
        </button>
      </div>

      {aiIssues?.length === 0 && (
        <div className="hint">
          <ListChecks size={12} /> The review came back with nothing to add.
        </div>
      )}
    </div>
  );
}
