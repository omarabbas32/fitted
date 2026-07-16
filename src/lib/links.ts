/** Turn a raw link/email string into a valid href. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
  if (s.includes("@") && !s.includes("/") && !s.includes(" ")) {
    return "mailto:" + s;
  }
  return "https://" + s.replace(/^\/+/, "");
}

/** Short, human-friendly label for a link (strips protocol / www / trailing slash). */
export function linkLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^mailto:/i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** True if the string looks like a real URL/email rather than a bare label. */
export function isRealLink(raw: string): boolean {
  const s = raw.trim();
  return /^https?:\/\//i.test(s) || /^mailto:/i.test(s) || /[./@]/.test(s);
}

const KNOWN_HOSTS: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "github.com": "GitHub",
  "gitlab.com": "GitLab",
  "bitbucket.org": "Bitbucket",
  "twitter.com": "Twitter",
  "x.com": "X",
  "medium.com": "Medium",
  "dev.to": "Dev.to",
  "stackoverflow.com": "Stack Overflow",
  "behance.net": "Behance",
  "dribbble.com": "Dribbble",
  "youtube.com": "YouTube",
  "leetcode.com": "LeetCode",
  "hackerrank.com": "HackerRank",
  "kaggle.com": "Kaggle",
  "codepen.io": "CodePen",
};

/** Friendly, clickable display text for a link — "LinkedIn"/"GitHub" instead of
 *  a long URL, an email as-is, and a clean domain for personal/portfolio sites. */
export function linkDisplay(raw: string): string {
  const s = raw.trim();
  if (/^mailto:/i.test(s) || (s.includes("@") && !s.includes("/"))) {
    return s.replace(/^mailto:/i, "");
  }
  const host = s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
  for (const key in KNOWN_HOSTS) {
    if (host === key || host.endsWith("." + key) || host.includes(key)) {
      return KNOWN_HOSTS[key];
    }
  }
  return host; // e.g. "omarabbas.dev" for a personal site
}
