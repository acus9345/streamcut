import { fenceCloses, fenceOpen, mayBeFence } from "./fence.js";

export interface SentenceOptions {
  /**
   * Extra abbreviations that don't end a sentence, without the trailing dot
   * (case-insensitive), like `["approx", "Corp"]`. Added to the built-in list.
   */
  abbreviations?: Iterable<string>;
  /** Emit fenced code blocks whole instead of splitting them into sentences. Default `true`. */
  preserveCode?: boolean;
  /**
   * Merge sentences shorter than this many characters into the next one, so
   * text-to-speech doesn't get "Hi." on its own. Default `0` (off).
   */
  minLength?: number;
  /**
   * Force a split (at the last space) once a sentence reaches this many
   * characters, so one run-on sentence can't stall the stream. Default off.
   */
  maxLength?: number;
}

/** Abbreviations that are almost never the end of a sentence. */
export const DEFAULT_ABBREVIATIONS: readonly string[] = [
  "mr", "mrs", "ms", "mx", "dr", "prof", "sr", "jr", "st", "mt", "rev", "hon",
  "gen", "col", "lt", "sgt", "capt", "cmdr", "gov", "sen", "rep", "pres",
  "vs", "fig", "figs", "no", "nos", "vol", "vols", "pp", "ch", "sec", "eq",
  "approx", "dept", "est", "inc", "ltd", "co", "corp", "cf", "al", "ca",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
];

const TERMINATORS = ".!?…‽";
const CJK_TERMINATORS = "。！？｡";
const CLOSERS = "\"')]}”’»」』）】*_`";
const OPENERS = "([{\"'“‘«「『（【*_`";
/** Lines that start a new Markdown block (list item, heading, quote, table row). */
const BLOCK_START = /^ {0,3}(?:[-*+] |\d{1,9}[.)] |#{1,6}(?: |$)|>|\|)/;

function isSpace(c: string | undefined): boolean {
  return c !== undefined && (c === " " || c === "\n" || c === "\t" || c === "\r" || /\s/.test(c));
}

/** Splits streamed text into sentences as soon as each one is complete. */
export class SentenceSegmenter {
  readonly #abbreviations: Set<string>;
  readonly #preserveCode: boolean;
  readonly #minLength: number;
  readonly #maxLength: number;

  #buf = "";
  /** Where scanning resumes. */
  #pos = 0;
  /** Where the current sentence starts. */
  #start = 0;
  /** Whether index 0 of the buffer is at the start of a line. */
  #lineStart0 = true;
  /** Set while inside a code fence: its marker and where to keep looking for the close. */
  #fence: { marker: string; scan: number } | undefined;
  /** A sentence held back by `minLength`. */
  #pending = "";
  #out: string[] = [];

  constructor(options: SentenceOptions = {}) {
    this.#abbreviations = new Set(DEFAULT_ABBREVIATIONS);
    for (const a of options.abbreviations ?? []) this.#abbreviations.add(a.toLowerCase().replace(/\.$/, ""));
    this.#preserveCode = options.preserveCode ?? true;
    this.#minLength = options.minLength ?? 0;
    this.#maxLength = options.maxLength ?? 0;
  }

  push(chunk: string): string[] {
    this.#buf += chunk;
    return this.#scan(false);
  }

  flush(): string[] {
    const out = this.#scan(true);
    if (this.#pending) out.push(this.#pending);
    this.reset();
    return out;
  }

  reset(): void {
    this.#buf = "";
    this.#pos = this.#start = 0;
    this.#lineStart0 = true;
    this.#fence = undefined;
    this.#pending = "";
  }

  #emit(text: string, code = false): void {
    if (code) {
      const t = text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
      if (!t) return;
      if (this.#pending) this.#out.push(this.#pending);
      this.#pending = "";
      this.#out.push(t);
      return;
    }
    const t = text.trim();
    if (!t) return;
    const merged = this.#pending ? `${this.#pending} ${t}` : t;
    if (merged.length < this.#minLength) {
      this.#pending = merged;
      return;
    }
    this.#pending = "";
    this.#out.push(merged);
  }

  #isLineStart(i: number): boolean {
    return i === 0 ? this.#lineStart0 : this.#buf[i - 1] === "\n";
  }

