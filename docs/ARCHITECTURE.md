# Architecture

A CodeMirror 6 content script plugin that renders Mermaid diagrams (via [Pele](https://github.com/bwat47/pele)) and LaTeX math (via [KaTeX](https://katex.org/)) inline inside Joplin's Markdown editor.

## Overview

Joplin loads `src/index.ts`, which registers `src/contentScript/enhancedRendering.ts` as a CodeMirror 6 content script. That script attaches the plugin's editor extensions, theme styles, and bundled KaTeX stylesheet directly to Joplin's Markdown editor.

Instead of running its own Markdown parser, the plugin reads Joplin's existing Lezer syntax tree to find math and Mermaid nodes, then swaps them for rendered DOM widgets whenever the cursor is outside them.

## Core Design

### Block vs. Inline Pipelines

CodeMirror 6 requires decorations that replace multi-line blocks to live in a `StateField`, while lightweight inline decorations can be scoped to the viewport in a `ViewPlugin`. The plugin splits rendering along that boundary:

- **Block rendering (`blockRenderingField.ts`)**: A `StateField` managing closed Mermaid fenced code blocks and display math (`$$...$$`). It rebuilds its block list and widget decorations from the syntax tree on every edit, and on selection changes only when a block is revealed or rendered. Rebuilding is cheap: widgets render lazily when mounted, the renderers cache their output, and CodeMirror keeps a mounted widget's DOM when the new widget is `eq` to the old one, so unchanged blocks aren't re-rendered as the user types or moves the cursor. Revealed blocks get a live preview widget instead.
- **Inline math (`inlineMathPlugin.ts`)**: A `ViewPlugin` that inspects only the currently visible viewport for inline math (`$...$`) and replaces non-selected expressions with inline KaTeX widgets.

### Syntax Tree Integration

- **Math**: Relies on Joplin's built-in Lezer `InlineMath` and `BlockMath` nodes (active when KaTeX is enabled in Joplin).
- **Mermaid**: Matches standard Lezer `FencedCode` blocks labeled `mermaid`.
- **Safety guards**: Unclosed blocks and blockquoted math/diagrams are skipped so in-progress edits and quoted syntax stay intact.

### Editing & Selection Ergonomics

- **Reveal on selection**: Any block or inline expression intersecting the cursor or selection reverts to raw Markdown for editing; moving the cursor out renders it again.
- **Live block preview**: While a Mermaid or display math block is revealed, a read-only block widget after its closing line keeps the rendered output visible below the source and updates as the source is edited. Clicks on the preview are inert so they don't move the cursor. Inline math has no preview.
- **Click-to-edit & vertical navigation**: Clicking a rendered widget places the cursor inside its source, and a transaction filter allows vertical arrow-key movement to step cleanly into replaced blocks.
- **Whole-block selection (`blockSelectionSnap.ts`)**: A transaction filter grows any non-empty selection range that touches a rendered block so it covers the whole block. Dragging, Shift+clicking or Shift+Arrowing into a diagram or display math block therefore selects all of it instead of ending at a hidden boundary in its source. Blocks already revealed for editing are left alone, and so are document changes.
- **Drag stability (`pointerRevealFreeze.ts`)**: Freezes widget reveal/collapse transitions during mouse drags so dragging a selection across large diagrams or math blocks doesn't cause layout jumps mid-drag.

### Renderers & Caching

- **Mermaid (`mermaidRenderer.ts`, `mermaidWidth.ts`)**: Synchronously renders diagrams to responsive SVGs via Pele (with external images/links disabled for safety) and shows inline error widgets on invalid syntax. An editor-level width tracker quantizes and debounces the available width into coarse `maxWidth` buckets (reused across note switches) so narrow panes and mobile viewports get adaptive layouts without resize thrashing. Widgets render lazily when mounted, so width changes only re-render visible diagrams and keep the existing DOM when the SVG is unchanged.
- **Math (`mathRenderer.ts`)**: Synchronously renders LaTeX via KaTeX (with untrusted commands disabled) when a widget mounts, so off-screen math never runs KaTeX. It also provides math rendering for `$$...$$` labels inside Mermaid diagrams.
- **Caching**: Both renderers use bounded LRU caches keyed by source (and Mermaid width bucket). These, plus widget `eq`, are the only render caches; the block field holds no decoration cache of its own.

## Module Map

| Module                                     | Responsibility                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/index.ts`                             | Registers the CodeMirror 6 content script with Joplin.                                    |
| `src/contentScript/enhancedRendering.ts`   | Wires together extensions, light/dark theme styling, and CSS assets.                      |
| `src/contentScript/blockRenderingField.ts` | `StateField` for Mermaid and display math block widgets, live previews, and cursor entry. |
| `src/contentScript/blockSelectionSnap.ts`  | Transaction filter snapping selections to cover whole rendered blocks.                    |
| `src/contentScript/inlineMathPlugin.ts`    | Viewport-scoped `ViewPlugin` for inline `$...$` math widgets.                             |
| `src/contentScript/pointerRevealFreeze.ts` | Freezes reveal/collapse state during pointer drag gestures.                               |
| `src/contentScript/mermaidRenderer.ts`     | Mermaid extraction, Pele SVG rendering, and `MermaidWidget`.                              |
| `src/contentScript/mermaidWidth.ts`        | Editor-level quantized, debounced width tracker feeding Pele's adaptive `maxWidth`.       |
| `src/contentScript/mathRenderer.ts`        | Math extraction, KaTeX rendering, Mermaid math integration, and `MathWidget`.             |
| `src/contentScript/renderUtils.ts`         | Shared LRU cache, selection intersection checks, click-to-edit, and indentation helpers.  |
| `src/logger.ts`                            | Logging wrapper.                                                                          |

## Build & Packaging

`npm run dist` runs TypeScript typechecking, then bundles `dist/` and packages `publish/*.jpl` via `@bwat47/joplin-plugin-scripts` (esbuild).

- Joplin's CodeMirror and Lezer packages are kept external and provided by the host app at runtime.
- `plugin.config.json` configures esbuild to inline KaTeX `.woff2` fonts as data URIs into the emitted `enhancedRendering.css` (dropping legacy `.woff`/`.ttf` fallbacks) so fonts load reliably on both desktop and mobile when Joplin injects the CSS into a `<style>` tag.
