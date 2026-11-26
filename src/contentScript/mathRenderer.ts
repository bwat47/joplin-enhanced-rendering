import type { EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { ParseError, renderToString } from 'katex';
import type { MathMarkup } from 'pele';

import { logger } from '../logger';
import { attachEditOnClick, attachPreviewPointerGuard, HEIGHT_CACHE_SIZE, LruCache } from './renderUtils';

export interface MathExpression {
    from: number;
    to: number;
    replaceFrom: number;
    replaceTo: number;
    editOffset: number;
    tex: string;
    displayMode: boolean;
}

type MathRenderResult = { ok: true; html: string } | { ok: false; error: string };

const INLINE_MATH_NODE = 'InlineMath';
const BLOCK_MATH_NODE = 'BlockMath';

const mathCache = new LruCache<string, MathRenderResult>();
const mermaidMathCache = new LruCache<string, MathMarkup | null>();
const mathHeightCache = new LruCache<string, number>(HEIGHT_CACHE_SIZE);

let mathProbe: HTMLDivElement | null = null;

/**
 * Clears the cached KaTeX render outputs (useful in tests).
 */
// fallow-ignore-next-line test-only-export -- tests reset the module-level KaTeX caches between cases
export function clearMathRenderCache(): void {
    mathCache.clear();
    mermaidMathCache.clear();
    mathHeightCache.clear();
}

/**
 * Returns a hidden element for measuring Mermaid math labels.
 *
 * It attaches to the global `document` on purpose, unlike widget DOM, which uses
 * `view.dom.ownerDocument`. The probe only produces document-independent data (markup and
 * dimensions) that is shared across views through `mermaidMathCache` and the Mermaid render cache.
 */
function getMathProbe(): HTMLDivElement | null {
    if (typeof document === 'undefined') {
        return null;
    }

    if (!mathProbe || !mathProbe.isConnected) {
        mathProbe = document.createElement('div');
        mathProbe.setAttribute('aria-hidden', 'true');
        mathProbe.style.cssText =
            'position:fixed;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;display:inline-block;line-height:normal;white-space:nowrap;';
        document.body.append(mathProbe);
    }

    return mathProbe;
}

function estimateMathDimensions(tex: string, size: number): { width: number; height: number } {
    return {
        width: Math.max(size, Math.ceil(tex.length * size * 0.6)),
        height: Math.ceil(size * 1.4),
    };
}

/**
 * Pele `MathResolver` callback that typesets `$$...$$` labels inside Mermaid diagrams using
 * KaTeX MathML output and measures their rendered box via a hidden DOM probe.
 *
 * Uses MathML (`<math>`) rather than KaTeX HTML to avoid WebKit's `<foreignObject>` positioning
 * bug on iOS and to inherit Pele's SVG label colors automatically across themes.
 */
export function renderMermaidMath(tex: string, size: number): MathMarkup | null {
    const cacheKey = `${size}:${tex}`;
    const cached = mermaidMathCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    let katexOutput: string;
    try {
        katexOutput = renderToString(tex, {
            displayMode: true,
            output: 'mathml',
            throwOnError: true,
            trust: false,
            strict: 'ignore',
        });
    } catch (error) {
        if (!(error instanceof ParseError)) {
            logger.debug('Unexpected error rendering KaTeX math in Mermaid diagram', error);
        }
        mermaidMathCache.set(cacheKey, null);
        return null;
    }

    const probe = getMathProbe();
    let result: MathMarkup | null = null;

    if (probe) {
        probe.style.fontSize = `${size}px`;
        probe.innerHTML = katexOutput;
        const expression = probe.querySelector('math');
        if (expression) {
            const rect = expression.getBoundingClientRect();
            const dimensions =
                rect.width > 0 && rect.height > 0
                    ? { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
                    : estimateMathDimensions(tex, size);
            result = { html: expression.outerHTML, ...dimensions };
        }
        probe.innerHTML = '';
    } else {
        const mathMatch = /<math[\s\S]*<\/math>/.exec(katexOutput);
        if (mathMatch) {
            result = { html: mathMatch[0], ...estimateMathDimensions(tex, size) };
        }
    }

    mermaidMathCache.set(cacheKey, result);
    return result;
}

/**
 * Extracts a single-line `$...$` expression from Joplin's Lezer `InlineMath` node.
 */
export function extractInlineMath(state: EditorState, node: SyntaxNodeRef): MathExpression | null {
    if (node.name !== INLINE_MATH_NODE || node.to - node.from < 3) {
        return null;
    }

    const startLine = state.doc.lineAt(node.from);
    const endLine = state.doc.lineAt(node.to);
    if (startLine.number !== endLine.number) {
        return null;
    }

    const raw = state.sliceDoc(node.from, node.to);
    if (!raw.startsWith('$') || !raw.endsWith('$')) {
        return null;
    }

    const tex = raw.slice(1, -1);
    if (tex.trim() === '') {
        return null;
    }

    return {
        from: node.from,
        to: node.to,
        replaceFrom: node.from,
        replaceTo: node.to,
        editOffset: 1,
        tex,
        displayMode: false,
    };
}

/**
 * Extracts a closed `$$...$$` expression from Joplin's Lezer `BlockMath` node.
 * Skips unclosed blocks (which Joplin extends to EOF) and blockquoted math (`> $$`).
 */
export function extractBlockMath(state: EditorState, node: SyntaxNodeRef): MathExpression | null {
    if (node.name !== BLOCK_MATH_NODE || node.to - node.from < 4) {
        return null;
    }

    const raw = state.sliceDoc(node.from, node.to);
    if (!raw.startsWith('$$') || !raw.endsWith('$$')) {
        return null;
    }

    const openLine = state.doc.lineAt(node.from);
    const closeLine = state.doc.lineAt(node.to);
    const textBefore = state.sliceDoc(openLine.from, node.from);
    const textAfter = state.sliceDoc(node.to, closeLine.to);

    if (textBefore.trim() !== '' || textAfter.trim() !== '') {
        return null;
    }

    const tex = raw.slice(2, -2).trim();
    if (tex === '') {
        return null;
    }

    const editOffset =
        openLine.number === closeLine.number ? node.from - openLine.from + 2 : openLine.to + 1 - openLine.from;

    return {
        from: node.from,
        to: node.to,
        replaceFrom: openLine.from,
        replaceTo: closeLine.to,
        editOffset,
        tex,
        displayMode: true,
    };
}

/**
 * Renders LaTeX math synchronously via KaTeX, caching results by mode and source string.
 */
function renderMath(tex: string, displayMode: boolean): MathRenderResult {
    const cacheKey = `${displayMode ? 'B' : 'I'}:${tex}`;
    const cached = mathCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    let result: MathRenderResult;
    try {
        const html = renderToString(tex, {
            displayMode,
            throwOnError: true,
            trust: false,
            strict: 'ignore',
        });
        result = { ok: true, html };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!(error instanceof ParseError)) {
            logger.debug('Unexpected error rendering KaTeX math', error);
        }
        result = { ok: false, error: message };
    }

    mathCache.set(cacheKey, result);
    return result;
}

/**
 * Wraps the last line of a tagged display equation and its `.katex-tag` in a grid row.
 *
 * KaTeX positions the tag absolutely at the right edge of `.katex-html`, so a wide equation
 * scrolls underneath the tag and the tag aligns with the whole equation rather than its last line.
 * Moving the tag out of `.katex-html`'s direct children disables that rule; the grid then keeps the
 * equation centered, places the tag after it, and lets both overflow and scroll together.
 *
 * Expects KaTeX's display markup: `.katex-html > (.katex-base | .katex-newline)* .katex-tag`.
 * Assumes KaTeX's `leqno` and `fleqn` options are off; the grid always centers the equation and
 * puts the tag on the right.
 */
function groupTaggedLine(container: HTMLElement): void {
    const html = container.querySelector('.katex-display > .katex > .katex-html');
    const tag = html?.lastElementChild;
    if (!html || !tag?.classList.contains('katex-tag')) {
        return;
    }

    const equation = container.ownerDocument.createElement('span');
    equation.className = 'cm-enhanced-rendering-tagged-equation';
    let part = tag.previousElementSibling;
    while (part && !part.classList.contains('katex-newline')) {
        equation.prepend(part);
        part = tag.previousElementSibling;
    }

    const taggedLine = container.ownerDocument.createElement('span');
    taggedLine.className = 'cm-enhanced-rendering-tagged-line';
    taggedLine.append(equation, tag);
    html.append(taggedLine);
}

/**
 * KaTeX math widget. Rendering is deferred until CodeMirror mounts the widget, so decorations for
 * off-screen math (e.g. every block revealed by a select-all) never run KaTeX.
 */
export class MathWidget extends WidgetType {
    private renderedResult: MathRenderResult | null = null;

    /**
     * @param preview Renders a read-only live preview shown below revealed display math source
     *   instead of a click-to-edit replacement for it.
     */
    public constructor(
        private readonly tex: string,
        private readonly displayMode: boolean,
        public readonly editOffset: number,
        private readonly preview = false
    ) {
        super();
    }

    private get result(): MathRenderResult {
        this.renderedResult ??= renderMath(this.tex, this.displayMode);
        return this.renderedResult;
    }

    /** Compares inputs only, so CodeMirror's decoration diff never forces a render. */
    public override eq(other: WidgetType): boolean {
        return (
            other instanceof MathWidget &&
            other.tex === this.tex &&
            other.displayMode === this.displayMode &&
            other.editOffset === this.editOffset &&
            other.preview === this.preview
        );
    }

    public override get estimatedHeight(): number {
        return this.displayMode ? (mathHeightCache.peek(this.tex) ?? -1) : -1;
    }

    public override toDOM(view: EditorView): HTMLElement {
        const doc = view.dom.ownerDocument;
        const container = doc.createElement(this.displayMode ? 'div' : 'span');
        container.className = this.displayMode
            ? 'cm-enhanced-rendering-block cm-enhanced-rendering-math-block'
            : 'cm-enhanced-rendering-inline cm-enhanced-rendering-math';

        const result = this.result;
        if (result.ok) {
            container.innerHTML = result.html;
            if (this.displayMode) {
                groupTaggedLine(container);
            }
        } else {
            container.dataset.renderError = 'true';
            const errorEl = doc.createElement(this.displayMode ? 'div' : 'span');
            errorEl.className = 'cm-enhanced-rendering-error';
            errorEl.title = result.error;
            errorEl.textContent = this.displayMode ? `KaTeX error: ${result.error}` : this.tex;
            container.appendChild(errorEl);
        }

        if (this.displayMode) {
            const win = doc.defaultView;
            win?.requestAnimationFrame(() => {
                if (container.isConnected && container.offsetHeight > 0) {
                    mathHeightCache.set(this.tex, container.offsetHeight);
                }
            });
        }

        if (this.preview) {
            container.classList.add('cm-enhanced-rendering-preview');
            attachPreviewPointerGuard(container);
        } else {
            attachEditOnClick(container, view, this.editOffset);
        }
        return container;
    }

    public override ignoreEvent(): boolean {
        return true;
    }
}
