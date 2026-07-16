"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FileUp,
  ListChecks,
  Minus,
  Moon,
  Pencil,
  Plus,
  Save,
  Scissors,
  Settings,
  Sun,
  Target,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import type { CvDto, VersionDto, ConversationDto } from "@/lib/dto";
import type { StructuredCv } from "@/lib/cv-schema";
import type { SettingsView } from "@/app/actions/settings";
import { uploadCv } from "@/app/actions/cv";
import {
  createConversation,
  generateTailoredCv,
  sendChatMessage,
} from "@/app/actions/tailor";
import {
  saveVersion,
  exportVersionPdf,
  exportCvPdf,
  deleteVersion,
} from "@/app/actions/version";
import {
  updateBaseCv,
  updateDraftCv,
  updateVersionCv,
} from "@/app/actions/edit";
import { CvPaper } from "./CvPaper";
import { CvEditor } from "./CvEditor";
import { SettingsModal } from "./SettingsModal";
import { FONTS, DEFAULT_FONT } from "@/lib/fonts";

const LS_WIDTH = "fitted.rightWidth";
const LS_THEME = "fitted.theme";

const MIN_RIGHT = 320;
const MAX_RIGHT = 780;
const DEFAULT_RIGHT = 460;

function scoreColor(score: number) {
  if (score >= 80) return "var(--green)";
  if (score >= 60) return "var(--amber)";
  return "var(--red)";
}

function scoreLabel(score: number) {
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Good match";
  return "Needs work";
}

