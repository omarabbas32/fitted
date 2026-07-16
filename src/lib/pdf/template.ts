import { StructuredCv } from "../cv-schema";
import { normalizeUrl, linkDisplay, isRealLink } from "../links";
import { fontStack } from "../fonts";

function esc(s?: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function link(raw: string): string {
  return `<a href="${esc(normalizeUrl(raw))}">${esc(linkDisplay(raw))}</a>`;
}

/** Render a structured CV to a full, self-contained HTML document (used for PDF export). */
export function cvToHtml(cv: StructuredCv): string {
  const contact = cv.contact || {};
  const contactLine = [
    ...[contact.email, contact.phone, contact.location].filter(Boolean).map(esc),
    ...(contact.links || []).filter(isRealLink).map(link),
  ].join("  ·  ");

  const experience = (cv.experience || [])
    .map(
      (e) => `
      <div class="exp">
        <div class="top"><b>${esc(e.role)}</b><span class="when">${esc(
          [e.start, e.end].filter(Boolean).join(" — ")
        )}</span></div>
        <div class="co">${esc(e.company)}${
          e.location ? ` · ${esc(e.location)}` : ""
        }</div>
        <ul>${(e.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");

  const education = (cv.education || [])
    .map(
      (ed) => `
      <div class="exp">
        <div class="top"><b>${esc(
          [ed.degree, ed.field].filter(Boolean).join(", ") || ed.school
        )}</b><span class="when">${esc(
          [ed.start, ed.end].filter(Boolean).join(" — ")
        )}</span></div>
        <div class="co">${esc(ed.school)}</div>
        ${ed.details ? `<div class="edu-det">${esc(ed.details)}</div>` : ""}
      </div>`
    )
    .join("");

  const skills = (cv.skills || []).map(esc).join(" · ");

  const projects = (cv.projects || [])
    .map(
      (p) => `
      <div class="exp">
        <div class="top"><b>${esc(p.name)}</b>${
          p.link ? `<span class="when">${link(p.link)}</span>` : ""
        }</div>
        ${p.description ? `<div class="edu-det">${esc(p.description)}</div>` : ""}
        ${
          p.bullets && p.bullets.length
            ? `<ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
            : ""
        }
      </div>`
    )
    .join("");

  const certs = (cv.certifications || [])
    .map((c) => `<li>${esc(c)}</li>`)
    .join("");

  const section = (title: string, body: string) =>
    body.trim() ? `<h3>${title}</h3>${body}` : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: ${fontStack(cv.fontFamily)}; color: #000; font-size: 11pt; line-height: 1.45; margin: 0; }
  .name { font-size: 21pt; font-weight: 700; letter-spacing: -.2px; }
  .role { color: #000; font-weight: 600; font-size: 10.5pt; margin-top: 2px; }
  .contacts { font-size: 8.5pt; color: #000; margin-top: 5px; }
  a { color: #000; text-decoration: underline; }
  hr { border: none; border-top: 1px solid #000; margin: 11px 0; }
  h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: 1px; color: #000; margin: 14px 0 6px; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 2px; }
  p.sum { font-size: 10pt; color: #000; margin: 0; }
  .exp { margin-bottom: 9px; page-break-inside: avoid; }
  .exp .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .exp .top b { font-size: 10.5pt; }
  .exp .top .when { font-size: 8pt; color: #000; white-space: nowrap; }
  .exp .co { font-size: 9.5pt; color: #000; font-weight: 600; font-style: italic; margin-bottom: 3px; }
  .exp .edu-det { font-size: 9.5pt; color: #000; }
  .exp ul { margin: 0; padding-left: 16px; }
  .exp li { font-size: 9.5pt; color: #000; margin-bottom: 2px; }
  .skills-line { font-size: 9.5pt; color: #000; line-height: 1.55; }
  ul.certs { margin: 0; padding-left: 16px; }
  ul.certs li { font-size: 9.5pt; margin-bottom: 2px; }
</style></head>
<body>
  <div class="name">${esc(cv.name)}</div>
  ${cv.headline ? `<div class="role">${esc(cv.headline)}</div>` : ""}
  ${contactLine ? `<div class="contacts">${contactLine}</div>` : ""}
  <hr>
  ${cv.summary ? `<h3>Summary</h3><p class="sum">${esc(cv.summary)}</p>` : ""}
  ${section("Experience", experience)}
  ${section("Skills", skills ? `<div class="skills-line">${skills}</div>` : "")}
  ${section("Projects", projects)}
  ${section("Education", education)}
  ${section("Certifications", certs ? `<ul class="certs">${certs}</ul>` : "")}
</body></html>`;
}
