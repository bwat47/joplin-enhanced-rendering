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
// Last rendered widget height per source at any width, used to estimate off-screen diagrams
// whose render at the current width has not happened yet.
const lastKnownHeights = new LruCache<string, number>();

let widgetInstanceCounter = 0;

/**
 * Clears the cached Pele render outputs (useful in tests).
 */
export function clearMermaidRenderCache(): void {
    mermaidCache.clear();
    lastKnownHeights.clear();
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

function normalizeMaxWidth(maxWidth: number | undefined): number | undefined {
    return maxWidth !== undefined && Number.isFinite(maxWidth) && maxWidth > 0 ? Math.floor(maxWidth) : undefined;
}

function mermaidCacheKey(source: string, normalizedMaxWidth: number | undefined): string {
    return normalizedMaxWidth === undefined ? source : `${normalizedMaxWidth}:${source}`;
}

function widgetHeight(result: MermaidRenderResult): number {
    return result.ok ? Math.ceil(result.height) + MERMAID_WIDGET_PADDING_PX : -1;
}

/**
 * Renders Mermaid source to SVG synchronously via Pele, caching results by source text
 * and optional adaptive `maxWidth` constraint.
 */
export function renderMermaid(source: string, maxWidth?: number): MermaidRenderResult {
    const normalizedMaxWidth = normalizeMaxWidth(maxWidth);
    const cacheKey = mermaidCacheKey(source, normalizedMaxWidth);
    const cached = mermaidCache.get(cacheKey);
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
            ...(normalizedMaxWidth !== undefined ? { maxWidth: normalizedMaxWidth } : {}),
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

    mermaidCache.set(cacheKey, result);
    lastKnownHeights.set(source, widgetHeight(result));
    return result;
}

/**
 * Block widget for a Mermaid diagram. Rendering is deferred until CodeMirror mounts the widget
 * (`toDOM`/`updateDOM`), so width-bucket changes only re-render diagrams in or near the viewport.
 */
export class MermaidWidget extends WidgetType {
    private renderedResult: MermaidRenderResult | null = null;

    public constructor(
        private readonly source: string,
        public readonly editOffset: number,
        private readonly maxWidth?: number
    ) {
        super();
    }

    private get result(): MermaidRenderResult {
        this.renderedResult ??= renderMermaid(this.source, this.maxWidth);
        return this.renderedResult;
    }

    /** Equality is identity-based so CodeMirror's document-wide decoration diff never forces a render. */
    public override eq(other: WidgetType): boolean {
        return (
            other instanceof MermaidWidget &&
            other.source === this.source &&
            other.editOffset === this.editOffset &&
            other.maxWidth === this.maxWidth
        );
    }

    /**
     * Updates a mounted diagram in place after a width-bucket change. Keeps the existing DOM when the
     * re-rendered SVG is identical, and declines (forcing `toDOM`) when the source or click target differs.
     */
    public override updateDOM(dom: HTMLElement, view: EditorView, from: MermaidWidget): boolean {
        if (from.source !== this.source || from.editOffset !== this.editOffset) {
            return false;
        }

        const previous = from.renderedResult;
        const next = this.result;
        if (previous?.ok && next.ok && previous.svg === next.svg) {
            return true;
        }

        dom.replaceChildren();
        delete dom.dataset.renderError;
        this.fillContainer(dom, view);
        return true;
    }

    public override get estimatedHeight(): number {
        const result =
            this.renderedResult ?? mermaidCache.peek(mermaidCacheKey(this.source, normalizeMaxWidth(this.maxWidth)));
        return result ? widgetHeight(result) : (lastKnownHeights.peek(this.source) ?? -1);
    }

    public override toDOM(view: EditorView): HTMLElement {
        const container = view.dom.ownerDocument.createElement('div');
        container.className = 'cm-enhanced-rendering-block cm-enhanced-rendering-mermaid';
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Rendered Mermaid diagram');
        this.fillContainer(container, view);
        attachEditOnClick(container, view, this.editOffset);
        return container;
    }

    public override ignoreEvent(): boolean {
        return true;
    }

    private fillContainer(container: HTMLElement, view: EditorView): void {
        const result = this.result;
        if (result.ok) {
            const uniquePrefix = `er-m${++widgetInstanceCounter}-`;
            container.innerHTML = result.svg.split(MERMAID_CACHE_SENTINEL).join(uniquePrefix);
            return;
        }

        container.dataset.renderError = 'true';
        const errorBox = view.dom.ownerDocument.createElement('div');
        errorBox.className = 'cm-enhanced-rendering-error';
        errorBox.textContent = `Mermaid syntax error: ${result.error}`;
        container.appendChild(errorBox);
    }
}
