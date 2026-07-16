import type { StructuredCv } from "@/lib/cv-schema";
import { normalizeUrl, linkDisplay, isRealLink } from "@/lib/links";
import { fontStack } from "@/lib/fonts";

/** On-screen "paper" rendering of a structured CV (mirrors the PDF template). */
export function CvPaper({ cv }: { cv: StructuredCv }) {
  const c = cv.contact || {};
  const plain = [c.email, c.phone, c.location].filter(Boolean) as string[];
  const links = (c.links || []).filter(isRealLink);

  return (
    <div className="paper" style={{ fontFamily: fontStack(cv.fontFamily) }}>
      <div className="p-name">{cv.name || "Your Name"}</div>
      {cv.headline && <div className="p-role">{cv.headline}</div>}
      {(plain.length > 0 || links.length > 0) && (
        <div className="p-contacts">
          {plain.map((v, i) => (
            <span key={`p${i}`}>
              {i > 0 && "  ·  "}
              {v}
            </span>
          ))}
          {links.map((l, i) => (
            <span key={`l${i}`}>
              {(plain.length > 0 || i > 0) && "  ·  "}
              <a href={normalizeUrl(l)} target="_blank" rel="noopener noreferrer">
                {linkDisplay(l)}
              </a>
            </span>
          ))}
        </div>
      )}
      <hr />

      {cv.summary && (
        <>
          <h3>Summary</h3>
          <p className="p-sum">{cv.summary}</p>
        </>
      )}

      {cv.experience?.length > 0 && (
        <>
          <h3>Experience</h3>
          {cv.experience.map((e, i) => (
            <div className="p-exp" key={i}>
              <div className="p-top">
                <b>{e.role}</b>
                <span className="p-when">
                  {[e.start, e.end].filter(Boolean).join(" — ")}
                </span>
              </div>
              <div className="p-co">
                {e.company}
                {e.location ? ` · ${e.location}` : ""}
              </div>
              {e.bullets?.length > 0 && (
                <ul>
                  {e.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}

      {cv.skills?.length > 0 && (
        <>
          <h3>Skills</h3>
          <div className="p-skills-line">{cv.skills.join(" · ")}</div>
        </>
      )}

      {cv.projects && cv.projects.length > 0 && (
        <>
          <h3>Projects</h3>
          {cv.projects.map((p, i) => (
            <div className="p-exp" key={i}>
              <div className="p-top">
                <b>{p.name}</b>
                {p.link && (
                  <a
                    className="p-when"
                    href={normalizeUrl(p.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {linkDisplay(p.link)}
                  </a>
                )}
              </div>
              {p.description && <div className="p-det">{p.description}</div>}
              {p.bullets && p.bullets.length > 0 && (
                <ul>
                  {p.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}

      {cv.education?.length > 0 && (
        <>
          <h3>Education</h3>
          {cv.education.map((ed, i) => (
            <div className="p-exp" key={i}>
              <div className="p-top">
                <b>
                  {[ed.degree, ed.field].filter(Boolean).join(", ") || ed.school}
                </b>
                <span className="p-when">
                  {[ed.start, ed.end].filter(Boolean).join(" — ")}
                </span>
              </div>
              <div className="p-co">{ed.school}</div>
              {ed.details && <div className="p-det">{ed.details}</div>}
            </div>
          ))}
        </>
      )}

      {cv.certifications && cv.certifications.length > 0 && (
        <>
          <h3>Certifications</h3>
          <ul>
            {cv.certifications.map((ct, i) => (
              <li key={i} style={{ fontSize: "11.5px", color: "#333" }}>
                {ct}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
