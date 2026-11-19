A CodeMirror 6 content script plugin that renders Mermaid diagrams (via Pele) and inline/block LaTeX math (via KaTeX) directly in Joplin's Markdown editor.

---

### 1. Module Structure

- **`src/index.ts`**: Registers the CodeMirror 6 content script (`contentScript/enhancedRendering.js`) with Joplin.
- **`src/contentScript/enhancedRendering.ts`**: Content script entry point wiring `pointerRevealFreezeExtension`, `blockRenderingExtension`, `inlineMathPlugin`, and the Pele light/dark theme extension into `codeMirrorWrapper.addExtension`, and exporting `./enhancedRendering.css` via `assets()`.
- **`src/contentScript/pointerRevealFreeze.ts`**: Freezes the effective selection used for revealing/collapsing widgets during left-button mouse gestures (`mousedown` → `mouseup` + `blur`/`dragend`/`mousemove` safety listeners) so dragging a selection across rendered Mermaid or math blocks does not shift document layout mid-drag.
- **`src/contentScript/blockRenderingField.ts`**: `StateField<DecorationSet>` providing `Decoration.replace({ widget, block: true })` for closed ` ```mermaid ` fenced code blocks and closed `$$...$$` `BlockMath` nodes whenever the effective reveal selection does not intersect the block, plus a vertical-navigation transaction filter so `ArrowDown`/`ArrowUp` enters replaced blocks.
- **`src/contentScript/inlineMathPlugin.ts`**: `ViewPlugin` scanning `view.visibleRanges` for Joplin's `InlineMath` (`$...$`) nodes and replacing non-selected expressions with inline KaTeX widgets.
- **`src/contentScript/mermaidRenderer.ts`**: Extracts closed, non-blockquoted `mermaid` `FencedCode` blocks (dedenting list-indented fences), renders SVG synchronously via Pele (`images: false`, `links: false`, `responsive: true`, `math: renderMermaidMath`) with an LRU cache and unique per-widget SVG ID prefixes, and builds `MermaidWidget` (including `estimatedHeight` and `PeleError` display).
- **`src/contentScript/mathRenderer.ts`**: Extracts `InlineMath` and closed, non-blockquoted `BlockMath` nodes from Joplin's syntax tree, renders LaTeX synchronously via KaTeX (`trust: false`, LRU-cached), provides the Pele `MathResolver` (`renderMermaidMath`, using KaTeX MathML output + hidden DOM measurement probe for `$$...$$` labels inside Mermaid diagrams), and builds `MathWidget`.
- **`src/contentScript/renderUtils.ts`**: Shared bounded `LruCache`, inclusive `rangeIntersectsSelection` check, `attachEditOnClick` handler (expands widget on click and places cursor inside the source), and `dedentLines`.
- **`src/contentScript/styles.css`**: Widget layout, error styling, and specificity overrides restoring `KaTeX_Main` font-family and text color over Joplin's CM6 theme rules.

### 2. Syntax Tree Integration

- **Math**: Relies on Joplin's built-in `InlineMath` and `BlockMath` Lezer nodes (which Joplin enables when `settings.katexEnabled` is on). Unclosed `BlockMath` nodes extending to EOF and blockquoted math (`> $$`) are skipped so editing remains intact.
- **Mermaid**: Inspects `@lezer/markdown` `FencedCode` nodes with a `CodeInfo` language token of `mermaid` (case-insensitive) and both opening and closing `CodeMark` children.

### 3. Build and Packaging

`npm run dist` typechecks, then delegates bundling and packaging to `@bwat47/joplin-plugin-scripts`, which uses esbuild to produce `dist/` and the `.jpl` in `publish/`.

`plugin.config.json` registers `contentScript/enhancedRendering.ts` as an `extraScripts` entry and configures esbuild's `loader` map so `.woff2` font imports (from `katex/dist/katex.min.css`) inline as data URIs into the emitted sibling `dist/contentScript/enhancedRendering.css`, while legacy `.woff` and `.ttf` fallbacks are dropped (`empty`). Because Joplin's `PluginLoader` injects CSS assets into `<style>` tags, inlined `.woff2` data URIs work identically on desktop and mobile without relative font URLs. Joplin's CodeMirror and Lezer packages remain external.
