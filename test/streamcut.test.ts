import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSplitter, isCodeBlock, split, SplitStream, splitText, type SplitOptions } from "../dist/index.js";

/** Feeds `text` in pieces of the given sizes (cycling) and collects every segment. */
function streamed(text: string, sizes: number[], options?: SplitOptions): string[] {
  const s = createSplitter(options);
  const out: string[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const size = sizes[n++ % sizes.length]!;
    out.push(...s.push(text.slice(i, i + size)));
    i += size;
  }
  out.push(...s.flush());
  return out;
}

/** Asserts the result is the same whether the text arrives at once, char by char, or in odd chunks. */
function check(text: string, expected: string[], options?: SplitOptions): void {
  assert.deepEqual(splitText(text, options), expected, "whole string");
  assert.deepEqual(streamed(text, [1], options), expected, "char by char");
  assert.deepEqual(streamed(text, [3, 1, 7, 2], options), expected, "odd chunks");
  assert.deepEqual(streamed(text, [16, 5], options), expected, "bigger chunks");
}

describe("sentence mode", () => {
  it("splits plain sentences", () => {
    check("Hello there. How are you? I'm great! Thanks.", [
      "Hello there.",
      "How are you?",
      "I'm great!",
      "Thanks.",
    ]);
  });

  it("emits a sentence as soon as the next one starts", () => {
    const s = createSplitter();
    assert.deepEqual(s.push("Hello there."), []);
    assert.deepEqual(s.push(" H"), ["Hello there."]);
    assert.deepEqual(s.push("ow are you"), []);
    assert.deepEqual(s.flush(), ["How are you"]);
  });

  it("does not split on abbreviations, initials, decimals or URLs", () => {
    check("Dr. Smith met Mr. J. R. Tolkien at 3.14 p.m. on example.com today. Then e.g. lunch.", [
      "Dr. Smith met Mr. J. R. Tolkien at 3.14 p.m. on example.com today.",
      "Then e.g. lunch.",
    ]);
  });

  it("does not split when the next word is lowercase", () => {
    check("It costs approx. five dollars... or less. Okay.", ["It costs approx. five dollars... or less.", "Okay."]);
  });

  it("accepts custom abbreviations", () => {
    check("See Abb. Two for details. Done.", ["See Abb.", "Two for details.", "Done."]);
    check("See Abb. Two for details. Done.", ["See Abb. Two for details.", "Done."], { abbreviations: ["abb"] });
  });

  it("keeps closing quotes, brackets and emphasis with the sentence", () => {
    check('She said "stop." Then (quietly.) **Done.** Next?!', [
      'She said "stop."',
      "Then (quietly.)",
      "**Done.**",
      "Next?!",
    ]);
  });

  it("splits Chinese and Japanese text without spaces", () => {
    check("你好。今天天气很好！「本当？」はい。", ["你好。", "今天天气很好！", "「本当？」", "はい。"]);
  });

  it("splits on blank lines, headings and list items", () => {
    check("# Title\nIntro text\n\nSecond paragraph\n- one\n- two\n1. first\n2. second", [
      "# Title",
      "Intro text",
      "Second paragraph",
      "- one",
      "- two",
      "1. first",
      "2. second",
    ]);
  });

  it("joins soft-wrapped lines of one sentence", () => {
    check("This sentence is\nwrapped over lines. Next one.", ["This sentence is\nwrapped over lines.", "Next one."]);
  });

  it("keeps fenced code blocks whole", () => {
    const code = "```js\nconst a = 1. b = 2;\n\nconsole.log(a);\n```";
    check(`Run this. ${"\n"}${code}\nIt prints 1. Done.`, ["Run this.", code, "It prints 1.", "Done."]);
    check("Before.\n~~~~\n``` not a close\n~~~~\nAfter.", ["Before.", "~~~~\n``` not a close\n~~~~", "After."]);
  });

  it("emits an unclosed code block on flush", () => {
    check("Look:\n```py\nprint(1)", ["Look:", "```py\nprint(1)"]);
  });

  it("can split inside code blocks when preserveCode is false", () => {
    assert.deepEqual(splitText("```\nOne. Two.\n```", { preserveCode: false }), ["```\nOne.", "Two.", "```"]);
  });

  it("merges short sentences with minLength", () => {
    check("Hi. Yes. This one is long enough. Ok.", ["Hi. Yes. This one is long enough.", "Ok."], { minLength: 12 });
  });

  it("forces a split with maxLength", () => {
    const out = splitText("one two three four five six seven eight nine ten", { maxLength: 15 });
    assert.ok(out.length > 1);
    assert.ok(out.every((s) => s.length <= 15), JSON.stringify(out));
    assert.equal(out.join(" "), "one two three four five six seven eight nine ten");
  });

  it("handles CRLF line endings", () => {
    check("First line\r\n\r\nSecond. Third.", ["First line", "Second.", "Third."]);
  });

  it("ignores empty input and whitespace", () => {
    check("", []);
    check("   \n\n  ", []);
  });

  it("is reusable after flush", () => {
    const s = createSplitter();
    assert.deepEqual([...s.push("One. Tw"), ...s.flush()], ["One.", "Tw"]);
    assert.deepEqual([...s.push("Three. Four."), ...s.flush()], ["Three.", "Four."]);
  });
});