function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function downloadBase64Pdf(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Dashboard({
  initialCvs,
  initialVersions,
  initialSettings,
}: {
  initialCvs: CvDto[];
  initialVersions: VersionDto[];
  initialSettings: SettingsView;
}) {
  const [cvs, setCvs] = useState(initialCvs);
  const [versions, setVersions] = useState(initialVersions);
  const [settings, setSettings] = useState(initialSettings);

  const [activeCvId, setActiveCvId] = useState<string | null>(
    initialCvs[0]?.id ?? null
  );
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );

  const [jd, setJd] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "upload" | "generate" | "send" | "export" | "save"
  const [showSettings, setShowSettings] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null); // non-null = modal open
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"preview" | "match">("preview");
  const [jdOpen, setJdOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Draggable width of the right (preview) column — dragging it left widens the
  // job-description / chat column. Persisted to localStorage.
  //
  // The width lives in a CSS variable rather than React state on purpose: a
  // pointermove-rate setState would re-render the whole dashboard (including the
  // CV paper) on every frame of the drag. Writing the variable straight to the
  // DOM keeps the drag at compositor speed, and it sidesteps a hydration
  // mismatch since the server can't know the persisted width.
  const gridRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(DEFAULT_RIGHT);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  function applyWidth(w: number) {
    const clamped = Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, w));
    widthRef.current = clamped;
    gridRef.current?.style.setProperty("--right-w", `${clamped}px`);
  }
  function persistWidth() {
    try {
      localStorage.setItem(LS_WIDTH, String(widthRef.current));
    } catch {}
  }

  useEffect(() => {
    const saved = Number(localStorage.getItem(LS_WIDTH));
    if (saved) applyWidth(saved);
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      applyWidth(d.startW + (d.startX - e.clientX));
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      persistWidth();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  function startDrag(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startW: widthRef.current };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  // Theme is stamped onto <html data-theme> by a blocking script in the layout
  // (before first paint, so there's no flash), and the Sun/Moon icons are
  // swapped by CSS off that same attribute. That keeps the toggle stateless —
  // nothing here needs to re-render when the theme flips.
  function toggleTheme() {
    const el = document.documentElement;
    const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
    el.setAttribute("data-theme", next);
    try {
      localStorage.setItem(LS_THEME, next);
    } catch {}
  }

  const activeCv = cvs.find((c) => c.id === activeCvId) ?? null;
  const selectedVersion =
    versions.find((v) => v.id === selectedVersionId) ?? null;

  const previewCv: StructuredCv | null = useMemo(() => {
    if (conversation?.draft) return conversation.draft;
    if (selectedVersion) return selectedVersion.structured;
    if (activeCv) return activeCv.structured;
    return null;
  }, [conversation, selectedVersion, activeCv]);

  const matchScore =
    conversation?.lastResult?.matchScore ?? selectedVersion?.matchScore ?? null;

  const baseMatchScore =
    conversation?.lastResult?.baseMatchScore ??
    selectedVersion?.baseMatchScore ??
    null;

  const matchNotes =
    conversation?.lastResult?.matchNotes ?? selectedVersion?.matchNotes ?? null;

  const hasMatch = matchScore != null;
  const gapCount = matchNotes?.gaps?.length ?? 0;

  // Derived rather than corrected in an effect: selecting a plain base CV leaves
  // nothing to show on the Match tab, so fall back to Preview for that render
  // instead of painting an empty tab and then fixing it up.
  const activeTab = hasMatch ? tab : "preview";

  function flash(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3500);
  }

  function scrollChat() {
    setTimeout(() => {
      streamRef.current?.scrollTo({
        top: streamRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 50);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const cv = await uploadCv(fd);
      setCvs((prev) => [cv, ...prev]);
      setActiveCvId(cv.id);
      setConversation(null);
      setSelectedVersionId(null);
      flash("CV uploaded and parsed");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Upload failed", true);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function selectCv(id: string) {
    setActiveCvId(id);
    setConversation(null);
    setSelectedVersionId(null);
    setEditing(false);
  }

  function selectVersion(v: VersionDto) {
    setSelectedVersionId(v.id);
    setActiveCvId(v.cvId);
    setConversation(null);
    setEditing(false);
  }

  async function handleGenerate() {
    if (!activeCv) return flash("Upload or select a base CV first.", true);
    if (!jd.trim()) return flash("Paste a job description first.", true);
    setBusy("generate");
    try {
      let conv = conversation;
      if (!conv || conv.cvId !== activeCv.id) {
        conv = await createConversation(activeCv.id, { description: jd });
      }
      const updated = await generateTailoredCv(conv.id);
      setConversation(updated);
      setSelectedVersionId(null);
      setJdOpen(false);
      setTab("match");
      scrollChat();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Generation failed", true);
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    if (!conversation || !chatInput.trim()) return;
    const msg = chatInput;
    setChatInput("");
    setBusy("send");
    try {
      const updated = await sendChatMessage(conversation.id, msg);
      setConversation(updated);
      scrollChat();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Message failed", true);
    } finally {
      setBusy(null);
    }
  }

  function openSave() {
    if (!conversation?.draft) return;
    setSaveName(conversation.job.title);
  }

  async function confirmSave() {
    if (!conversation?.draft || saveName === null) return;
    setBusy("save");
    try {
      const v = await saveVersion(conversation.id, saveName);
      setVersions((prev) => [v, ...prev]);
      setSelectedVersionId(null);
      setSaveName(null);
      flash("Version saved");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    setBusy("export");
    try {
      let res: { filename: string; base64: string };
      if (selectedVersion) {
        res = await exportVersionPdf(selectedVersion.id);
      } else if (previewCv) {
        res = await exportCvPdf(
          previewCv,
          conversation?.job.title ?? activeCv?.title ?? "cv"
        );
      } else {
        return;
      }
      downloadBase64Pdf(res.filename, res.base64);
      flash("PDF exported");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Export failed", true);
    } finally {
      setBusy(null);
    }
  }

  // Where the previewed CV comes from — determines where edits are saved.
  const editTarget: "draft" | "version" | "base" | null = conversation?.draft
    ? "draft"
    : selectedVersion
    ? "version"
    : activeCv
    ? "base"
    : null;

  /** Persist an edited CV to wherever the preview is sourced from + update state. */
  async function persistCv(edited: StructuredCv) {
    if (editTarget === "draft" && conversation) {
      await updateDraftCv(conversation.id, edited);
      setConversation({ ...conversation, draft: edited });
    } else if (editTarget === "version" && selectedVersion) {
      await updateVersionCv(selectedVersion.id, edited);
      setVersions((prev) =>
        prev.map((v) =>
          v.id === selectedVersion.id ? { ...v, structured: edited } : v
        )
      );
    } else if (editTarget === "base" && activeCv) {
      await updateBaseCv(activeCv.id, edited);
      setCvs((prev) =>
        prev.map((c) => (c.id === activeCv.id ? { ...c, structured: edited } : c))
      );
    }
  }

  async function handleSaveEdit(edited: StructuredCv) {
    setBusy("edit");
    try {
      await persistCv(edited);
      setEditing(false);
      flash("Changes saved");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setBusy(null);
    }
  }

  async function handleFontChange(fontId: string) {
    if (!previewCv) return;
    try {
      await persistCv({ ...previewCv, fontFamily: fontId });
      flash(`Font changed to ${fontId}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Font change failed", true);
    }
  }

  async function handleDeleteVersion(v: VersionDto, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete version "${v.name}"?`)) return;
    try {
      await deleteVersion(v.id);
      setVersions((prev) => prev.filter((x) => x.id !== v.id));
      if (selectedVersionId === v.id) setSelectedVersionId(null);
      flash("Version deleted");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", true);
    }
  }

  return (
    <div className="wrap">
      {/* Top bar */}
      <div className="topbar">
        <div className="logo">
          <div className="mark">
            <Scissors size={16} />
          </div>
          <div>
            <div className="word">Fitted</div>
            <small>Your CV, cut for the job</small>
          </div>
        </div>
        <div className="spacer" />
        <button className="model-pill" onClick={() => setShowSettings(true)}>
          <span className={settings.hasApiKey ? "dot" : "dot off"} />
          Model: <b>{settings.aiModel}</b>
          <ChevronDown size={13} />
        </button>
        <button className="icon-btn theme-btn" title="Toggle theme" onClick={toggleTheme}>
          <Sun size={15} className="ico-sun" />
          <Moon size={15} className="ico-moon" />
        </button>
        <button
          className="icon-btn"
          title="Settings"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={15} />
        </button>
      </div>

      <div className="grid" ref={gridRef}>
        {/* LEFT: My CVs */}
        <div className="panel">
          <div className="panel-head">
            <h2>My CVs</h2>
            {cvs.length > 0 && <span className="count-pill">{cvs.length}</span>}
            <div className="spacer" />
            <button
              className="icon-btn"
              title="Upload a CV"
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="side-body">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={handleUpload}
            />

            {cvs.length === 0 ? (
              <button
                className={`upload ${busy === "upload" ? "busy" : ""}`}
                onClick={() => fileRef.current?.click()}
              >
                <div className="u-ico">
                  {busy === "upload" ? (
                    <span className="spin" />
                  ) : (
                    <FileUp size={24} />
                  )}
                </div>
                <b>{busy === "upload" ? "Parsing your CV…" : "Upload your CV"}</b>
                <span>Drop a PDF here or click to browse</span>
              </button>
            ) : (
              busy === "upload" && (
                <div className="upload busy">
                  <div className="u-ico">
                    <span className="spin" />
                  </div>
                  <b>Parsing your CV…</b>
                </div>
              )
            )}

            {cvs.map((cv) => {
              const vs = versions.filter((v) => v.cvId === cv.id);
              const isActive = cv.id === activeCvId;
              return (
                <div className="cv-block" key={cv.id}>
                  <button
                    className={`cv-card ${isActive ? "active" : ""}`}
                    onClick={() => selectCv(cv.id)}
                  >
                    <div className="cv-avatar">
                      {initials(cv.structured.name || cv.title)}
                    </div>
                    <div className="cv-meta">
                      <b>{cv.structured.name || cv.title}</b>
                      <span>
                        {cv.structured.experience?.length ?? 0} roles ·{" "}
                        {vs.length} version{vs.length === 1 ? "" : "s"} ·{" "}
                        {relTime(cv.createdAt)}
                      </span>
                    </div>
                    <span className={`chevron ${isActive ? "open" : ""}`}>
                      <ChevronRight size={16} />
                    </span>
                  </button>

                  {isActive && (
                    <div className="ver-list">
                      {vs.length === 0 && (
                        <div className="ver-empty">
                          No tailored versions yet — paste a job description to
                          create one.
                        </div>
                      )}
                      {vs.map((v) => (
                        <div
                          key={v.id}
                          className={`ver ${
                            v.id === selectedVersionId ? "sel" : ""
                          }`}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectVersion(v)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectVersion(v);
                            }
                          }}
                        >
                          <div className="ver-body">
                            <span className="ver-title">
                              {v.jobTitle}
                              {v.company ? ` · ${v.company}` : ""}
                            </span>
                            <span className="ver-sub">{relTime(v.createdAt)}</span>
                          </div>
                          {v.matchScore != null && (
                            <span
                              className={`chip ${
                                v.matchScore >= 70 ? "chip-green" : "chip-amber"
                              }`}
                            >
                              {v.matchScore}%
                            </span>
                          )}
                          <button
                            className="ver-del"
                            title="Delete version"
                            onClick={(e) => handleDeleteVersion(v, e)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {activeCv && (
              <button
                className="btn btn-ghost btn-block btn-sm new-session"
                onClick={() => {
                  setConversation(null);
                  setSelectedVersionId(null);
                  setEditing(false);
                  setJd("");
                  setTab("preview");
                }}
              >
                <Target size={14} /> New tailoring session
              </button>
            )}
          </div>
        </div>

        {/* CENTER: Job description + chat */}
        <div className={`panel chat ${conversation ? "" : "compose"}`}>
          <div className="jd-bar">
            <div className="jd-label">
              <Target size={13} /> Target job description
            </div>
            {conversation ? (
              <>
                <button className="jd-chip" onClick={() => setJdOpen((o) => !o)}>
                  <FileText size={14} />
                  <span className="jd-chip-title">{conversation.job.title}</span>
                  <span className="jd-chip-hint">
                    {jdOpen ? "Hide" : "View"}
                    <ChevronDown
                      size={13}
                      style={{
                        transform: jdOpen ? "rotate(180deg)" : "none",
                        transition: "transform .18s",
                      }}
                    />
                  </span>
                </button>
                {jdOpen && (
                  <div className="jd-full">{conversation.job.description}</div>
                )}
              </>
            ) : (
              <textarea
                className="jd-input"
                placeholder="Paste the job description here, then generate…"
                value={jd}
                onChange={(e) => setJd(e.target.value)}
              />
            )}
          </div>

          <div className="stream" ref={streamRef}>
            {!conversation && (
              <div className="stream-empty">
                <div className="se-ico">
                  <Wand2 size={28} />
                </div>
                <p>
                  {activeCv
                    ? "Paste a job description above and generate a tailored CV."
                    : "Upload a CV, then paste a job description to tailor it."}
                </p>
              </div>
            )}

            {conversation?.messages.map((m) => (
              <div key={m.id} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                <div className={`avatar ${m.role === "user" ? "me" : "ai"}`}>
                  {m.role === "user" ? <User size={14} /> : <Scissors size={14} />}
                </div>
                <div className="bubble">{m.content}</div>
              </div>
            ))}
          </div>

          {conversation ? (
            <div className="composer">
              <textarea
                placeholder="Ask for a tweak — “make it one page”, “add metrics”…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                className="send"
                onClick={handleSend}
                disabled={busy === "send" || !chatInput.trim()}
              >
                {busy === "send" ? <span className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
          ) : (
            <div className="composer">
              <button
                className="btn btn-primary btn-block"
                onClick={handleGenerate}
                disabled={busy === "generate" || !activeCv || !jd.trim()}
              >
                {busy === "generate" ? (
                  <>
                    <span className="spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Scissors size={15} /> Generate tailored CV
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Drag handle to resize the job-description / preview split */}
        <div
          className="col-resizer"
          title="Drag to resize"
          onPointerDown={startDrag}
          onDoubleClick={() => {
            applyWidth(DEFAULT_RIGHT);
            persistWidth();
          }}
        >
          <span />
        </div>

        {/* RIGHT: Preview / Match */}
        <div className="panel">
          <div className="cvhead">
            {editing ? (
              <h2>Edit CV</h2>
            ) : hasMatch ? (
              <div className="tabs">
                <button
                  className={`tab ${activeTab === "preview" ? "on" : ""}`}
                  onClick={() => setTab("preview")}
                >
                  <FileText size={13} /> Preview
                </button>
                <button
                  className={`tab ${activeTab === "match" ? "on" : ""}`}
                  onClick={() => setTab("match")}
                >
                  <ListChecks size={13} /> Match
                  <span className="tab-n">{matchScore}%</span>
                </button>
              </div>
            ) : (
              <h2>Live Preview</h2>
            )}

            {!editing && activeTab === "preview" && previewCv && (
              <div className="head-tools">
                <select
                  className="font-select"
                  title="CV font"
                  value={previewCv.fontFamily || DEFAULT_FONT}
                  onChange={(e) => handleFontChange(e.target.value)}
                >
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={13} /> Edit
                </button>
              </div>
            )}
          </div>

          {editing && previewCv ? (
            <CvEditor
              initial={previewCv}
              saving={busy === "edit"}
              onCancel={() => setEditing(false)}
              onSave={handleSaveEdit}
            />
          ) : activeTab === "match" && matchScore != null ? (
            <div className="gaps">
              <div className="gaps-hero">
                <div
                  className="ring"
                  style={{
                    background: `conic-gradient(${scoreColor(
                      matchScore
                    )} ${matchScore}%, var(--border) 0)`,
                  }}
                >
                  <b>{matchScore}%</b>
                </div>
                <div className="gaps-hero-txt">
                  <b>{scoreLabel(matchScore)}</b>
                  {baseMatchScore != null ? (
                    <span>
                      Your base CV scored {baseMatchScore}% against this job —
                      tailoring took it to{" "}
                      <span
                        className="delta"
                        style={{ color: scoreColor(matchScore) }}
                      >
                        {matchScore}%
                      </span>
                      .
                    </span>
                  ) : (
                    <span>
                      Scored against{" "}
                      {selectedVersion?.jobTitle ?? conversation?.job.title ?? "this job"}.
                    </span>
                  )}
                </div>
              </div>

              {matchNotes?.added && matchNotes.added.length > 0 && (
                <div className="gaps-sec">
                  <div className="gaps-sec-head">
                    <Check size={13} /> What the tailoring emphasised
                  </div>
                  {matchNotes.added.map((a, i) => (
                    <div className="gap-row" key={`a${i}`}>
                      <span className="gap-k add">
                        <Plus size={11} />
                      </span>
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}

              {gapCount > 0 && (
                <div className="gaps-sec">
                  <div className="gaps-sec-head">
                    <AlertCircle size={13} /> Gaps this CV can&apos;t close
                  </div>
                  {matchNotes?.gaps?.map((g, i) => (
                    <div className="gap-row" key={`g${i}`}>
                      <span className="gap-k gap">
                        <Minus size={11} />
                      </span>
                      <span>{g}</span>
                    </div>
                  ))}
                  <div className="hint" style={{ marginTop: 10 }}>
                    These are real gaps between you and the role — Fitted won&apos;t
                    invent experience to cover them. Treat them as what to learn
                    next, or what to address directly in your cover letter.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="paper-wrap">
              {previewCv ? (
                <CvPaper cv={previewCv} />
              ) : (
                <div
                  className="empty"
                  style={{ textAlign: "center", padding: 40 }}
                >
                  Upload a CV to see the preview.
                </div>
              )}
            </div>
          )}

          <div className="cvfoot" style={{ display: editing ? "none" : "flex" }}>
            <button
              className="btn btn-ghost btn-block btn-sm"
              disabled={!conversation?.draft || busy === "save"}
              onClick={openSave}
            >
              {busy === "save" ? (
                <span className="spin" />
              ) : (
                <>
                  <Save size={14} /> Save version
                </>
              )}
            </button>
            <button
              className="btn btn-primary btn-block btn-sm"
              disabled={!previewCv || busy === "export"}
              onClick={handleExport}
            >
              {busy === "export" ? (
                <span className="spin" />
              ) : (
                <>
                  <Download size={14} /> Export PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s);
            setShowSettings(false);
            flash("Settings saved");
          }}
        />
      )}

      {saveName !== null && (
        <div className="overlay" onClick={() => setSaveName(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-head">
              <Save size={15} /> Save version
            </div>
            <div className="m-body">
              <div>
                <label className="field-l">Version name</label>
                <input
                  className="input"
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmSave();
                  }}
                  placeholder="e.g. Senior Backend @ Wink"
                />
                <div className="hint">
                  Saved under this base CV with its {matchScore ?? "—"}% match
                  score. Re-download as PDF anytime.
                </div>
              </div>
            </div>
            <div className="m-foot">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSaveName(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={confirmSave}
                disabled={busy === "save" || !saveName.trim()}
              >
                {busy === "save" ? <span className="spin" /> : "Save version"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.err ? "err" : ""}`}>
          {toast.err ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
