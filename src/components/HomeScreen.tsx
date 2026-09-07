"use client";

import {
  FilePlus,
  FileText,
  FileUp,
  Pencil,
  Scissors,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CvDto, VersionDto } from "@/lib/dto";
import { completenessScore } from "@/lib/intake";

/** The entry point: pick a CV, then pick what to do with it.
 *
 *  The three workspaces need very different furniture — a job description pane,
 *  a chat, a form — so choosing up front means none of them has to carry the
 *  other two's controls. */
export function HomeScreen({
  cvs,
  versions,
  activeCvId,
  busy,
  onSelectCv,
  onEdit,
  onTailor,
  onCreate,
  onUpload,
  onRename,
  onDelete,
}: {
  cvs: CvDto[];
  versions: VersionDto[];
  activeCvId: string | null;
  busy: string | null;
  onSelectCv: (id: string) => void;
  onEdit: () => void;
  onTailor: () => void;
  onCreate: () => void;
  onUpload: () => void;
  onRename: (cv: CvDto) => void;
  onDelete: (cv: CvDto) => void;
}) {
  const activeCv = cvs.find((c) => c.id === activeCvId) ?? null;
  const hasCv = !!activeCv;

  const cards = [
    {
      key: "edit",
      icon: <Pencil size={22} />,
      title: "Edit my CV with AI",
      blurb:
        "Chat your way through your own CV — tighten the wording, add a project, cut a section. It writes in what you tell it and nothing more.",
      action: "Start editing",
      onClick: onEdit,
      needsCv: true,
    },
    {
      key: "tailor",
      icon: <Scissors size={22} />,
      title: "Tailor to a job",
      blurb:
        "Paste a job description and get a version of your CV cut for it — with an honest match score and the gaps it can't close.",
      action: "Paste a job",
      onClick: onTailor,
      needsCv: true,
    },
    {
      key: "create",
      icon: <Sparkles size={22} />,
      title: "Create a new CV",
      blurb:
        "Start from an empty CV and fill it in, with a checklist of what's still missing and questions to answer as you go.",
      action: "Start from scratch",
      onClick: onCreate,
      needsCv: false,
    },
  ];

  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-title">What do you want to do?</h1>
        <p className="home-sub">
          {hasCv ? (
            <>
              Working on <b>{activeCv.title}</b>
              {cvs.length > 1 && " — switch below."}
            </>
          ) : (
            "Upload a CV to get started, or build one from scratch."
          )}
        </p>

        <div className="home-cards">
          {cards.map((c) => {
            const blocked = c.needsCv && !hasCv;
            return (
              <button
                key={c.key}
                className={`home-card ${blocked ? "blocked" : ""}`}
                onClick={blocked ? onUpload : c.onClick}
                disabled={busy !== null}
              >
                <span className="hc-ico">{c.icon}</span>
                <b>{c.title}</b>
                <span className="hc-blurb">{c.blurb}</span>
                <span className="hc-action">
                  {blocked ? "Upload a CV first →" : `${c.action} →`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="home-cvs">
          <div className="home-cvs-head">
            <FileText size={13} /> Your CVs
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={onUpload}
              disabled={busy !== null}
            >
              {busy === "upload" ? (
                <>
                  <span className="spin" /> Parsing…
                </>
              ) : (
                <>
                  <FileUp size={13} /> Upload a PDF
                </>
              )}
            </button>
          </div>

          {cvs.length === 0 ? (
            <div className="home-empty">
              <FilePlus size={15} /> No CVs yet — upload a PDF, or create one
              from scratch above.
            </div>
          ) : (
            <div className="home-cv-list">
              {cvs.map((cv) => {
                const vs = versions.filter((v) => v.cvId === cv.id).length;
                // The title is what the user can change; several CVs can carry
                // the same person's name, so leading with that made the list
                // unreadable and renaming pointless.
                return (
                  <div
                    key={cv.id}
                    className={`home-cv ${cv.id === activeCvId ? "on" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectCv(cv.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectCv(cv.id);
                      }
                    }}
                  >
                    <div className="hcv-body">
                      <b>{cv.title}</b>
                      <span>
                        {cv.structured.experience?.length ?? 0} roles · {vs}{" "}
                        version{vs === 1 ? "" : "s"} ·{" "}
                        {completenessScore(cv.structured)}% complete
                      </span>
                      <span className="hcv-src">
                        {cv.sourceFileName ?? "Built here"} ·{" "}
                        {new Date(cv.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <div className="hcv-tools">
                      <button
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRename(cv);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        title="Delete this CV and its versions"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(cv);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
