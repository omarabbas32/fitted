import puppeteer from "puppeteer";
import { StructuredCv } from "../cv-schema";
import { cvToHtml } from "./template";

/** Render a structured CV to a PDF buffer via headless Chromium. */
export async function renderCvPdf(cv: StructuredCv): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(cvToHtml(cv), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
