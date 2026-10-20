/** A Markdown code fence opener: up to 3 spaces, then 3+ backticks or tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Returns the fence marker (like "```" or "~~~~") when `line` opens a code block. */
export function fenceOpen(line: string): string | undefined {
  const m = FENCE_OPEN.exec(line);
  if (!m) return undefined;
  const marker = m[1]!;
  // A backtick fence's info string can't contain backticks.
  if (marker[0] === "`" && line.slice(m[0].length).includes("`")) return undefined;
  return marker;
}

/** True when `line` closes a code block opened with `marker`. */
export function fenceCloses(line: string, marker: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1]![0] === marker[0] && m[1]!.length >= marker.length;
}

/**
 * True while `partial` (the start of a line that hasn't ended yet) could still
 * turn out to be a fence opener, so callers know to wait for more text.
 */
export function mayBeFence(partial: string): boolean {
  const m = /^ {0,3}(`*|~*)$/.exec(partial);
  return !!m && partial.length > 0;
}

/** True when a segment is a fenced code block. */
export function isCodeBlock(segment: string): boolean {
  return fenceOpen(segment.split("\n", 1)[0]!) !== undefined;
}
