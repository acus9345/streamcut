import { fenceCloses, fenceOpen } from "./fence.js";

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Splits streamed Markdown into blocks (paragraphs, headings, lists, tables,
 * quotes, code blocks), emitting each one once it can no longer change.
 */
export class BlockSegmenter {
  #buf = "";
  #lines: string[] = [];
  #fence: string | undefined;
  #out: string[] = [];

  push(chunk: string): string[] {
    this.#out = [];
    this.#buf += chunk;
    let nl: number;
    while ((nl = this.#buf.indexOf("\n")) !== -1) {
      this.#line(this.#buf.slice(0, nl).replace(/\r$/, ""));
      this.#buf = this.#buf.slice(nl + 1);
    }
    return this.#out;
  }

  flush(): string[] {
    this.#out = [];
    if (this.#buf) this.#line(this.#buf.replace(/\r$/, ""));
    this.#emit();
    this.reset();
    return this.#out;
  }

  reset(): void {
    this.#buf = "";
    this.#lines = [];
    this.#fence = undefined;
  }

  #emit(): void {
    const text = this.#lines.join("\n").trimEnd();
    this.#lines = [];
    if (text.trim()) this.#out.push(text);
  }

  #line(line: string): void {
    if (this.#fence) {
      this.#lines.push(line);
      if (fenceCloses(line, this.#fence)) {
        this.#fence = undefined;
        this.#emit();
      }
      return;
    }
    const marker = fenceOpen(line);
    if (marker) {
      this.#emit();
      this.#fence = marker;
      this.#lines.push(line);
      return;
    }
    if (!line.trim()) {
      this.#emit();
      return;
    }
    if (HEADING.test(line)) {
      this.#emit();
      this.#lines.push(line);
      this.#emit();
      return;
    }
    if (this.#lines.length > 0 && SETEXT_UNDERLINE.test(line)) {
      this.#lines.push(line);
      this.#emit();
      return;
    }
    if (THEMATIC_BREAK.test(line)) {
      this.#emit();
      this.#lines.push(line);
      this.#emit();
      return;
    }
    this.#lines.push(line);
  }
}
