import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { ViewPlugin, type EditorView, type PluginValue } from '@codemirror/view';

const WIDTH_BUCKET_STEP_PX = 64;
const MIN_MERMAID_WIDTH_PX = 256;
// Matches `.cm-enhanced-rendering-block` horizontal padding (8px each side) plus 1px borders.
const MERMAID_HORIZONTAL_CHROME_PX = 18;
const RESIZE_DEBOUNCE_MS = 150;

const setMermaidMaxWidthEffect = StateEffect.define<number | null>();

let lastKnownWidthBucket: number | null = null;

/**
 * Quantizes an available editor content width (in CSS pixels) down to a coarse bucket
 * suitable for Pele's `maxWidth` option. Returns `null` when width cannot be measured yet.
 */
export function quantizeMermaidWidth(contentWidth: number): number | null {
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
        return null;
    }

    const innerWidth = contentWidth - MERMAID_HORIZONTAL_CHROME_PX;
    if (innerWidth <= 0) {
        return MIN_MERMAID_WIDTH_PX;
    }

    return Math.max(MIN_MERMAID_WIDTH_PX, Math.floor(innerWidth / WIDTH_BUCKET_STEP_PX) * WIDTH_BUCKET_STEP_PX);
}

/**
 * Resets the module-level width bucket seed (useful in tests).
 */
export function resetLastKnownMermaidWidth(): void {
    lastKnownWidthBucket = null;
}

function updateMermaidMaxWidth(value: number | null, transaction: Transaction): number | null {
    for (const effect of transaction.effects) {
        if (effect.is(setMermaidMaxWidthEffect)) {
            return effect.value;
        }
    }

    return value;
}

const mermaidWidthField = StateField.define<number | null>({
    create: (): number | null => lastKnownWidthBucket,
    update: updateMermaidMaxWidth,
});

/**
 * Returns the active quantized `maxWidth` bucket for Mermaid diagrams, or `null` if unmeasured.
 */
export function getMermaidMaxWidth(state: EditorState): number | null {
    return state.field(mermaidWidthField, false) ?? null;
}

/**
 * Returns true if the active Mermaid width bucket changed between `startState` and `nextState`.
 */
export function hasMermaidMaxWidthChanged(startState: EditorState, nextState: EditorState): boolean {
    return getMermaidMaxWidth(startState) !== getMermaidMaxWidth(nextState);
}

function measureHorizontalPadding(element: HTMLElement): number {
    const win = element.ownerDocument.defaultView;
    const style = win?.getComputedStyle(element);
    return (parseFloat(style?.paddingLeft ?? '') || 0) + (parseFloat(style?.paddingRight ?? '') || 0);
}

function measureScrollViewportWidth(scrollDOM: HTMLElement): number {
    const clientWidth = scrollDOM.clientWidth;
    if (clientWidth <= 0) {
        return 0;
    }

    const gutters = scrollDOM.querySelector<HTMLElement>('.cm-gutters');
    const guttersWidth = gutters?.offsetWidth ?? 0;
    return Math.max(0, clientWidth - guttersWidth);
}

function measureEditorAvailableWidth(view: EditorView): number {
    const contentWidth = view.contentDOM.clientWidth;
    const viewportWidth = measureScrollViewportWidth(view.scrollDOM);
    const outerWidth =
        contentWidth > 0 && viewportWidth > 0
            ? // `.cm-content` expands past `.cm-scroller` when wide diagrams or unwrapped lines overflow,
              // while centered editor themes can make `.cm-content` narrower than `.cm-scroller`.
              Math.min(contentWidth, viewportWidth)
            : Math.max(contentWidth, viewportWidth);

    if (outerWidth <= 0) {
        return 0;
    }

    return Math.max(0, outerWidth - measureHorizontalPadding(view.contentDOM));
}

class MermaidWidthPlugin implements PluginValue {
    private destroyed = false;

    private hasMeasured = false;

    private pendingBucket: number | null = null;

    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly resizeObserver: ResizeObserver | null;

    private readonly lastObservedWidths = new Map<Element, number>();

    private readonly measureKey = {};

    public constructor(private readonly view: EditorView) {
        const win = view.dom.ownerDocument.defaultView;
        if (win?.ResizeObserver) {
            this.resizeObserver = new win.ResizeObserver((entries) => {
                if (this.hasObservedWidthChanged(entries)) {
                    this.scheduleMeasure();
                }
            });
            this.resizeObserver.observe(view.scrollDOM);
            this.resizeObserver.observe(view.contentDOM);
        } else {
            this.resizeObserver = null;
        }

        this.scheduleMeasure();
    }

    public destroy(): void {
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.lastObservedWidths.clear();
        this.cancelPending();
    }

    private hasObservedWidthChanged(entries: readonly ResizeObserverEntry[]): boolean {
        let widthChanged = false;
        for (const entry of entries) {
            const width = entry.contentRect.width;
            if (this.lastObservedWidths.get(entry.target) !== width) {
                this.lastObservedWidths.set(entry.target, width);
                widthChanged = true;
            }
        }
        return widthChanged;
    }

    private cancelPending(): void {
        this.pendingBucket = null;
        if (this.debounceTimer !== null) {
            globalThis.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private applyBucket(bucket: number): void {
        if (this.destroyed || bucket === getMermaidMaxWidth(this.view.state)) {
            return;
        }

        this.view.dispatch({
            effects: setMermaidMaxWidthEffect.of(bucket),
        });
    }

    private scheduleDebouncedBucket(bucket: number): void {
        if (this.pendingBucket === bucket && this.debounceTimer !== null) {
            return;
        }

        this.cancelPending();
        this.pendingBucket = bucket;
        this.debounceTimer = globalThis.setTimeout(() => {
            this.debounceTimer = null;
            this.pendingBucket = null;
            this.applyBucket(bucket);
        }, RESIZE_DEBOUNCE_MS);
    }

    private handleMeasuredBucket(bucket: number | null): void {
        if (this.destroyed || bucket === null) {
            return;
        }

        lastKnownWidthBucket = bucket;
        const currentBucket = getMermaidMaxWidth(this.view.state);

        if (!this.hasMeasured) {
            this.hasMeasured = true;
            if (bucket !== currentBucket) {
                this.pendingBucket = bucket;
                queueMicrotask(() => {
                    if (this.pendingBucket === bucket) {
                        this.pendingBucket = null;
                        this.applyBucket(bucket);
                    }
                });
            }
            return;
        }

        if (bucket === currentBucket) {
            this.cancelPending();
            return;
        }

        this.scheduleDebouncedBucket(bucket);
    }

    private scheduleMeasure(): void {
        this.view.requestMeasure({
            key: this.measureKey,
            read: (view): number | null => quantizeMermaidWidth(measureEditorAvailableWidth(view)),
            write: (bucket): void => {
                this.handleMeasuredBucket(bucket);
            },
        });
    }
}

const mermaidWidthPlugin = ViewPlugin.fromClass(MermaidWidthPlugin);

/**
 * Tracks a coarse, debounced editor width bucket for adaptive Mermaid diagram layout.
 */
export const mermaidWidthExtension: Extension = [mermaidWidthField, mermaidWidthPlugin];
