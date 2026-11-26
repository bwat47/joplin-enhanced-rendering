import { syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { renderToString } from 'katex';
import type * as Katex from 'katex';
import { render as renderPele } from 'pele';
import type * as Pele from 'pele';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enhancedRenderingExtension } from './enhancedRendering';
import { clearMathRenderCache, MathWidget } from './mathRenderer';
import { clearMermaidRenderCache, MermaidWidget } from './mermaidRenderer';
import { resetLastKnownMermaidWidth } from './mermaidWidth';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';
import { RENDERED_MERMAID } from './testing/selectors';

// Count real Pele and KaTeX work: the renderers call these from inside their own modules,
// where a namespace spy cannot observe them.
vi.mock('pele', async (importOriginal) => {
    const pele = await importOriginal<typeof Pele>();
    return { ...pele, render: vi.fn(pele.render) };
});
vi.mock('katex', async (importOriginal) => {
    const katex = await importOriginal<typeof Katex>();
    return { ...katex, renderToString: vi.fn(katex.renderToString) };
});

(EditorView as unknown as { EDIT_CONTEXT: boolean }).EDIT_CONTEXT = false;

interface RenderCounts {
    /** Pele renders (Mermaid render cache misses). */
    pele: number;
    /** KaTeX renders (math render cache misses). */
    katex: number;
    /** Mermaid widget DOM creations, replacements and previews combined. */
    mermaidToDom: number;
    /** Display math widget DOM creations, replacements and previews combined. */
    mathToDom: number;
}

interface RenderCounter {
    reset(): void;
    read(): RenderCounts;
}

function createRenderCounter(): RenderCounter {
    const pele = vi.mocked(renderPele);
    const katex = vi.mocked(renderToString);
    const mermaidToDom = vi.spyOn(MermaidWidget.prototype, 'toDOM');
    const mathToDom = vi.spyOn(MathWidget.prototype, 'toDOM');
    const spies = [pele, katex, mermaidToDom, mathToDom];

    return {
        reset(): void {
            for (const spy of spies) {
                spy.mockClear();
            }
        },
        read(): RenderCounts {
            return {
                pele: pele.mock.calls.length,
                katex: katex.mock.calls.length,
                mermaidToDom: mermaidToDom.mock.calls.length,
                mathToDom: mathToDom.mock.calls.length,
            };
        },
    };
}

/** Waits two animation frames so CodeMirror measure/update cycles and widget callbacks settle. */
function nextFrames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitForFullParse(view: EditorView): Promise<void> {
    for (let i = 0; i < 500 && !syntaxTreeAvailable(view.state); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(syntaxTreeAvailable(view.state)).toBe(true);
    await nextFrames();
}

function createScrollingView(doc: string, cursorPos = 0, height = 400): EditorView {
    const parent = document.createElement('div');
    parent.style.width = '700px';
    document.body.append(parent);

    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: { anchor: cursorPos },
            extensions: [
                createJoplinMarkdownExtension(),
                EditorView.theme({
                    '&': { height: `${height}px` },
                    '& .cm-scroller': { overflow: 'auto' },
                }),
                enhancedRenderingExtension,
            ],
        }),
    });
}

/** Types `text` one character per transaction at `pos`, letting the view update after each key. */
async function typeAt(view: EditorView, pos: number, text: string): Promise<void> {
    for (let i = 0; i < text.length; i++) {
        view.dispatch({
            changes: { from: pos + i, insert: text[i]! },
            selection: { anchor: pos + i + 1 },
            userEvent: 'input.type',
        });
        await nextFrames();
    }
}

async function moveCursor(view: EditorView, pos: number): Promise<void> {
    view.dispatch({ selection: { anchor: pos }, userEvent: 'select' });
    await nextFrames();
}

/** Scrolls from top to bottom in viewport-sized steps so every block widget mounts once. */
async function scrollThrough(view: EditorView): Promise<void> {
    const step = view.scrollDOM.clientHeight;
    for (let top = 0; top < view.scrollDOM.scrollHeight; top += step) {
        view.scrollDOM.scrollTop = top;
        await nextFrames();
    }
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    await nextFrames();
}

function mermaidBlock(label: string): string {
    return `\`\`\`mermaid\nflowchart LR\n  ${label}A[Start] --> ${label}B[End]\n\`\`\``;
}

function mathBlock(label: string): string {
    return `$$\n\\frac{${label} + 1}{${label} + 2}\n$$`;
}

/** Interleaves prose paragraphs with the given blocks. */
function buildDoc(blocks: readonly string[]): string {
    return ['Intro paragraph.', ...blocks.flatMap((block, i) => [block, `Paragraph ${i + 1}.`])].join('\n\n');
}

