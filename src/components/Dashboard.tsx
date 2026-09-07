"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  FileUp,
  GitCompare,
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
  Undo2,
  User,
  Wand2,
} from "lucide-react";
import type { CvDto, VersionDto, ConversationDto, MessageDto } from "@/lib/dto";
import { coercePartialCv, type ChatMode, type StructuredCv } from "@/lib/cv-schema";
import type { SettingsView } from "@/app/actions/settings";
import { diffCv } from "@/lib/cv-diff";
import { parsePartialJson } from "@/lib/partial-json";
import { readStream } from "@/lib/stream-protocol";
import { createBlankCv, deleteCv, renameCv, uploadCv } from "@/app/actions/cv";
import { proposeCvUpdate } from "@/app/actions/intake";
import {
  createConversation,
  saveEditToCv,
  startEditSession,
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
import { HomeScreen } from "./HomeScreen";
import { CvPaper } from "./CvPaper";
import { CvDiffView } from "./CvDiffView";
import { CvEditor } from "./CvEditor";
import { IntakePanel } from "./IntakePanel";
import { SettingsModal } from "./SettingsModal";
import { FONTS, DEFAULT_FONT } from "@/lib/fonts";

/** Which workspace is open. Each of the three does a different job and needs
 *  different furniture, so they don't share one screen — "home" is the chooser
 *  that decides between them. */
type WorkspaceView = "home" | "edit" | "tailor" | "create";

const VIEW_LABEL: Record<Exclude<WorkspaceView, "home">, string> = {
  edit: "Edit my CV with AI",
  tailor: "Tailor to a job",
  create: "Create a new CV",
};

/** The right-hand pane's views. Match and Diff depend on what is selected, so
 *  which of them exist is decided per render. */
type RightTab = "preview" | "match" | "diff";

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

  // Newest first, but skipping the empty ones: opening on a blank CV left
  // every workspace useless until you noticed and switched.
  const [activeCvId, setActiveCvId] = useState<string | null>(
    (
      initialCvs.find(
        (c) => c.structured.name || (c.structured.experience?.length ?? 0) > 0
      ) ?? initialCvs[0]
    )?.id ?? null
  );
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );

  const [jd, setJd] = useState("");
  // Tailor and Edit are two separate chat threads over the same draft CV.
  // "tailor" only reshuffles what the base CV already evidences; "edit" treats
  // what the user types as fact, so they can add real projects/experience.
  const [chatMode, setChatMode] = useState<ChatMode>("tailor");
  // One composer draft per thread, so switching tabs never eats what you typed.
  const [chatInputs, setChatInputs] = useState<Record<ChatMode, string>>({
    tailor: "",
    edit: "",
  });
  // Which thread the in-flight request belongs to, so the thinking bubble
  // doesn't appear in the other tab.
  const [sendingMode, setSendingMode] = useState<ChatMode>("tailor");
  const chatInput = chatInputs[chatMode];
  const setChatInput = (v: string) =>
    setChatInputs((prev) => ({ ...prev, [chatMode]: v }));
  const [busy, setBusy] = useState<string | null>(null); // "upload" | "generate" | "send" | "export" | "save"
  const [showSettings, setShowSettings] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null); // non-null = modal open
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(
    null
  );
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<WorkspaceView>("home");
  // Bumped whenever the CV under the editor is replaced from outside it (an
  // accepted proposal), so the form reloads instead of holding a stale copy.
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState<RightTab>("preview");
  // Raw model output for the generation in flight. It is re-parsed as it grows
  // into whatever CV has been written so far, so the preview fills in live
  // rather than sitting behind a spinner for a minute.
  const [streamRaw, setStreamRaw] = useState("");
  // A proposed rewrite of the BASE CV — from the guided intake, or from folding
  // in the facts given in Edit mode. Held out of the database until the user
  // has seen the diff and accepted it.
  const [proposal, setProposal] = useState<{
    cv: StructuredCv;
    changeSummary: string;
  } | null>(null);
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

  // Whatever the model has emitted so far this turn, as a renderable CV. The
  // JSON is truncated mid-token on nearly every frame, hence the tolerant parse.
  const streamingCv: StructuredCv | null = useMemo(() => {
    if (!streamRaw) return null;
    const partial = parsePartialJson<{ cv?: unknown }>(streamRaw);
    return partial?.cv ? coercePartialCv(partial.cv) : null;
  }, [streamRaw]);

  // What the right-hand pane paints. A proposal or an in-flight generation
  // takes over the view, but previewCv stays the thing that gets exported or
  // hand-edited — neither of those is saved yet.
  const shownCv = streamingCv ?? proposal?.cv ?? previewCv;

  // The tailored/edited CV against the base CV it came from. Identity holds
  // when the base CV is itself being previewed, and there is no diff to show.
  const diff = useMemo(() => {
    const base = activeCv?.structured;
    const target = proposal?.cv ?? previewCv;
    if (!base || !target || base === target) return null;
    return diffCv(base, target);
  }, [activeCv, previewCv, proposal]);

  const hasDiff = !!diff && !diff.empty;

  // Everything the user has asserted in Edit mode — the facts that exist only
  // in this conversation until they are written back to the base CV.
  const editFacts = useMemo(
    () =>
      (conversation?.messages || [])
        .filter((m) => m.role === "user" && m.mode === "edit")
        .map((m) => m.content),
    [conversation]
  );

  // The two chat threads are just the message list split by mode.
  const threadMessages = useMemo(
    () => conversation?.messages.filter((m) => m.mode === chatMode) ?? [],
    [conversation, chatMode]
  );
  const threadCounts = useMemo(
    () => ({
      tailor: conversation?.messages.filter((m) => m.mode === "tailor").length ?? 0,
      edit: conversation?.messages.filter((m) => m.mode === "edit").length ?? 0,
    }),
    [conversation]
  );

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

  // Derived rather than corrected in an effect: a tab whose content doesn't
  // exist for the current selection falls back to Preview for that render,
  // instead of painting an empty tab and then fixing it up.
  const tabAvailable: Record<RightTab, boolean> = {
    preview: true,
    match: hasMatch,
    diff: hasDiff,
  };
  const activeTab: RightTab = tabAvailable[tab] ? tab : "preview";

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
    setChatMode("tailor");
    setProposal(null);
    setTab("preview");
    // Switching CVs inside the edit workspace should switch which CV you are
    // editing, not drop you into an empty pane.
    if (view === "edit") void enterEdit(id);
  }

  /** Back to the chooser, with nothing from the last workspace left behind. */
  function goHome() {
    setView("home");
    setConversation(null);
    setSelectedVersionId(null);
    setEditing(false);
    setProposal(null);
    setJd("");
    setTab("preview");
    setChatMode("tailor");
  }

  /** Open the AI edit workspace for a CV, resuming that CV's session if it
   *  already has one — the chat is a record of what you've told the model
   *  about yourself, and starting over would throw it away. */
  async function enterEdit(cvId: string) {
    setBusy("session");
    try {
      const conv = await startEditSession(cvId);
      setActiveCvId(cvId);
      setConversation(conv);
      setSelectedVersionId(null);
      setProposal(null);
      setChatMode("edit");
      setTab("preview");
      setView("edit");
      scrollChat();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not open the editor", true);
    } finally {
      setBusy(null);
    }
  }

  function enterTailor() {
    setConversation(null);
    setSelectedVersionId(null);
    setProposal(null);
    setChatMode("tailor");
    setTab("preview");
    setView("tailor");
  }

  /** Save an edit session's draft over the CV it belongs to. Until this runs
   *  the chat has changed nothing permanent. */
  async function handleSaveToCv() {
    if (!conversation?.draft || !activeCv) return;
    const saved = conversation.draft;
    setBusy("save");
    try {
      await saveEditToCv(conversation.id);
      setCvs((prev) =>
        prev.map((c) => (c.id === activeCv.id ? { ...c, structured: saved } : c))
      );
      flash("Saved to your CV");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setBusy(null);
    }
  }

  /** Start a CV with nothing in it, for someone who has no PDF to upload. It
   *  opens straight into the editor — an empty CV has nothing to preview. */
  async function handleCreateBlank() {
    setBusy("upload");
    try {
      const cv = await createBlankCv();
      setCvs((prev) => [cv, ...prev]);
      setActiveCvId(cv.id);
      setConversation(null);
      setSelectedVersionId(null);
      setProposal(null);
      setEditing(true);
      setTab("preview");
      setView("create");
      flash("Blank CV created — fill it in");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not create a CV", true);
    } finally {
      setBusy(null);
    }
  }

  /** Fold the facts given in Edit mode back into the base CV.
   *
   *  Without this they live only in this conversation's message ledger, and
   *  every future job re-derives them from a CV that still doesn't mention
   *  them. The result is proposed, not saved — see applyProposal. */
  async function proposeFromFacts() {
    if (!activeCv || editFacts.length === 0) return;
    setBusy("proposal");
    try {
      setProposal(await proposeCvUpdate(activeCv.id, editFacts));
      flash("Review the changes, then apply them");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not update the CV", true);
    } finally {
      setBusy(null);
    }
  }

  async function applyProposal() {
    if (!proposal || !activeCv) return;
    const next = proposal.cv;
    setBusy("proposal");
    try {
      await updateBaseCv(activeCv.id, next);
      setCvs((prev) =>
        prev.map((c) => (c.id === activeCv.id ? { ...c, structured: next } : c))
      );
      setProposal(null);
      setTab("preview");
      setEditorKey((k) => k + 1);
      flash("Base CV updated");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setBusy(null);
    }
  }

  /** Switch chat thread. Each thread keeps its own messages and composer text. */
  function selectChatMode(mode: ChatMode) {
    setChatMode(mode);
    scrollChat();
  }

  function selectVersion(v: VersionDto) {
    setSelectedVersionId(v.id);
    setActiveCvId(v.cvId);
    setConversation(null);
    setEditing(false);
  }

  /** Drive one of the streaming endpoints: relay deltas into the live preview,
   *  then hand back the conversation the server persisted.
   *
   *  Failures arrive as a terminal event rather than an HTTP status, because by
   *  the time the model fails the response has usually already started. */
  async function runStream(
    url: string,
    payload: Record<string, unknown>
  ): Promise<ConversationDto> {
    setStreamRaw("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Request failed (${res.status}).`);
    }

    // Written by the callback, read after it — a plain `let` would be narrowed
    // to null by control-flow analysis that can't see into the callback.
    const out: { conversation?: ConversationDto; error?: string } = {};
    let raw = "";
    let painted = 0;

    await readStream(res, (event) => {
      if (event.type === "delta") {
        raw += event.text;
        // Deltas land far faster than the eye can read. Repainting on each one
        // would re-render (and re-parse the whole document) dozens of times a
        // second for no visible gain.
        const now = Date.now();
        if (now - painted > 120) {
          painted = now;
          setStreamRaw(raw);
        }
      } else if (event.type === "done") {
        out.conversation = event.conversation;
      } else {
        out.error = event.message;
      }
    });

    if (out.error) throw new Error(out.error);
    if (!out.conversation) {
      throw new Error("The connection closed before the CV was finished.");
    }
    return out.conversation;
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
      const updated = await runStream("/api/tailor", { conversationId: conv.id });
      setConversation(updated);
      setSelectedVersionId(null);
      setJdOpen(false);
      setTab("match");
      scrollChat();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Generation failed", true);
    } finally {
      setStreamRaw("");
      setBusy(null);
    }
  }

  async function handleSend() {
    if (!conversation || !chatInput.trim()) return;
    const msg = chatInput.trim();
    const conv = conversation;
    // Pinned for the whole request: the user may switch tabs while it runs, and
    // the reply must land back in the thread it was sent from.
    const mode = chatMode;

    // Show the message immediately. sendChatMessage doesn't resolve until the
    // model has re-emitted the entire CV, so without this the text would vanish
    // from the composer and reappear a minute later — it reads as a lost message.
    // The server is the source of truth: its response replaces this outright.
    const pending: MessageDto = {
      id: `pending-${conv.messages.length}-${msg.length}`,
      role: "user",
      content: msg,
      mode,
      createdAt: new Date().toISOString(),
    };
    setChatInputs((prev) => ({ ...prev, [mode]: "" }));
    setConversation({ ...conv, messages: [...conv.messages, pending] });
    setSendingMode(mode);
    setBusy("send");
    scrollChat();

    try {
      // An edit session has no job, so it goes to the endpoint that doesn't
      // try to score the result against one.
      const updated = await runStream(
        view === "edit" ? "/api/edit" : "/api/chat",
        view === "edit"
          ? { conversationId: conv.id, message: msg }
          : { conversationId: conv.id, message: msg, mode }
      );
      setConversation(updated);
      scrollChat();
    } catch (err) {
      // Drop the optimistic message and hand the text back so it isn't lost.
      setConversation((c) =>
        c ? { ...c, messages: c.messages.filter((m) => m.id !== pending.id) } : c
      );
      setChatInputs((prev) => ({ ...prev, [mode]: msg }));
      flash(err instanceof Error ? err.message : "Message failed", true);
    } finally {
      setStreamRaw("");
      setBusy(null);
    }
  }

  function openSave() {
    if (!conversation?.draft) return;
    setSaveName(conversation.job?.title ?? activeCv?.title ?? "Version");
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
          conversation?.job?.title ?? activeCv?.title ?? "cv"
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

  async function confirmRename() {
    if (!renaming?.title.trim()) return;
    const { id, title } = renaming;
    setBusy("rename");
    try {
      await renameCv(id, title);
      setCvs((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      setRenaming(null);
      flash("Renamed");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Rename failed", true);
    } finally {
      setBusy(null);
    }
  }

  /** Delete a CV and everything hanging off it. Without this the list only ever
   *  grows, and "start from scratch" makes empty ones cheap to create. */
  async function handleDeleteCv(cv: CvDto) {
    const vs = versions.filter((v) => v.cvId === cv.id).length;
    const warning = vs
      ? ` and its ${vs} saved version${vs === 1 ? "" : "s"}`
      : "";
    if (!window.confirm(`Delete "${cv.title}"${warning}? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteCv(cv.id);
      const left = cvs.filter((c) => c.id !== cv.id);
      setCvs(left);
      setVersions((prev) => prev.filter((v) => v.cvId !== cv.id));
      if (activeCvId === cv.id) {
        setActiveCvId(left[0]?.id ?? null);
        setConversation(null);
        setSelectedVersionId(null);
        setProposal(null);
      }
      flash("CV deleted");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", true);
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
        {view !== "home" && (
          <>
            <button
              className="icon-btn back-btn"
              title="Back to the start"
              onClick={goHome}
            >
              <ArrowLeft size={15} />
            </button>
            <span className="view-title">{VIEW_LABEL[view]}</span>
          </>
        )}
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

      {/* Outside the workspace grid: the home screen uploads through it too. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={handleUpload}
      />

      {view === "home" ? (
        <HomeScreen
          cvs={cvs}
          versions={versions}
          activeCvId={activeCvId}
          busy={busy}
          onSelectCv={setActiveCvId}
          onEdit={() => activeCvId && enterEdit(activeCvId)}
          onTailor={enterTailor}
          onCreate={handleCreateBlank}
          onUpload={() => fileRef.current?.click()}
          onRename={(cv) => setRenaming({ id: cv.id, title: cv.title })}
          onDelete={handleDeleteCv}
        />
      ) : (
      <div className="grid" ref={gridRef}>
        {/* LEFT: My CVs */}
        <div className="panel">
          <div className="panel-head">
            <h2>My CVs</h2>
            {cvs.length > 0 && <span className="count-pill">{cvs.length}</span>}
            <div className="spacer" />
            <button
              className="icon-btn"
              title="Start a CV from scratch"
              onClick={handleCreateBlank}
            >
              <FilePlus size={15} />
            </button>
            <button
              className="icon-btn"
              title="Upload a CV"
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="side-body">

            {cvs.length === 0 && (
              <>
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
                {busy !== "upload" && (
                  <button
                    className="btn btn-ghost btn-block btn-sm"
                    onClick={handleCreateBlank}
                  >
                    <FilePlus size={14} /> …or start from scratch
                  </button>
                )}
              </>
            )}

            {cvs.length > 0 && busy === "upload" && (
              <div className="upload busy">
                <div className="u-ico">
                  <span className="spin" />
                </div>
                <b>Parsing your CV…</b>
              </div>
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
                      <b>{cv.title}</b>
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

                  {isActive && view === "tailor" && (
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

            {activeCv && view === "tailor" && (
              <button
                className="btn btn-ghost btn-block btn-sm new-session"
                onClick={() => {
                  setConversation(null);
                  setSelectedVersionId(null);
                  setEditing(false);
                  setJd("");
                  setTab("preview");
                  setChatMode("tailor");
                  setProposal(null);
                }}
              >
                <Target size={14} /> New tailoring session
              </button>
            )}
          </div>
        </div>

        {/* CENTER: Job description + chat */}
        <div className={`panel chat ${conversation ? "" : "compose"}`}>
          {view === "tailor" && (
          <div className="jd-bar">
            <div className="jd-label">
              <Target size={13} /> Target job description
            </div>
            {conversation ? (
              <>
                <button className="jd-chip" onClick={() => setJdOpen((o) => !o)}>
                  <FileText size={14} />
                  <span className="jd-chip-title">{conversation.job?.title}</span>
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
                  <div className="jd-full">{conversation.job?.description}</div>
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
          )}

          {conversation && view === "tailor" && (
            <div className="chat-tabs">
              <div className="tabs">
                <button
                  className={`tab ${chatMode === "tailor" ? "on" : ""}`}
                  onClick={() => selectChatMode("tailor")}
                  title="Reshuffles and rewords what your CV already proves — it will refuse to add anything new."
                >
                  <Target size={13} /> Tailor
                  {threadCounts.tailor > 0 && (
                    <span className="tab-n">{threadCounts.tailor}</span>
                  )}
                </button>
                <button
                  className={`tab ${chatMode === "edit" ? "on" : ""}`}
                  onClick={() => selectChatMode("edit")}
                  title="Tell it about real work it doesn't know about — a project, a job, a skill — and it writes it in."
                >
                  <Pencil size={13} /> Edit
                  {threadCounts.edit > 0 && (
                    <span className="tab-n">{threadCounts.edit}</span>
                  )}
                </button>
              </div>
              <span className="mode-hint">
                {chatMode === "edit"
                  ? "What you type is taken as fact and added to the CV."
                  : "Won't add anything your CV doesn't already evidence."}
              </span>
              {chatMode === "edit" && editFacts.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={proposeFromFacts}
                  disabled={busy !== null}
                  title="Write these facts into your base CV, so every future job starts from them"
                >
                  {busy === "proposal" ? (
                    <span className="spin" />
                  ) : (
                    <>
                      <Save size={12} /> To base CV
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {view === "create" && activeCv ? (
            <IntakePanel
              cvId={activeCv.id}
              cv={activeCv.structured}
              onProposal={setProposal}
              onError={(m) => flash(m, true)}
            />
          ) : (
          <>
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

            {conversation && threadMessages.length === 0 && busy !== "send" && (
              <div className="stream-empty">
                <div className="se-ico">
                  {chatMode === "edit" ? <Pencil size={28} /> : <Target size={28} />}
                </div>
                <p>
                  {view === "edit"
                    ? "Tell me what to change — tighten the summary, add a project, cut a role, add metrics you actually have. Nothing is saved to your CV until you press Save."
                    : chatMode === "edit"
                    ? "Tell me about real work this CV is missing — a project, a job, a skill — and I'll write it in. I won't add details you didn't give me."
                    : "Ask for tweaks — reordering, wording, length. I won't add anything your CV doesn't already evidence."}
                </p>
              </div>
            )}

            {threadMessages.map((m) => (
              <div
                key={m.id}
                className={`msg ${m.role === "user" ? "user" : "ai"} ${
                  m.id.startsWith("pending-") ? "pending" : ""
                }`}
              >
                <div className={`avatar ${m.role === "user" ? "me" : "ai"}`}>
                  {m.role === "user" ? <User size={14} /> : <Scissors size={14} />}
                </div>
                <div className="bubble">{m.content}</div>
              </div>
            ))}

            {busy === "send" && sendingMode === chatMode && (
              <div className="msg ai">
                <div className="avatar ai">
                  <Scissors size={14} />
                </div>
                <div className="bubble thinking">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  {chatMode === "edit"
                    ? "Writing that into your CV — this re-generates the whole document, so it takes a moment."
                    : "Rewriting your CV — this re-generates the whole document, so it takes a moment."}
                </div>
              </div>
            )}
          </div>

          {conversation ? (
            <div className={`composer mode-${chatMode}`}>
              <textarea
                placeholder={
                  view === "edit"
                    ? "What should change? “Tighten my summary”, “add a project: Fitted, built in Next.js”…"
                    : chatMode === "edit"
                    ? "Describe real work to add — “add a project: Fitted, a CV tailoring app in Next.js and MySQL”…"
                    : "Ask for a tweak — “make it one page”, “lead with backend work”…"
                }
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
          </>
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
            ) : proposal ? (
              <h2>Proposed changes</h2>
            ) : (
              <div className="tabs">
                <button
                  className={`tab ${activeTab === "preview" ? "on" : ""}`}
                  onClick={() => setTab("preview")}
                >
                  <FileText size={13} /> Preview
                </button>
                {tabAvailable.match && (
                  <button
                    className={`tab ${activeTab === "match" ? "on" : ""}`}
                    onClick={() => setTab("match")}
                  >
                    <ListChecks size={13} /> Match
                    <span className="tab-n">{matchScore}%</span>
                  </button>
                )}
                {tabAvailable.diff && diff && (
                  <button
                    className={`tab ${activeTab === "diff" ? "on" : ""}`}
                    onClick={() => setTab("diff")}
                    title="Line by line, what the tailoring changed against your base CV"
                  >
                    <GitCompare size={13} /> Diff
                    <span
                      className={`tab-n ${
                        diff.unsupportedSkills.length ? "warn" : ""
                      }`}
                    >
                      {diff.unsupportedSkills.length
                        ? `${diff.unsupportedSkills.length} ⚠`
                        : `+${diff.counts.added}`}
                    </span>
                  </button>
                )}
              </div>
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

          {editing && previewCv && !proposal ? (
            <CvEditor
              key={editorKey}
              initial={previewCv}
              saving={busy === "edit"}
              onCancel={() => setEditing(false)}
              onSave={handleSaveEdit}
            />
          ) : proposal ? (
            <div className="paper-wrap">
              <div className="proposal">
                <div className="proposal-sum">{proposal.changeSummary}</div>
                <div className="proposal-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setProposal(null)}
                    disabled={busy === "proposal"}
                  >
                    <Undo2 size={13} /> Discard
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={applyProposal}
                    disabled={busy === "proposal"}
                  >
                    {busy === "proposal" ? (
                      <span className="spin" />
                    ) : (
                      <>
                        <Check size={13} /> Apply to base CV
                      </>
                    )}
                  </button>
                </div>
              </div>
              {diff ? (
                <CvDiffView diff={diff} title="What this would change" />
              ) : (
                <div className="hint">
                  This changes nothing in your base CV.
                </div>
              )}
            </div>
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
                      {selectedVersion?.jobTitle ?? conversation?.job?.title ?? "this job"}.
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
          ) : activeTab === "diff" && diff ? (
            <div className="paper-wrap">
              <CvDiffView
                diff={diff}
                title={`Against ${activeCv?.structured.name || "your base CV"}`}
              />
            </div>
          ) : (
            <div className="paper-wrap">
              {streamingCv && (
                <div className="stream-badge">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  Writing your CV…
                </div>
              )}
              {shownCv ? (
                <CvPaper cv={shownCv} />
              ) : (
                <div
                  className="empty"
                  style={{ textAlign: "center", padding: 40 }}
                >
                  Upload a CV — or start one from scratch — to see the preview.
                </div>
              )}
            </div>
          )}

          <div
            className="cvfoot"
            style={{ display: editing || proposal ? "none" : "flex" }}
          >
            {view === "tailor" && (
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
            )}
            {view === "edit" && (
              <button
                className="btn btn-ghost btn-block btn-sm"
                disabled={!conversation?.draft || busy === "save" || !hasDiff}
                onClick={handleSaveToCv}
                title="Write these changes over your CV"
              >
                {busy === "save" ? (
                  <span className="spin" />
                ) : (
                  <>
                    <Save size={14} /> Save to my CV
                  </>
                )}
              </button>
            )}
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
      )}

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

      {renaming && (
        <div className="overlay" onClick={() => setRenaming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-head">
              <Pencil size={15} /> Rename CV
            </div>
            <div className="m-body">
              <div>
                <label className="field-l">Name</label>
                <input
                  className="input"
                  autoFocus
                  value={renaming.title}
                  onChange={(e) =>
                    setRenaming({ ...renaming, title: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmRename();
                  }}
                />
                <div className="hint">
                  Only what this CV is called here — it never appears on the CV
                  itself.
                </div>
              </div>
            </div>
            <div className="m-foot">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={confirmRename}
                disabled={busy === "rename" || !renaming.title.trim()}
              >
                {busy === "rename" ? <span className="spin" /> : "Rename"}
              </button>
            </div>
          </div>
        </div>
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
