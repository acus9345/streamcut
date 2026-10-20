# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-20

### Added

- `split()` async generator, `createSplitter()` push API, `splitText()` and `SplitStream` (`TransformStream`).
- Sentence mode: abbreviations, initials, dotted acronyms, decimals, list numbers, lowercase continuations, closing quotes and emphasis, CJK punctuation, `minLength`, `maxLength` and custom `abbreviations`.
- Block mode: paragraphs, headings (ATX and setext), lists, tables, quotes, thematic breaks and fenced code blocks.
- Code fences are kept whole in both modes; `isCodeBlock()` helper.
- Accepts strings or UTF-8 bytes from async iterables, iterables and `ReadableStream`s.

[0.1.0]: https://github.com/acus9345/streamcut/releases/tag/v0.1.0
