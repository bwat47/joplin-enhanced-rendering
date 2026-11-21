import type { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { clearFrozenSelectionEffect } from './pointerRevealFreeze';

/**
 * Small bounded LRU cache used to memoize rendered SVG/HTML outputs across editor updates.
 */
export class LruCache<K, V> {
    private readonly entries = new Map<K, V>();

    public constructor(private readonly maxEntries = 200) {}

    public get(key: K): V | undefined {
        const value = this.entries.get(key);
        if (value !== undefined) {
            this.entries.delete(key);
            this.entries.set(key, value);
        }
        return value;
    }

    /** Reads a value without refreshing its recency. */
    public peek(key: K): V | undefined {
        return this.entries.get(key);
    }

    public set(key: K, value: V): void {
        if (this.entries.has(key)) {
            this.entries.delete(key);
        } else if (this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey !== undefined) {
                this.entries.delete(oldestKey);
            }
        }
        this.entries.set(key, value);
    }

    public clear(): void {
        this.entries.clear();
    }
}

/**
 * Returns true if any range in `selection` touches or overlaps `[from, to]` (inclusive).
 */
export function rangeIntersectsSelection(selection: EditorSelection, from: number, to: number): boolean {
    for (const range of selection.ranges) {
        if (range.from <= to && range.to >= from) {
            return true;
        }
    }
    return false;
}

const CLICK_DRAG_THRESHOLD_PX = 5;

function isOnHorizontalScrollbar(element: HTMLElement, event: MouseEvent): boolean {
    if (element.scrollWidth <= element.clientWidth) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return event.clientY >= rect.top + element.clientTop + element.clientHeight;
}

/**
 * Moves the CodeMirror selection inside the widget's replaced document range when clicked,
 * causing the live-preview decoration to expand back into raw Markdown for editing.
 */
export function attachEditOnClick(element: HTMLElement, view: EditorView, editOffset: number): void {
    let pointerDownPoint: { x: number; y: number } | null = null;

    element.addEventListener('mousedown', (event: MouseEvent) => {
        if (event.button !== 0 || isOnHorizontalScrollbar(element, event)) {
            pointerDownPoint = null;
            return;
        }

        // Prevent native contenteditable caret placement and accidental SVG/KaTeX text selection
        // so the widget stays mounted until release and clicks land reliably at `editOffset`.
        event.preventDefault();
        pointerDownPoint = { x: event.clientX, y: event.clientY };
    });

    element.addEventListener('click', (event: MouseEvent) => {
        if (event.button !== 0 || isOnHorizontalScrollbar(element, event)) {
            return;
        }

        if (pointerDownPoint) {
            const dx = Math.abs(event.clientX - pointerDownPoint.x);
            const dy = Math.abs(event.clientY - pointerDownPoint.y);
            pointerDownPoint = null;
            if (dx > CLICK_DRAG_THRESHOLD_PX || dy > CLICK_DRAG_THRESHOLD_PX) {
                return;
            }
        }

        event.preventDefault();
        const basePos = view.posAtDOM(element);
        const anchor = Math.max(0, Math.min(basePos + editOffset, view.state.doc.length));
        view.dispatch({
            selection: { anchor },
            effects: clearFrozenSelectionEffect(),
            scrollIntoView: false,
        });
        view.focus();
    });
}

/**
 * Strips up to `indent` characters of leading indentation matching `prefix` from each line.
 * Used for fenced code blocks indented inside list items.
 *
 * Examples:
 * - `dedentLines('  A --> B\n  B --> C', '  ')` → `'A --> B\nB --> C'`
 * - `dedentLines('A --> B', '')` → `'A --> B'`
 */
export function dedentLines(text: string, prefix: string): string {
    if (prefix.length === 0) {
        return text;
    }

    return text
        .split('\n')
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
        .join('\n');
}
