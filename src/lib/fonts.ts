// CV font choices. All are safe system fonts available to both the browser
// preview and headless Chromium (PDF export) on Windows/macOS.

export type FontOption = { id: string; label: string; stack: string };

export const FONTS: FontOption[] = [
  { id: "Georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  { id: "Times New Roman", label: "Times New Roman (serif)", stack: '"Times New Roman", Times, serif' },
  { id: "Cambria", label: "Cambria (serif)", stack: "Cambria, Georgia, serif" },
  { id: "Garamond", label: "Garamond (serif)", stack: 'Garamond, "EB Garamond", Georgia, serif' },
  { id: "Calibri", label: "Calibri (sans)", stack: 'Calibri, "Segoe UI", Arial, sans-serif' },
  { id: "Arial", label: "Arial (sans)", stack: "Arial, Helvetica, sans-serif" },
  { id: "Helvetica", label: "Helvetica (sans)", stack: "Helvetica, Arial, sans-serif" },
  { id: "Segoe UI", label: "Segoe UI (sans)", stack: '"Segoe UI", Roboto, Arial, sans-serif' },
  { id: "Verdana", label: "Verdana (sans)", stack: "Verdana, Geneva, sans-serif" },
  { id: "Trebuchet MS", label: "Trebuchet MS (sans)", stack: '"Trebuchet MS", Tahoma, sans-serif' },
];

export const DEFAULT_FONT = "Georgia";

export const FONT_IDS = FONTS.map((f) => f.id);

/** Resolve a font id to a full CSS font stack (falls back to the default). */
export function fontStack(id?: string): string {
  const f = FONTS.find((x) => x.id === id) ?? FONTS[0];
  return f.stack;
}