describe("block mode", () => {
  const md = [
    "# Heading",
    "Paragraph line one.",
    "Line two.",
    "",
    "- item 1",
    "- item 2",
    "",
    "```ts",
    "const x = 1;",
    "",
    "const y = 2;",
    "```",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "Setext",
    "======",
    "***",
    "> quote",
  ].join("\n");

  it("splits Markdown into blocks", () => {
    check(
      md,
      [
        "# Heading",
        "Paragraph line one.\nLine two.",
        "- item 1\n- item 2",
        "```ts\nconst x = 1;\n\nconst y = 2;\n```",
        "| a | b |\n|---|---|\n| 1 | 2 |",
        "Setext\n======",
        "***",
        "> quote",
      ],
      { mode: "block" },
    );
  });

  it("emits a block when a blank line arrives", () => {
    const s = createSplitter({ mode: "block" });
    assert.deepEqual(s.push("Para one.\n"), []);
    assert.deepEqual(s.push("\nPara"), ["Para one."]);
    assert.deepEqual(s.flush(), ["Para"]);
  });
});

describe("split()", () => {
  it("works on async iterables of strings and bytes", async () => {
    async function* tokens() {
      for (const t of ["Hel", "lo. Wor", "ld! ", "Bye"]) yield t;
    }
    const out: string[] = [];
    for await (const s of split(tokens())) out.push(s);
    assert.deepEqual(out, ["Hello.", "World!", "Bye"]);

    // A multi-byte character cut in half between chunks.
    const bytes = new TextEncoder().encode("Café. Ok.");
    const parts = [bytes.slice(0, 4), bytes.slice(4)];
    const out2: string[] = [];
    for await (const s of split(parts)) out2.push(s);
    assert.deepEqual(out2, ["Café.", "Ok."]);
  });

  it("works on ReadableStreams and through SplitStream", async () => {
    const stream = () =>
      new ReadableStream<string>({
        start(c) {
          for (const t of ["A one. ", "A two", ". A three"]) c.enqueue(t);
          c.close();
        },
      });
    const out: string[] = [];
    for await (const s of split(stream())) out.push(s);
    assert.deepEqual(out, ["A one.", "A two.", "A three"]);

    const piped: string[] = [];
    for await (const s of stream().pipeThrough(new SplitStream())) piped.push(s);
    assert.deepEqual(piped, out);
  });
});

describe("isCodeBlock()", () => {
  it("detects fenced code blocks", () => {
    assert.equal(isCodeBlock("```js\nx\n```"), true);
    assert.equal(isCodeBlock("~~~\nx"), true);
    assert.equal(isCodeBlock("Hello."), false);
  });
});

describe("chunking never changes the result", () => {
  const doc = [
    "# Release notes",
    "We shipped v2.1.0 today. It's faster, e.g. 3.5x on cold starts! Dr. Lee wrote most of it.",
    "",
    "## Changes",
    "- New `split()` helper. It's async.",
    "- Fixed a bug... finally.",
    "  1. nested item",
    "",
    "```bash",
    "npm i streamcut. # not a sentence",
    "```",
    "",
    "| col | val |",
    "|-----|-----|",
    "| a.  | 1   |",
    "",
    "中文句子。另一个句子！English again? Yes.",
    "> Quoted text. More quote.",
    "Last line without a period",
  ].join("\n");

  for (const mode of ["sentence", "block"] as const) {
    it(`in ${mode} mode`, () => {
      const expected = splitText(doc, { mode });
      let seed = 42;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      for (let run = 0; run < 200; run++) {
        const sizes = Array.from({ length: 8 }, () => 1 + Math.floor(random() * 12));
        assert.deepEqual(streamed(doc, sizes, { mode }), expected, `sizes ${sizes.join(",")}`);
      }
    });
  }
});