describe('block rendering work (browser)', () => {
    let views: EditorView[] = [];
    let counter: RenderCounter;

    const track = (view: EditorView): EditorView => {
        views.push(view);
        return view;
    };

    beforeEach(() => {
        clearMermaidRenderCache();
        clearMathRenderCache();
        resetLastKnownMermaidWidth();
        counter = createRenderCounter();
    });

    afterEach(() => {
        for (const view of views) {
            view.destroy();
            view.dom.parentElement?.remove();
        }
        views = [];
        vi.restoreAllMocks();
    });

    it('does no render or DOM work while typing prose between visible blocks', async () => {
        const doc = buildDoc([mermaidBlock('x'), mathBlock('a'), mermaidBlock('y'), mathBlock('b')]);
        const view = track(createScrollingView(doc, 0, 2000));
        await waitForFullParse(view);
        counter.reset();

        await typeAt(view, doc.indexOf('Paragraph 2.'), 'typing in prose ');

        expect(counter.read()).toEqual({ pele: 0, katex: 0, mermaidToDom: 0, mathToDom: 0 });
    });

    it('does no render or DOM work while typing prose between visible duplicate blocks', async () => {
        const doc = buildDoc([
            mermaidBlock('d'),
            mathBlock('m'),
            mermaidBlock('d'),
            mathBlock('m'),
            mermaidBlock('d'),
            mathBlock('m'),
        ]);
        const view = track(createScrollingView(doc, 0, 2000));
        await waitForFullParse(view);
        counter.reset();

        await typeAt(view, doc.indexOf('Paragraph 3.'), 'typing in prose ');

        expect(counter.read()).toEqual({ pele: 0, katex: 0, mermaidToDom: 0, mathToDom: 0 });
    });

    it('reuses renders when entering and leaving duplicate blocks', async () => {
        const doc = buildDoc([mermaidBlock('d'), mathBlock('m'), mermaidBlock('d'), mathBlock('m')]);
        const view = track(createScrollingView(doc, 0, 2000));
        await waitForFullParse(view);
        counter.reset();

        // Enter and leave each duplicate in turn (each entry shows a live preview).
        let searchFrom = 0;
        for (const marker of ['dA[Start]', '\\frac{m', 'dA[Start]', '\\frac{m']) {
            const pos = view.state.doc.toString().indexOf(marker, searchFrom);
            searchFrom = pos + 1;
            await moveCursor(view, pos);
            await moveCursor(view, 0);
        }

        // One DOM build per preview and per re-rendered replacement, all served from the render caches.
        expect(counter.read()).toEqual({ pele: 0, katex: 0, mermaidToDom: 4, mathToDom: 4 });
    });

    it('renders only the edited block when editing inside one duplicate', async () => {
        const doc = buildDoc([mermaidBlock('d'), mermaidBlock('d'), mermaidBlock('d')]);
        const view = track(createScrollingView(doc, 0, 2000));
        await waitForFullParse(view);
        counter.reset();

        const secondStart = doc.indexOf('dB[End]', doc.indexOf('dB[End]') + 1);
        await moveCursor(view, secondStart);
        await typeAt(view, secondStart, 'Z');
        await moveCursor(view, 0);

        // Preview on entry, preview of the edited source, replacement on leave; only the new source renders.
        expect(counter.read()).toEqual({ pele: 1, katex: 0, mermaidToDom: 3, mathToDom: 0 });
    });

    it('re-renders only visible Mermaid diagrams on a width change', async () => {
        const blocks = Array.from({ length: 30 }, (_, i) => mermaidBlock(`w${i}`));
        const doc = buildDoc(blocks);
        const view = track(createScrollingView(doc));
        await waitForFullParse(view);
        counter.reset();

        view.dom.parentElement!.style.width = '360px';
        await new Promise((resolve) => setTimeout(resolve, 300));
        await nextFrames();

        const mounted = view.dom.querySelectorAll(RENDERED_MERMAID).length;
        expect(mounted).toBeLessThan(blocks.length);
        // Mounted diagrams update in place through `updateDOM`; off-screen ones stay unrendered.
        expect(counter.read()).toEqual({ pele: mounted, katex: 0, mermaidToDom: 0, mathToDom: 0 });
    });

    it('keeps rendered widgets and scroll position when typing above the viewport in a long note', async () => {
        const blocks = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? mermaidBlock(`p${i}`) : mathBlock(`p${i}`)));
        const filler = Array.from({ length: 20 }, (_, i) => `Filler line ${i}.`).join('\n\n');
        const doc = buildDoc(blocks.map((block) => `${filler}\n\n${block}`));
        const view = track(createScrollingView(doc));
        await waitForFullParse(view);

        // Mount everything once so later work reflects reuse rather than first renders.
        await scrollThrough(view);
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight / 2;
        await nextFrames();

        // Track a visible line by number: the edit shifts every document position below it.
        const anchorLineNumber = view.state.doc.lineAt(
            view.lineBlockAtHeight(view.scrollDOM.scrollTop + 50).from
        ).number;
        const anchorTop = (): number => view.coordsAtPos(view.state.doc.line(anchorLineNumber).from)!.top;
        const anchorBefore = anchorTop();
        counter.reset();

        await typeAt(view, doc.indexOf('Filler line 3.'), 'edit above ');
        await waitForFullParse(view);

        expect(counter.read()).toEqual({ pele: 0, katex: 0, mermaidToDom: 0, mathToDom: 0 });
        expect(Math.abs(anchorTop() - anchorBefore)).toBeLessThan(1);
    });

    it('renders each diagram at most once when rescrolling a note larger than the render cache', async () => {
        const blocks = Array.from({ length: 220 }, (_, i) => mermaidBlock(`n${i}`));
        const doc = buildDoc(blocks);
        const view = track(createScrollingView(doc));
        await waitForFullParse(view);

        await scrollThrough(view);
        await typeAt(view, view.state.doc.length, ' end');
        counter.reset();

        view.scrollDOM.scrollTop = 0;
        await nextFrames();
        await scrollThrough(view);

        // The edit rebuilt every widget, and 220 distinct diagrams overflow the 200-entry render
        // cache, so each re-mount may render again, but never more than once.
        const counts = counter.read();
        expect(counts.mermaidToDom).toBe(blocks.length);
        expect(counts.pele).toBeLessThanOrEqual(blocks.length);
    });
});
