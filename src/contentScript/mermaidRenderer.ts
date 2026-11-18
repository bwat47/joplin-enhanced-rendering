import type { EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { PeleError, render as renderPele } from 'pele';

import { logger } from '../logger';
import { renderMermaidMath } from './mathRenderer';
import { attachEditOnClick, dedentLines, LruCache } from './renderUtils';

export interface MermaidBlock {
    from: number;
    to: number;
    replaceFrom: number;
    replaceTo: number;
    editOffset: number;
    source: string;
}

export type MermaidRenderResult =
    | { ok: true; svg: string; width: number; height: number }
    | { ok: false; error: string };

const MERMAID_CACHE_SENTINEL = '__joplin_er_pele_id__';
const MERMAID_WIDGET_PADDING_PX = 16;

// Matches the first whitespace-delimited token of a fenced code info string, e.g. `mermaid` in `mermaid title="Demo"`.
const INFO_LANGUAGE_PATTERN = /^\s*(\S+)/;

const mermaidCache = new LruCache<string, MermaidRenderResult>();

let widgetInstanceCounter = 0;

/**
 * Clears the cached Pele render outputs (useful in tests).
 */
export function clearMermaidRenderCache(): void {
    mermaidCache.clear();
}

function getFenceChildren(node: SyntaxNodeRef): {
    info: { from: number; to: number } | null;
    openMark: { from: number; to: number } | null;
    closeMark: { from: number; to: number } | null;
} {
    let info: { from: number; to: number } | null = null;
    let openMark: { from: number; to: number } | null = null;
    let closeMark: { from: number; to: number } | null = null;

    for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'CodeInfo' && !info) {
            info = { from: child.from, to: child.to };
        } else if (child.name === 'CodeMark') {
            if (!openMark) {
                openMark = { from: child.from, to: child.to };
            } else {
                closeMark = { from: child.from, to: child.to };
            }
        }
    }

    return { info, openMark, closeMark };
}

/**
 * Extracts a closed ` ```mermaid ` fenced code block from a Lezer `FencedCode` node.
 * Returns `null` for non-Mermaid fences, unclosed fences, blockquoted fences, or empty blocks.
 */
export function extractMermaidBlock(state: EditorState, node: SyntaxNodeRef): MermaidBlock | null {
    if (node.name !== 'FencedCode') {
        return null;
    }

    const { info, openMark, closeMark } = getFenceChildren(node);
    if (!info || !openMark || !closeMark) {
        return null;
    }

    const infoMatch = INFO_LANGUAGE_PATTERN.exec(state.sliceDoc(info.from, info.to));
    if (infoMatch?.[1]?.toLowerCase() !== 'mermaid') {
        return null;
    }

    const openLine = state.doc.lineAt(openMark.from);
    const closeLine = state.doc.lineAt(closeMark.from);
    const leadingText = state.sliceDoc(openLine.from, openMark.from);

    // Skip blockquoted or inline-prefixed fences (e.g. `> ```mermaid`) so replacing the lines
    // never drops or orphans leading Markdown container markers.
    if (leadingText.trim() !== '') {
        return null;
    }

    const bodyStart = openLine.to + 1;
    const bodyEnd = closeLine.from;
    if (bodyStart >= bodyEnd) {
        return null;
    }

    const rawBody = state.sliceDoc(bodyStart, bodyEnd).replace(/\n$/, '');
    const source = dedentLines(rawBody, leadingText);
    if (source.trim() === '') {
        return null;
    }

    return {
        from: node.from,
        to: node.to,
        replaceFrom: openLine.from,
        replaceTo: closeLine.to,
        editOffset: bodyStart - openLine.from,
        source,
    };
}

/**
 * Renders Mermaid source to SVG synchronously via Pele, caching results by source text.
 */
export function renderMermaid(source: string): MermaidRenderResult {
    const cached = mermaidCache.get(source);
    if (cached) {
        return cached;
    }

    let result: MermaidRenderResult;
    try {
        const rendered = renderPele(source, {
            idPrefix: MERMAID_CACHE_SENTINEL,
            responsive: true,
            images: false,
            links: false,
            math: renderMermaidMath,
        });
        result = {
            ok: true,
            svg: rendered.svg,
            width: rendered.width,
            height: rendered.height,
        };
    } catch (error) {
        const message = error instanceof PeleError ? error.message : String(error);
        if (!(error instanceof PeleError)) {
            logger.debug('Unexpected error rendering Mermaid diagram', error);
        }
        result = { ok: false, error: message };
    }

    mermaidCache.set(source, result);
    return result;
}

export class MermaidWidget extends WidgetType {
    public constructor(
        private readonly source: string,
        private readonly result: MermaidRenderResult,
        private readonly editOffset: number
    ) {
        super();
    }

    public override eq(other: WidgetType): boolean {
        return (
            other instanceof MermaidWidget &&
            other.source === this.source &&
            other.editOffset === this.editOffset &&
            other.result.ok === this.result.ok
        );
    }

    public override get estimatedHeight(): number {
        return this.result.ok ? Math.ceil(this.result.height) + MERMAID_WIDGET_PADDING_PX : -1;
    }

    public override toDOM(view: EditorView): HTMLElement {
        const doc = view.dom.ownerDocument;
        const container = doc.createElement('div');
        container.className = 'cm-enhanced-rendering-block cm-enhanced-rendering-mermaid';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Rendered Mermaid diagram');

        if (this.result.ok) {
            const uniquePrefix = `er-m${++widgetInstanceCounter}-`;
            container.innerHTML = this.result.svg.split(MERMAID_CACHE_SENTINEL).join(uniquePrefix);
        } else {
            container.dataset.renderError = 'true';
            const errorBox = doc.createElement('div');
            errorBox.className = 'cm-enhanced-rendering-error';
            errorBox.textContent = `Mermaid syntax error: ${this.result.error}`;
            container.appendChild(errorBox);
        }

        attachEditOnClick(container, view, this.editOffset);
        return container;
    }

    public override ignoreEvent(): boolean {
        return true;
    }
}
