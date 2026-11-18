import type { EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { ParseError, renderToString } from 'katex';

import { logger } from '../logger';
import { attachEditOnClick, LruCache } from './renderUtils';

export interface MathExpression {
    from: number;
    to: number;
    replaceFrom: number;
    replaceTo: number;
    editOffset: number;
    tex: string;
    displayMode: boolean;
}

export type MathRenderResult = { ok: true; html: string } | { ok: false; error: string };

const INLINE_MATH_NODE = 'InlineMath';
const BLOCK_MATH_NODE = 'BlockMath';

const mathCache = new LruCache<string, MathRenderResult>();

/**
 * Clears the cached KaTeX render outputs (useful in tests).
 */
export function clearMathRenderCache(): void {
    mathCache.clear();
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
export function renderMath(tex: string, displayMode: boolean): MathRenderResult {
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

export class MathWidget extends WidgetType {
    public constructor(
        private readonly tex: string,
        private readonly displayMode: boolean,
        private readonly result: MathRenderResult,
        private readonly editOffset: number
    ) {
        super();
    }

    public override eq(other: WidgetType): boolean {
        return (
            other instanceof MathWidget &&
            other.tex === this.tex &&
            other.displayMode === this.displayMode &&
            other.editOffset === this.editOffset &&
            other.result.ok === this.result.ok
        );
    }

    public override toDOM(view: EditorView): HTMLElement {
        const doc = view.dom.ownerDocument;
        const container = doc.createElement(this.displayMode ? 'div' : 'span');
        container.className = this.displayMode
            ? 'cm-enhanced-rendering-block cm-enhanced-rendering-math-block'
            : 'cm-enhanced-rendering-inline cm-enhanced-rendering-math';

        if (this.result.ok) {
            container.innerHTML = this.result.html;
        } else {
            container.dataset.renderError = 'true';
            const errorEl = doc.createElement(this.displayMode ? 'div' : 'span');
            errorEl.className = 'cm-enhanced-rendering-error';
            errorEl.title = this.result.error;
            errorEl.textContent = this.displayMode ? `KaTeX error: ${this.result.error}` : this.tex;
            container.appendChild(errorEl);
        }

        attachEditOnClick(container, view, this.editOffset);
        return container;
    }

    public override ignoreEvent(): boolean {
        return true;
    }
}
