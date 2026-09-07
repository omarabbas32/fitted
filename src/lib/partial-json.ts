// Reading a JSON document that is still being written.
//
// The model streams one large JSON object; the UI wants to render the CV while
// it arrives rather than sit on a spinner. Any prefix of that stream is invalid
// JSON, so this closes whatever is still open — an unterminated string, nested
// objects and arrays — and parses the result. If the tail is mid-token
// ("matchScore": tru), it chops characters off the end until what remains does
// parse. That costs a few iterations in practice, because only the last token
// is ever broken.

type Scan = { inString: boolean; danglingEscape: boolean; closers: string[] };

function scan(text: string): Scan {
  let inString = false;
  let escaped = false;
  const closers: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }

  return { inString, danglingEscape: inString && escaped, closers };
}

/** Close every structure the text left open, without otherwise altering it. */
function close(text: string): string {
  const { inString, danglingEscape, closers } = scan(text);
  let out = danglingEscape ? text.slice(0, -1) : text;
  if (inString) out += '"';
  for (let i = closers.length - 1; i >= 0; i--) out += closers[i];
  return out;
}

/** How many characters we are willing to discard from the tail. Only the token
 *  being written can be broken, so this is generous; the guard exists so
 *  malformed output can't turn into a long backtracking loop. */
const MAX_CHOP = 400;

/** Parse the longest valid prefix of a (possibly truncated) JSON object.
 *  Returns null when there isn't a parseable object yet. */
export function parsePartialJson<T>(raw: string): T | null {
  let text = raw.trim();

  // Same fence handling as the completed-response parser: some models open
  // with ```json before the object starts.
  const fence = text.indexOf("```");
  if (fence !== -1) {
    text = text.slice(fence).replace(/^```(?:json)?/i, "");
    const end = text.indexOf("```");
    if (end !== -1) text = text.slice(0, end);
  }

  const start = text.indexOf("{");
  if (start === -1) return null;
  text = text.slice(start).trimEnd();

  for (let chop = 0; chop < MAX_CHOP && text.length > 1; chop++) {
    try {
      return JSON.parse(close(text)) as T;
    } catch {
      text = text.slice(0, -1).trimEnd();
    }
  }
  return null;
}
