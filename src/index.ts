import { BlockSegmenter } from "./block.js";
import { SentenceSegmenter, type SentenceOptions } from "./sentence.js";

export { BlockSegmenter } from "./block.js";
export { isCodeBlock } from "./fence.js";
export { DEFAULT_ABBREVIATIONS, SentenceSegmenter, type SentenceOptions } from "./sentence.js";

/** `"sentence"` emits sentences, `"block"` emits whole Markdown blocks (paragraphs, lists, code blocks...). */
export type SplitMode = "sentence" | "block";

export interface SplitOptions extends SentenceOptions {
  /** What to emit. Default `"sentence"`. */
  mode?: SplitMode;
}

/** Feed it chunks with `push()`, get back every segment that is complete so far. */
export interface Splitter {
  /** Adds a chunk and returns the segments it completed (often none). */
  push(chunk: string): string[];
  /** Ends the stream and returns whatever is left. The splitter can be reused afterwards. */
  flush(): string[];
  /** Drops buffered text without emitting it. */
  reset(): void;
}

/** Creates a stateful splitter for text that arrives in pieces. */
export function createSplitter(options: SplitOptions = {}): Splitter {
  return options.mode === "block" ? new BlockSegmenter() : new SentenceSegmenter(options);
}

/** Splits a complete string. */
export function splitText(text: string, options: SplitOptions = {}): string[] {
  const s = createSplitter(options);
  return [...s.push(text), ...s.flush()];
}

/** Anything that produces text chunks: an async iterable, an iterable, or a ReadableStream of strings or bytes. */
export type TextSource =
  | AsyncIterable<string | Uint8Array>
  | Iterable<string | Uint8Array>
  | ReadableStream<string | Uint8Array>;

async function* chunks(source: TextSource): AsyncGenerator<string | Uint8Array> {
  if (Symbol.asyncIterator in source || Symbol.iterator in source) {
    yield* source as AsyncIterable<string | Uint8Array>;
    return;
  }
  // ReadableStream without async iteration (older Safari).
  const reader = (source as ReadableStream<string | Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Turns a stream of text chunks (like LLM tokens) into a stream of sentences
 * or Markdown blocks, yielding each one as soon as it is complete.
 *
 * ```ts
 * for await (const sentence of split(tokens)) speak(sentence);
 * ```
 */
export async function* split(source: TextSource, options: SplitOptions = {}): AsyncGenerator<string> {
  const splitter = createSplitter(options);
  const decoder = new TextDecoder();
  for await (const chunk of chunks(source)) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    yield* splitter.push(text);
  }
  const rest = decoder.decode();
  if (rest) yield* splitter.push(rest);
  yield* splitter.flush();
}

/**
 * A `TransformStream` from text chunks to sentences or blocks, for
 * `response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new SplitStream())`.
 */
export class SplitStream extends TransformStream<string, string> {
  constructor(options: SplitOptions = {}) {
    const splitter = createSplitter(options);
    super({
      transform(chunk, controller) {
        for (const s of splitter.push(chunk)) controller.enqueue(s);
      },
      flush(controller) {
        for (const s of splitter.flush()) controller.enqueue(s);
      },
    });
  }
}
