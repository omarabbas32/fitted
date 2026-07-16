import { extractText, getDocumentProxy } from "unpdf";

/** Extract plain text from a PDF, plus any hyperlink URLs stored as link
 *  annotations (LinkedIn/GitHub/portfolio links are annotations, not text). */
export async function extractPdfText(
  buffer: ArrayBuffer | Uint8Array
): Promise<string> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);

  const { text } = await extractText(pdf, { mergePages: true });
  const base = (Array.isArray(text) ? text.join("\n") : text).trim();

  const urls = new Set<string>();
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const annotations = await page.getAnnotations();
      for (const a of annotations as Array<{ url?: string; unsafeUrl?: string }>) {
        const url = a?.url || a?.unsafeUrl;
        if (url && /^https?:|^mailto:/i.test(url)) urls.add(url);
      }
    } catch {
      // annotation extraction is best-effort
    }
  }

  if (urls.size > 0) {
    return `${base}\n\nHYPERLINKS FOUND IN THE DOCUMENT (associate each with the right label/section):\n${[
      ...urls,
    ].join("\n")}`;
  }
  return base;
}
