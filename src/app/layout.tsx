import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fitted — your CV, cut for the job",
  description:
    "Tailor your CV to a job description with AI, see the honest gap between you and the role, and export a clean ATS-friendly PDF.",
};

/**
 * Stamps <html data-theme> before first paint so the saved theme never flashes
 * through the default one. Runs blocking and ahead of hydration by design —
 * which is why <html> carries suppressHydrationWarning below.
 */
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('fitted.theme');
    if (t !== 'light' && t !== 'dark') {
      t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
