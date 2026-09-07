"use client";

import { AlertTriangle, Minus, Plus, RefreshCw } from "lucide-react";
import type { CvDiff } from "@/lib/cv-diff";

/** What the tailoring (or an edit) changed, against the base CV.
 *
 *  Ordered by how much it matters that you read it: skills the base CV doesn't
 *  evidence first — that is the failure mode this whole view exists to catch —
 *  then removals and additions, then the rewording. */
export function CvDiffView({
  diff,
  title,
}: {
  diff: CvDiff;
  title: string;
}) {
  if (diff.empty) {
    return (
      <div className="diff">
        <div className="diff-empty">
          Identical to the base CV — nothing has been changed yet.
        </div>
      </div>
    );
  }

  const { counts } = diff;

  return (
    <div className="diff">
      <div className="diff-head">
        <b>{title}</b>
        <div className="diff-chips">
          {counts.added > 0 && (
            <span className="diff-chip add">
              <Plus size={11} />
              {counts.added} added
            </span>
          )}
          {counts.removed > 0 && (
            <span className="diff-chip rm">
              <Minus size={11} />
              {counts.removed} dropped
            </span>
          )}
          {counts.reworded > 0 && (
            <span className="diff-chip rw">
              <RefreshCw size={11} />
              {counts.reworded} reworded
            </span>
          )}
        </div>
      </div>

      {diff.unsupportedSkills.length > 0 && (
        <div className="diff-warn">
          <div className="diff-warn-head">
            <AlertTriangle size={14} /> Not evidenced in your base CV
          </div>
          <div className="diff-warn-list">
            {diff.unsupportedSkills.map((s) => (
              <span className="skill-flag" key={s}>
                {s}
              </span>
            ))}
          </div>
          <p>
            These skills appear in the tailored CV but nothing in your base CV
            mentions them. Either they belong there — add the evidence in Edit
            mode — or remove them before you send this to anyone.
          </p>
        </div>
      )}

      {diff.lists.map((l) => (
        <div className="diff-sec" key={l.key}>
          <div className="diff-sec-head">{l.label}</div>
          <div className="diff-tags">
            {l.added.map((s) => (
              <span
                className={`tag add ${
                  diff.unsupportedSkills.includes(s) ? "flagged" : ""
                }`}
                key={`a-${s}`}
              >
                <Plus size={10} />
                {s}
              </span>
            ))}
            {l.removed.map((s) => (
              <span className="tag rm" key={`r-${s}`}>
                <Minus size={10} />
                {s}
              </span>
            ))}
          </div>
        </div>
      ))}

      {diff.fields.map((f) => (
        <div className="diff-sec" key={f.label}>
          <div className="diff-sec-head">{f.label}</div>
          {f.before && <div className="d-line rm">{f.before}</div>}
          {f.after && <div className="d-line add">{f.after}</div>}
        </div>
      ))}

      {diff.sections.map((s) => (
        <div className="diff-sec" key={s.key}>
          <div className="diff-sec-head">{s.label}</div>
          {s.entries.map((e, i) => (
            <div className={`diff-entry ${e.kind}`} key={`${s.key}-${i}`}>
              <div className="d-entry-head">
                <b>{e.title}</b>
                {e.kind !== "kept" && (
                  <span className={`d-badge ${e.kind}`}>
                    {e.kind === "added" ? "new entry" : "dropped"}
                  </span>
                )}
              </div>
              {e.subtitle && <div className="d-entry-sub">{e.subtitle}</div>}
              {e.bullets
                .filter((b) => b.kind !== "same")
                .map((b, j) => (
                  <div className={`d-line ${b.kind}`} key={j}>
                    {b.text}
                    {b.kind === "reworded" && (
                      <div className="d-from">was: {b.from}</div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