  /** True when the `.` at `i` follows an abbreviation, an initial or a list number. */
  #isAbbreviation(i: number): boolean {
    const buf = this.#buf;
    let k = i;
    while (k > this.#start && !isSpace(buf[k - 1]) && !OPENERS.includes(buf[k - 1]!)) k--;
    const word = buf.slice(k, i);
    if (!word) return false;
    if (this.#abbreviations.has(word.toLowerCase())) return true;
    // An initial ("J. R. R. Tolkien") or a dotted acronym ("e.g.", "U.S.").
    if (/^\p{Lu}$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) return true;
    // An ordered list marker: "1." at the start of a line.
    if (/^\d+$/.test(word)) {
      let m = k;
      while (m > 0 && (buf[m - 1] === " " || buf[m - 1] === "\t")) m--;
      return this.#isLineStart(m);
    }
    return false;
  }

  /** Looks for the end of the open code fence. Returns the index after the closing line, or -1. */
  #findFenceClose(final: boolean): number {
    const fence = this.#fence!;
    const buf = this.#buf;
    let p = fence.scan;
    while (p < buf.length) {
      const e = buf.indexOf("\n", p);
      if (e === -1) {
        if (final && fenceCloses(buf.slice(p), fence.marker)) return buf.length;
        break;
      }
      if (fenceCloses(buf.slice(p, e).replace(/\r$/, ""), fence.marker)) return e;
      p = e + 1;
    }
    fence.scan = p;
    return -1;
  }

  #scan(final: boolean): string[] {
    this.#out = [];
    const buf = this.#buf;
    const len = buf.length;
    let i = this.#pos;

    scan: while (true) {
      if (this.#fence) {
        const end = this.#findFenceClose(final);
        if (end === -1) {
          if (!final) break;
          this.#emit(buf.slice(this.#start), true);
          this.#start = i = len;
          this.#fence = undefined;
          break;
        }
        this.#emit(buf.slice(this.#start, end), true);
        this.#start = i = end;
        this.#fence = undefined;
        continue;
      }
      if (i >= len) break;

      if (this.#maxLength > 0 && i - this.#start >= this.#maxLength) {
        let cut = i;
        for (let k = i; k > this.#start; k--) {
          if (isSpace(buf[k])) {
            cut = k;
            break;
          }
        }
        this.#emit(buf.slice(this.#start, cut));
        this.#start = cut;
      }

      if (this.#preserveCode && this.#isLineStart(i)) {
        const lineEnd = buf.indexOf("\n", i);
        const line = (lineEnd === -1 ? buf.slice(i) : buf.slice(i, lineEnd)).replace(/\r$/, "");
        const marker = fenceOpen(line);
        if (lineEnd === -1 && !final && (marker || mayBeFence(line))) break;
        if (marker) {
          this.#emit(buf.slice(this.#start, i));
          this.#start = i;
          this.#fence = { marker, scan: lineEnd === -1 ? len : lineEnd + 1 };
          continue;
        }
      }

      const ch = buf[i]!;

      if (TERMINATORS.includes(ch)) {
        let j = i + 1;
        while (j < len && TERMINATORS.includes(buf[j]!)) j++;
        const run = buf.slice(i, j);
        while (j < len && CLOSERS.includes(buf[j]!)) j++;
        if (j >= len && !final) break;
        if (j < len && !isSpace(buf[j])) {
          i = j;
          continue;
        }
        let k = j;
        while (k < len && isSpace(buf[k])) k++;
        if (k >= len && !final) break;
        const newline = buf.slice(j, k).includes("\n");
        if (!newline && k < len) {
          if (run === "." && this.#isAbbreviation(i)) {
            i = j;
            continue;
          }
          // "e.g. something" or "... and then": a lowercase word rarely starts a sentence.
          if (!/[!?‽]/.test(run) && /\p{Ll}/u.test(buf[k]!)) {
            i = j;
            continue;
          }
        }
        this.#emit(buf.slice(this.#start, j));
        this.#start = i = j;
        continue;
      }

      if (CJK_TERMINATORS.includes(ch)) {
        let j = i + 1;
        while (j < len && (CJK_TERMINATORS.includes(buf[j]!) || CLOSERS.includes(buf[j]!))) j++;
        if (j >= len && !final) break;
        this.#emit(buf.slice(this.#start, j));
        this.#start = i = j;
        continue;
      }

      if (ch === "\n") {
        let k = i + 1;
        while (k < len && (buf[k] === " " || buf[k] === "\t" || buf[k] === "\r")) k++;
        if (k >= len) {
          if (!final) break;
          i++;
          continue;
        }
        const next = buf.slice(k, k + 12);
        const current = buf.slice(this.#start, i).trimStart();
        if (buf[k] === "\n" || BLOCK_START.test(current) || BLOCK_START.test(next)) {
          this.#emit(buf.slice(this.#start, i));
          this.#start = i;
          i = k;
          continue scan;
        }
        // Too little of the next line to tell whether it starts a list item.
        if (!final && next.length < 4 && !next.includes("\n")) break;
      }

      i++;
    }

    if (final && this.#start < len) {
      this.#emit(buf.slice(this.#start));
      this.#start = i = len;
    }

    // Drop text that has already been emitted.
    const start = this.#start;
    if (start > 0) {
      this.#lineStart0 = buf[start - 1] === "\n";
      this.#buf = buf.slice(start);
      if (this.#fence) this.#fence.scan -= start;
      i -= start;
      this.#start = 0;
    }
    this.#pos = i;
    return this.#out;
  }
}
