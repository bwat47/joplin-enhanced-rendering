A CodeMirror 6 content script plugin that renders Mermaid diagrams (via Pele) and inline/block LaTeX math (via KaTeX) directly in Joplin's Markdown editor.

---

### 1. Planned Modules

- **`src/index.ts`**: Registers the CodeMirror 6 content script (`contentScript/enhancedRendering.js`) with Joplin.
- **`src/contentScript/enhancedRendering.ts`**: Content script entry point that wires the CM6 extension(s) into `codeMirrorWrapper.addExtension` and exports the bundled stylesheet asset (`./enhancedRendering.css`).
- **Mermaid rendering (planned)**: `StateField` using `Decoration.replace({ widget, block: true })` to replace ` ```mermaid ` fenced code blocks with Pele-rendered SVGs whenever the editor selection does not overlap the block.
- **Math rendering (planned)**:
    - Block math (`$$...$$`): `StateField` using `Decoration.replace({ widget, block: true })` with KaTeX in display mode.
    - Inline math (`$...$`): `ViewPlugin` (or shared `StateField`) using `Decoration.replace({ widget })` with KaTeX in inline mode.

### 2. Build and Packaging

`npm run dist` typechecks, then delegates bundling and packaging to `@bwat47/joplin-plugin-scripts`, which uses esbuild to produce `dist/` and the `.jpl` in `publish/`.

`plugin.config.json` registers `contentScript/enhancedRendering.ts` as an `extraScripts` entry and configures esbuild's `loader` map so `.woff2` font imports (from `katex/dist/katex.min.css`) inline as data URIs into the emitted sibling `dist/contentScript/enhancedRendering.css`, while legacy `.woff` and `.ttf` fallbacks are dropped (`empty`). Joplin's CodeMirror and Lezer packages remain external.
