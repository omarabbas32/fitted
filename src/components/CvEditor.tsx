"use client";

import { useState } from "react";
import type {
  StructuredCv,
  CvExperience,
  CvEducation,
  CvProject,
} from "@/lib/cv-schema";
import { FONTS, DEFAULT_FONT } from "@/lib/fonts";

const toLines = (arr?: string[]) => (arr || []).join("\n");
const fromLines = (s: string) =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);
const fromCommas = (s: string) =>
  s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** The optional sections are all "array of small objects" with identical add /
 *  patch / remove moves, so they share one set of helpers rather than four
 *  near-identical copies of the Experience/Education pattern. */
type ListKey = "languages" | "awards" | "publications" | "volunteering";
type ListItem<K extends ListKey> = NonNullable<StructuredCv[K]>[number];

export function CvEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: StructuredCv;
  onSave: (cv: StructuredCv) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [cv, setCv] = useState<StructuredCv>(
    JSON.parse(JSON.stringify(initial))
  );

  const set = (patch: Partial<StructuredCv>) => setCv((c) => ({ ...c, ...patch }));
  const setContact = (patch: Partial<StructuredCv["contact"]>) =>
    setCv((c) => ({ ...c, contact: { ...c.contact, ...patch } }));

  function updExp(i: number, patch: Partial<CvExperience>) {
    setCv((c) => {
      const experience = [...c.experience];
      experience[i] = { ...experience[i], ...patch };
      return { ...c, experience };
    });
  }
  function updEdu(i: number, patch: Partial<CvEducation>) {
    setCv((c) => {
      const education = [...c.education];
      education[i] = { ...education[i], ...patch };
      return { ...c, education };
    });
  }
  function updProj(i: number, patch: Partial<CvProject>) {
    setCv((c) => {
      const projects = [...(c.projects || [])];
      projects[i] = { ...projects[i], ...patch };
      return { ...c, projects };
    });
  }

  // A computed key defeats TypeScript's object-literal narrowing, so each of
  // these rebuilds one known-good array and asserts the result back.
  const listOf = <K extends ListKey>(c: StructuredCv, key: K) =>
    (c[key] || []) as ListItem<K>[];

  function addItem<K extends ListKey>(key: K, item: ListItem<K>) {
    setCv((c) => ({ ...c, [key]: [...listOf(c, key), item] } as StructuredCv));
  }
  function updItem<K extends ListKey>(
    key: K,
    i: number,
    patch: Partial<ListItem<K>>
  ) {
    setCv((c) => {
      const list = [...listOf(c, key)];
      list[i] = { ...list[i], ...patch };
      return { ...c, [key]: list } as StructuredCv;
    });
  }
  function delItem<K extends ListKey>(key: K, i: number) {
    setCv(
      (c) =>
        ({
          ...c,
          [key]: listOf(c, key).filter((_, j) => j !== i),
        } as StructuredCv)
    );
  }

  const languages = cv.languages || [];
  const awards = cv.awards || [];
  const publications = cv.publications || [];
  const volunteering = cv.volunteering || [];

  return (
    <div className="editor">
      <div className="ed-sec">
        <div className="ed-grid">
          <div>
            <label className="field-l">Full name</label>
            <input className="input" value={cv.name || ""} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className="field-l">Headline / title</label>
            <input className="input" value={cv.headline || ""} onChange={(e) => set({ headline: e.target.value })} />
          </div>
          <div>
            <label className="field-l">Email</label>
            <input className="input" value={cv.contact?.email || ""} onChange={(e) => setContact({ email: e.target.value })} />
          </div>
          <div>
            <label className="field-l">Phone</label>
            <input className="input" value={cv.contact?.phone || ""} onChange={(e) => setContact({ phone: e.target.value })} />
          </div>
          <div>
            <label className="field-l">Location</label>
            <input className="input" value={cv.contact?.location || ""} onChange={(e) => setContact({ location: e.target.value })} />
          </div>
          <div>
            <label className="field-l">Links (one per line, full URLs)</label>
            <textarea className="input" rows={2} value={toLines(cv.contact?.links)} onChange={(e) => setContact({ links: fromLines(e.target.value) })} />
          </div>
          <div>
            <label className="field-l">Font</label>
            <select className="input" value={cv.fontFamily || DEFAULT_FONT} onChange={(e) => set({ fontFamily: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="ed-sec">
        <label className="field-l">Summary</label>
        <textarea className="input" rows={3} value={cv.summary || ""} onChange={(e) => set({ summary: e.target.value })} />
      </div>

      <div className="ed-sec">
        <label className="field-l">Skills (comma-separated)</label>
        <textarea className="input" rows={2} value={(cv.skills || []).join(", ")} onChange={(e) => set({ skills: fromCommas(e.target.value) })} />
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Experience
          <button className="btn btn-ghost btn-sm" onClick={() => set({ experience: [...cv.experience, { company: "", role: "", bullets: [] }] })}>+ Add</button>
        </div>
        {cv.experience.map((e, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Role" value={e.role || ""} onChange={(ev) => updExp(i, { role: ev.target.value })} />
              <input className="input" placeholder="Company" value={e.company || ""} onChange={(ev) => updExp(i, { company: ev.target.value })} />
              <input className="input" placeholder="Start (e.g. Jan 2022)" value={e.start || ""} onChange={(ev) => updExp(i, { start: ev.target.value })} />
              <input className="input" placeholder="End (e.g. Present)" value={e.end || ""} onChange={(ev) => updExp(i, { end: ev.target.value })} />
            </div>
            <label className="field-l" style={{ marginTop: 8 }}>Bullets (one per line)</label>
            <textarea className="input" rows={3} value={toLines(e.bullets)} onChange={(ev) => updExp(i, { bullets: fromLines(ev.target.value) })} />
            <button className="btn btn-danger btn-sm" onClick={() => set({ experience: cv.experience.filter((_, j) => j !== i) })}>Remove role</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Education
          <button className="btn btn-ghost btn-sm" onClick={() => set({ education: [...cv.education, { school: "" }] })}>+ Add</button>
        </div>
        {cv.education.map((ed, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="School" value={ed.school || ""} onChange={(ev) => updEdu(i, { school: ev.target.value })} />
              <input className="input" placeholder="Degree" value={ed.degree || ""} onChange={(ev) => updEdu(i, { degree: ev.target.value })} />
              <input className="input" placeholder="Field" value={ed.field || ""} onChange={(ev) => updEdu(i, { field: ev.target.value })} />
              <input className="input" placeholder="Dates" value={[ed.start, ed.end].filter(Boolean).join(" — ")} onChange={(ev) => { const [start, end] = ev.target.value.split("—").map((x) => x.trim()); updEdu(i, { start, end }); }} />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => set({ education: cv.education.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Projects
          <button className="btn btn-ghost btn-sm" onClick={() => set({ projects: [...(cv.projects || []), { name: "" }] })}>+ Add</button>
        </div>
        {(cv.projects || []).map((p, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Project name" value={p.name || ""} onChange={(ev) => updProj(i, { name: ev.target.value })} />
              <input className="input" placeholder="Link (URL)" value={p.link || ""} onChange={(ev) => updProj(i, { link: ev.target.value })} />
            </div>
            <label className="field-l" style={{ marginTop: 8 }}>Bullets (one per line)</label>
            <textarea className="input" rows={2} value={toLines(p.bullets)} onChange={(ev) => updProj(i, { bullets: fromLines(ev.target.value) })} />
            <button className="btn btn-danger btn-sm" onClick={() => set({ projects: (cv.projects || []).filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <label className="field-l">Certifications (one per line)</label>
        <textarea className="input" rows={2} value={toLines(cv.certifications)} onChange={(e) => set({ certifications: fromLines(e.target.value) })} />
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Languages
          <button className="btn btn-ghost btn-sm" onClick={() => addItem("languages", { name: "" })}>+ Add</button>
        </div>
        {languages.map((l, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Language" value={l.name || ""} onChange={(ev) => updItem("languages", i, { name: ev.target.value })} />
              <input className="input" placeholder="Level (e.g. Native, B2)" value={l.level || ""} onChange={(ev) => updItem("languages", i, { level: ev.target.value })} />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => delItem("languages", i)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Awards
          <button className="btn btn-ghost btn-sm" onClick={() => addItem("awards", { title: "" })}>+ Add</button>
        </div>
        {awards.map((a, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Award" value={a.title || ""} onChange={(ev) => updItem("awards", i, { title: ev.target.value })} />
              <input className="input" placeholder="Issuer" value={a.issuer || ""} onChange={(ev) => updItem("awards", i, { issuer: ev.target.value })} />
              <input className="input" placeholder="Year" value={a.year || ""} onChange={(ev) => updItem("awards", i, { year: ev.target.value })} />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => delItem("awards", i)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Publications
          <button className="btn btn-ghost btn-sm" onClick={() => addItem("publications", { title: "" })}>+ Add</button>
        </div>
        {publications.map((p, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Title" value={p.title || ""} onChange={(ev) => updItem("publications", i, { title: ev.target.value })} />
              <input className="input" placeholder="Venue (journal, conference)" value={p.venue || ""} onChange={(ev) => updItem("publications", i, { venue: ev.target.value })} />
              <input className="input" placeholder="Year" value={p.year || ""} onChange={(ev) => updItem("publications", i, { year: ev.target.value })} />
              <input className="input" placeholder="Link (URL)" value={p.link || ""} onChange={(ev) => updItem("publications", i, { link: ev.target.value })} />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => delItem("publications", i)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-sec">
        <div className="ed-sec-head">
          Volunteering
          <button className="btn btn-ghost btn-sm" onClick={() => addItem("volunteering", { org: "" })}>+ Add</button>
        </div>
        {volunteering.map((v, i) => (
          <div className="ed-card" key={i}>
            <div className="ed-grid">
              <input className="input" placeholder="Organisation" value={v.org || ""} onChange={(ev) => updItem("volunteering", i, { org: ev.target.value })} />
              <input className="input" placeholder="Role" value={v.role || ""} onChange={(ev) => updItem("volunteering", i, { role: ev.target.value })} />
              <input className="input" placeholder="Start" value={v.start || ""} onChange={(ev) => updItem("volunteering", i, { start: ev.target.value })} />
              <input className="input" placeholder="End" value={v.end || ""} onChange={(ev) => updItem("volunteering", i, { end: ev.target.value })} />
            </div>
            <label className="field-l" style={{ marginTop: 8 }}>Bullets (one per line)</label>
            <textarea className="input" rows={2} value={toLines(v.bullets)} onChange={(ev) => updItem("volunteering", i, { bullets: fromLines(ev.target.value) })} />
            <button className="btn btn-danger btn-sm" onClick={() => delItem("volunteering", i)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="ed-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={() => onSave(cv)} disabled={saving}>
          {saving ? <span className="spin" /> : "Save changes"}
        </button>
      </div>
    </div>
  );
}
