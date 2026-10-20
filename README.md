# streamcut

Split streaming LLM output into **sentences** or **Markdown blocks** the moment each one is complete. Made for text-to-speech, live translation, chat UIs that render block by block, and anything else that can't wait for the full response. Zero dependencies.

[![npm](https://img.shields.io/npm/v/streamcut)](https://www.npmjs.com/package/streamcut)
[![CI](https://github.com/acus9345/streamcut/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/streamcut/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlejs/size/streamcut)](https://bundlejs.com/?q=streamcut)
[![license](https://img.shields.io/npm/l/streamcut)](LICENSE)

```ts
import { split } from "streamcut";

for await (const sentence of split(llmTokens)) {
  speak(sentence); // starts talking after the first sentence, not the whole answer
}
```

```text
tokens:    "Dr. Sm" "ith ran" " 3.5 km" ". Then" " she …"
streamcut:                            ↳ "Dr. Smith ran 3.5 km."
```

## Why

Splitting on `". "` falls apart on real model output:

| Input | `text.split(". ")` | streamcut |
| --- | --- | --- |
| `Dr. Smith arrived.` | `Dr` · `Smith arrived.` | `Dr. Smith arrived.` |
| `It costs 3.5x more, e.g. on cold starts.` | splits on `e.g.` | one sentence |
| `` ```js `` code with `a = 1. b = 2` `` ``` `` | cuts the code in half | code block kept whole |
| `1. Install\n2. Run` | `1` · `Install…` | `1. Install` · `2. Run` |
| `你好。今天很好！` | not split | `你好。` · `今天很好！` |
| A token stream | needs the full text | emits as soon as a sentence ends |

- **Streaming first:** push chunks of any size; the output is identical whether text arrives one character at a time or all at once (tested with hundreds of random chunkings).
- **Knows Markdown:** code fences stay whole, headings, list items, quotes and table rows become their own segments, and closing `"`, `)` and `**` stay with their sentence.
- **Doesn't split on** abbreviations (`Dr.`, `Mr.`, `vs.`, `approx.`), initials (`J. R. R.`), dotted acronyms (`e.g.`, `U.S.`), decimals, versions, URLs, list numbers, or a period followed by a lowercase word.
- **CJK aware:** `。！？` end sentences without a following space.
- **TTS friendly:** `minLength` merges tiny sentences ("Hi.") into the next one, and `maxLength` forces a split so a run-on sentence can't stall audio.
- Works with async iterables, `ReadableStream`s, `TransformStream` pipelines, strings or bytes, in Node, Deno, Bun, browsers and edge runtimes.

## Install

```sh
npm install streamcut
```

## Usage

### Any async iterable

```ts
import { split } from "streamcut";

for await (const sentence of split(stream)) console.log(sentence);
```

`stream` can be an async iterable or a `ReadableStream` of strings or `Uint8Array`s (bytes are decoded as UTF-8, including characters cut across chunks).

### OpenAI

```ts
import OpenAI from "openai";
import { split } from "streamcut";

const openai = new OpenAI();
const stream = await openai.chat.completions.create({ model: "gpt-5", messages, stream: true });

async function* tokens() {
  for await (const chunk of stream) yield chunk.choices[0]?.delta?.content ?? "";
}

for await (const sentence of split(tokens())) await tts(sentence);
```

### Anthropic

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createSplitter } from "streamcut";

const splitter = createSplitter();
const stream = new Anthropic().messages.stream({ model: "claude-sonnet-5-5", max_tokens: 1024, messages });

stream.on("text", (text) => splitter.push(text).forEach(speak));
await stream.finalMessage();
splitter.flush().forEach(speak);
```

### Vercel AI SDK

```ts
import { streamText } from "ai";
import { split } from "streamcut";

const { textStream } = streamText({ model, prompt });
for await (const sentence of split(textStream)) speak(sentence);
```

### fetch / Web Streams

```ts
import { SplitStream } from "streamcut";

const res = await fetch("/api/chat");
const sentences = res.body!.pipeThrough(new TextDecoderStream()).pipeThrough(new SplitStream());
for await (const s of sentences) render(s);
```

### Markdown blocks

Render chat responses block by block, so a half-written table or code block never shows up broken:

```ts
for await (const block of split(stream, { mode: "block" })) {
  container.append(renderMarkdown(block));
}
```

Blocks are paragraphs, headings, lists, tables, quotes, thematic breaks and fenced code blocks. A block is emitted once a blank line, a new heading, a closing fence or the end of the stream proves it is finished.

### Push API

```ts
import { createSplitter } from "streamcut";

const splitter = createSplitter();
splitter.push("Hello there. How a"); // → ["Hello there."]
splitter.push("re you?");            // → [] (it might continue)
splitter.flush();                    // → ["How are you?"]
```

### Whole strings

```ts
import { splitText } from "streamcut";

splitText("Dr. Smith arrived. He sat down."); // ["Dr. Smith arrived.", "He sat down."]
```

### Skipping code for speech

```ts
import { isCodeBlock, split } from "streamcut";

for await (const s of split(stream)) if (!isCodeBlock(s)) speak(s);
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `mode` | `"sentence"` | `"sentence"` or `"block"` (Markdown blocks). |
| `minLength` | `0` | Sentence mode: merge sentences shorter than this into the next one. |
| `maxLength` | off | Sentence mode: force a split at the last space once a sentence gets this long. |
| `abbreviations` | built-in list | Sentence mode: extra words that don't end a sentence, like `["approx", "Corp"]`. Case-insensitive, no trailing dot. |
| `preserveCode` | `true` | Sentence mode: keep fenced code blocks whole. |

## API

- `split(source, options?)`: async generator of segments from an async iterable, iterable or `ReadableStream`.
- `createSplitter(options?)`: returns `{ push(chunk), flush(), reset() }`. `push` returns the segments it completed; `flush` returns the rest and resets.
- `splitText(text, options?)`: splits a full string.
- `new SplitStream(options?)`: a `TransformStream<string, string>`.
- `isCodeBlock(segment)`: `true` for fenced code blocks.
- `SentenceSegmenter`, `BlockSegmenter`, `DEFAULT_ABBREVIATIONS`: the building blocks.

## How it decides

A sentence ends at `.`, `!`, `?`, `…` or `‽` (plus closing quotes, brackets or emphasis) followed by whitespace, unless the word before is a known abbreviation, an initial, a dotted acronym or a list number, or the next word starts lowercase. A newline before a list item, heading, quote or table row, or a blank line, also ends one. When a chunk ends right after a period, streamcut waits for the next character before deciding, so it never has to take a segment back.

## License

[MIT](LICENSE)
