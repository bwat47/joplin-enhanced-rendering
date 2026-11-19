import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

import { enhancedRenderingExtension } from './enhancedRendering';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

function createView(doc: string, cursorPos = 0): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);

    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: { anchor: cursorPos },
            extensions: [createJoplinMarkdownExtension(), enhancedRenderingExtension],
        }),
    });
}

describe('pointerRevealFreezeExtension', () => {
    let views: EditorView[] = [];
    let rafCallbacks: FrameRequestCallback[] = [];
    let nextFrameId = 1;

    const track = (view: EditorView): EditorView => {
        views.push(view);
        return view;
    };

    const flushAnimationFrames = (): void => {
        while (rafCallbacks.length > 0) {
            const callback = rafCallbacks.shift()!;
            callback(0);
        }
    };

    beforeEach(() => {
        rafCallbacks = [];
        nextFrameId = 1;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            rafCallbacks.push(callback);
            return nextFrameId++;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        for (const view of views) {
            view.destroy();
            view.dom.parentElement?.remove();
        }
        views = [];
    });

    it('keeps Mermaid, block math, and inline math rendered during a left-button drag and reveals on mouseup', () => {
        const doc = 'Top\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n$$\nx^2\n$$\n\nInline $a + b$ end.';
        const view = track(createView(doc, 0));

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-mermaid')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(1);

        // Start left-button mouse gesture.
        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));

        // Drag selection across the whole document via pointer selection.
        view.dispatch({
            selection: { anchor: 0, head: doc.length },
            userEvent: 'select.pointer',
        });

        // All rendered widgets stay frozen while left mouse button is still held.
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-mermaid')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(1);

        // Release left mouse button and flush rAF -> all intersecting widgets expand.
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        flushAnimationFrames();

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-mermaid')).toHaveLength(0);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(0);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(0);
        expect(view.state.selection.main.from).toBe(0);
        expect(view.state.selection.main.to).toBe(doc.length);
    });

    it('never flashes markup if the drag sweeps across a widget and returns before mouseup', () => {
        const doc = 'Top\n\n$$\nx^2\n$$\n\nBottom';
        const view = track(createView(doc, 0));

        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));

        // Sweep across the block math.
        view.dispatch({ selection: { anchor: 0, head: doc.length }, userEvent: 'select.pointer' });
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);

        // Drag back to line 1 before releasing.
        view.dispatch({ selection: { anchor: 0, head: 3 }, userEvent: 'select.pointer' });
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        flushAnimationFrames();

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);
    });

    it('ignores non-left mouse buttons', () => {
        const doc = 'Top\n\n$$\nx^2\n$$\n\nBottom';
        const view = track(createView(doc, 0));

        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
        view.dispatch({ selection: { anchor: 0, head: doc.length }, userEvent: 'select.pointer' });

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(0);
    });

    it('releases freeze on mousemove with buttons === 0 or window blur', () => {
        const doc = 'Top\n\n$$\nx^2\n$$\n\nBottom';
        const view = track(createView(doc, 0));

        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
        view.dispatch({ selection: { anchor: 0, head: doc.length }, userEvent: 'select.pointer' });
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);

        // Pointer released outside window, then mouse moves back with buttons === 0.
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 0 }));
        flushAnimationFrames();

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(0);

        // Reset and test window blur safety release.
        view.dispatch({ selection: { anchor: 0 } });
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);

        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
        view.dispatch({ selection: { anchor: 0, head: doc.length }, userEvent: 'select.pointer' });
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(1);

        window.dispatchEvent(new Event('blur'));
        flushAnimationFrames();

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(0);
    });

    it('clears freeze immediately on non-pointer selection changes', () => {
        const doc = 'Top\n\n$$\nx^2\n$$\n\nBottom';
        const view = track(createView(doc, 0));

        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
        view.dispatch({ selection: { anchor: doc.indexOf('x^2') }, userEvent: 'select' });

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math-block')).toHaveLength(0);
    });
});
