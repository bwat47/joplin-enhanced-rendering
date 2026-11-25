# Architecture

A CodeMirror 6 content script plugin that renders Mermaid diagrams (via [Pele](https://github.com/bwat47/pele)) and LaTeX math (via [KaTeX](https://katex.org/)) inline inside Joplin's Markdown editor.

## Overview

Joplin loads `src/index.ts`, which registers `src/contentScript/enhancedRendering.ts` as a CodeMirror 6 content script and creates the full-screen diagram dialog. The content script attaches the plugin's editor extensions, theme styles, and bundled KaTeX stylesheet directly to Joplin's Markdown editor.

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
- **Whole-block selection (`blockSelectionSnap.ts`)**: A transaction filter grows any non-empty user selection range that touches a rendered block so it covers the whole block. Dragging or Shift+Arrowing into a diagram or display math block therefore selects all of it instead of ending at a hidden boundary in its source. Blocks already revealed for editing are left alone, and so are document changes, search matches, and programmatic selections.
- **Drag stability (`pointerRevealFreeze.ts`)**: Freezes widget reveal/collapse transitions during mouse drags so dragging a selection across large diagrams or math blocks doesn't cause layout jumps mid-drag.

### Full-Screen Diagrams

Rendered Mermaid diagrams and their live previews show a button in the top-right corner (revealed on hover where the device can hover). It swallows its own pointer events, so pressing it never triggers click-to-edit.

1. **Content script (`mermaidFullscreenButton.ts`)**: On click, the widget renders its source again without the editor's `maxWidth`, so the diagram uses its natural layout, and passes the SVG and the editor's dark-theme flag to the handler in the `mermaidFullscreenHandler` facet. `enhancedRendering.ts` supplies a handler that forwards them to the plugin with `context.postMessage` (`fullscreenMessage.ts` defines the message). Without a handler, as in tests, no button is shown.
2. **Main process (`fullscreenDialog/dialog.ts`)**: `index.ts` receives the message through `joplin.contentScripts.onMessage` and opens a Joplin dialog with fit-to-content off, so it takes most of the window. `dialogHtml.ts` wraps the SVG in a toolbar and viewport, setting Pele's color variables inline from the same `peleTheme.ts` mapping the editor theme uses.
3. **Webview (`fullscreenDialog/panZoom.ts`)**: Applies a CSS `translate()`/`scale()` transform to the diagram. A single pointer pans, two pointers pinch-zoom, the wheel zooms around the cursor, and double-click, the toolbar, or `0` fits the diagram to the window. The geometry lives in `panZoomMath.ts`. Joplin can set the dialog HTML before or after the script loads, so a `MutationObserver` attaches a fresh viewer to each new root.

### Renderers & Caching

- **Mermaid (`mermaidRenderer.ts`, `mermaidWidth.ts`)**: Synchronously renders diagrams to responsive SVGs via Pele (with external images/links disabled for safety) and shows inline error widgets on invalid syntax. An editor-level width tracker quantizes and debounces the available width into coarse `maxWidth` buckets (reused across note switches) so narrow panes and mobile viewports get adaptive layouts without resize thrashing. Widgets render lazily when mounted, so width changes only re-render visible diagrams and keep the existing DOM when the SVG is unchanged.
- **Math (`mathRenderer.ts`)**: Synchronously renders LaTeX via KaTeX (with untrusted commands disabled) when a widget mounts, so off-screen math never runs KaTeX. It also provides math rendering for `$$...$$` labels inside Mermaid diagrams.
- **Caching**: Both renderers use bounded LRU caches keyed by source (and Mermaid width bucket). These, plus widget `eq`, are the only render caches; the block field holds no decoration cache of its own.

## Module Map

| Module                                         | Responsibility                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/index.ts`                                 | Registers the CodeMirror 6 content script and the full-screen dialog with Joplin.         |
| `src/contentScript/enhancedRendering.ts`       | Wires together extensions, light/dark theme styling, and CSS assets.                      |
| `src/contentScript/blockRenderingField.ts`     | `StateField` for Mermaid and display math block widgets, live previews, and cursor entry. |
| `src/contentScript/blockSelectionSnap.ts`      | Transaction filter snapping selections to cover whole rendered blocks.                    |
| `src/contentScript/inlineMathPlugin.ts`        | Viewport-scoped `ViewPlugin` for inline `$...$` math widgets.                             |
| `src/contentScript/pointerRevealFreeze.ts`     | Freezes reveal/collapse state during pointer drag gestures.                               |
| `src/contentScript/mermaidRenderer.ts`         | Mermaid extraction, Pele SVG rendering, and `MermaidWidget`.                              |
| `src/contentScript/mermaidFullscreenButton.ts` | Full-screen button on Mermaid widgets and the facet that receives its requests.           |
| `src/contentScript/mermaidWidth.ts`            | Editor-level quantized, debounced width tracker feeding Pele's adaptive `maxWidth`.       |
| `src/contentScript/mathRenderer.ts`            | Math extraction, KaTeX rendering, Mermaid math integration, and `MathWidget`.             |
| `src/contentScript/renderUtils.ts`             | Shared LRU cache, selection intersection checks, click-to-edit, and indentation helpers.  |
| `src/fullscreenMessage.ts`                     | Content script → plugin message for opening a diagram full screen.                        |
| `src/peleTheme.ts`                             | Pele CSS variables mapped to Joplin theme variables, shared by the editor and the dialog. |
| `src/fullscreenDialog/dialog.ts`               | Creates and opens the full-screen diagram dialog.                                         |
| `src/fullscreenDialog/dialogHtml.ts`           | Dialog markup: toolbar, viewport, and themed diagram stage.                               |
| `src/fullscreenDialog/panZoom.ts`              | Webview script for panning and zooming the diagram.                                       |
| `src/fullscreenDialog/panZoomMath.ts`          | Pure fit, zoom, pinch, and wheel geometry.                                                |
| `src/logger.ts`                                | Logging wrapper.                                                                          |

## Build & Packaging

`npm run dist` runs TypeScript typechecking, then bundles `dist/` and packages `publish/*.jpl` via `@bwat47/joplin-plugin-scripts` (esbuild).

- Joplin's CodeMirror and Lezer packages are kept external and provided by the host app at runtime.
- `fullscreenDialog/panZoom.ts` is listed under `webviewScripts` and bundled as a standalone script for the dialog; `fullscreenDialog/styles.css` is copied as a runtime asset.
- `plugin.config.json` configures esbuild to inline KaTeX `.woff2` fonts as data URIs into the emitted `enhancedRendering.css` (dropping legacy `.woff`/`.ttf` fallbacks) so fonts load reliably on both desktop and mobile when Joplin injects the CSS into a `<style>` tag.
