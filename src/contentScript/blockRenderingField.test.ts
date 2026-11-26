import { ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, type Decoration, type DecorationSet, type WidgetType } from '@codemirror/view';
import { renderToString } from 'katex';
import type * as Katex from 'katex';
import { vi } from 'vitest';

import { blockRenderingExtension } from './blockRenderingField';
import * as mathRenderer from './mathRenderer';
import * as mermaidRenderer from './mermaidRenderer';
import {
    getMermaidMaxWidth,
    mermaidWidthExtension,
    resetLastKnownMermaidWidth,
    setMermaidMaxWidthEffect,
} from './mermaidWidth';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

// Count real KaTeX work: `MathWidget` calls `renderMath` from inside its own module, where a
// namespace spy cannot observe it.
vi.mock('katex', async (importOriginal) => {
    const katex = await importOriginal<typeof Katex>();
    return { ...katex, renderToString: vi.fn(katex.renderToString) };
});

function createState(doc: string, anchor = 0, head = anchor): EditorState {
    const state = EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [createJoplinMarkdownExtension(), pointerRevealFreezeExtension, blockRenderingExtension],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    // Apply an empty transaction so blockRenderingField observes the completed syntax tree,
    // matching CodeMirror's background parse update in a live EditorView.
    return state.update({}).state;
}

function createWidthAwareState(doc: string, anchor = 0): EditorState {
    const state = EditorState.create({
        doc,
        selection: { anchor },
        extensions: [
            createJoplinMarkdownExtension(),
            pointerRevealFreezeExtension,
            mermaidWidthExtension,
            blockRenderingExtension,
        ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return state.update({}).state;
}

function setWidth(state: EditorState, width: number | null): EditorState {
    return state.update({ effects: setMermaidMaxWidthEffect.of(width) }).state;
}

interface CollectedDecoration {
    readonly from: number;
    readonly to: number;
    readonly value: Decoration;
}

function collectDecorationRanges(state: EditorState): CollectedDecoration[] {
    const ranges: CollectedDecoration[] = [];
    for (const source of state.facet(EditorView.decorations)) {
        if (typeof source !== 'function') {
            for (const iter = source.iter(); iter.value; iter.next()) {
                ranges.push({ from: iter.from, to: iter.to, value: iter.value });
            }
        }
    }
    return ranges;
}

/** Block replacement decorations, excluding the point widgets that preview revealed blocks. */
function collectBlockDecorations(state: EditorState): Decoration[] {
    return collectDecorationRanges(state)
        .filter((range) => range.from < range.to)
        .map((range) => range.value);
}

function collectPreviewDecorations(state: EditorState): CollectedDecoration[] {
    return collectDecorationRanges(state).filter((range) => range.from === range.to);
}

function widgetOf(decoration: Decoration): WidgetType {
    return (decoration.spec as { widget: WidgetType }).widget;
}

function countBlockDecorations(state: EditorState): number {
    return collectBlockDecorations(state).length;
}

function blockDecorationSet(state: EditorState): DecorationSet {
    const [set] = state.facet(EditorView.decorations).filter((source) => typeof source !== 'function');
    return set as DecorationSet;
}

function blockWidgets(state: EditorState): WidgetType[] {
    return collectBlockDecorations(state).map(widgetOf);
}

/** Asserts CodeMirror would keep each mounted widget's DOM: same count, pairwise `eq`. */
function expectEqWidgets(next: readonly WidgetType[], previous: readonly WidgetType[]): void {
    expect(next).toHaveLength(previous.length);
    next.forEach((widget, i) => expect(widget.eq(previous[i]!)).toBe(true));
}

function buildMermaidDoc(count: number): string {
    const sections = ['Plain text intro line'];
    for (let i = 0; i < count; i++) {
        sections.push(`\`\`\`mermaid\nflowchart LR\n  A${i} --> B${i}\n\`\`\``);
    }
    sections.push('Plain text outro line');
    return sections.join('\n\n');
}

describe('blockRenderingField decoration rebuilds', () => {
    const duplicateDoc = [
        'Intro',
        '```mermaid\nflowchart LR\n  Alpha --> Beta\n```',
        '$$\nx^2\n$$',
        'Middle',
        '```mermaid\nflowchart LR\n  Alpha --> Beta\n```',
        '$$\nx^2\n$$',
        'Outro',
    ].join('\n\n');

    beforeEach(() => {
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the decoration set when a selection change reveals no block', () => {
        const doc = buildMermaidDoc(3);
        let state = createState(doc, 0);
        const decorations = blockDecorationSet(state);

        state = state.update({ selection: { anchor: 5 } }).state;
        state = state.update({ selection: { anchor: doc.length } }).state;

        expect(blockDecorationSet(state)).toBe(decorations);
    });

    it('rebuilds equal widgets for unchanged and duplicate blocks after a prose edit', () => {
        let state = createState(duplicateDoc, 0);
        const before = collectBlockDecorations(state);
        expect(before).toHaveLength(4);

        state = state.update({ changes: { from: 0, insert: 'Edited ' }, selection: { anchor: 7 } }).state;

        expectEqWidgets(blockWidgets(state), before.map(widgetOf));
    });

    it('rebuilds equal widgets when leaving a revealed duplicate', () => {
        let state = createState(duplicateDoc, 0);
        const before = blockWidgets(state);

        state = state.update({ selection: { anchor: duplicateDoc.lastIndexOf('Alpha') } }).state;
        expect(blockWidgets(state)).toHaveLength(3);
        state = state.update({ selection: { anchor: 0 } }).state;

        expectEqWidgets(blockWidgets(state), before);
    });

    it('restores every block decoration once a partial parse completes', () => {
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);
        const before = blockWidgets(state);
        expect(before).toHaveLength(210);

        // Force Lezer's 20ms synchronous apply budget to expire mid-parse on a prose-only edit
        // above the diagrams so blockRenderingField observes a partial syntax tree.
        let now = 1_000;
        const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (now += 25));
        try {
            state = state.update({ changes: { from: 0, insert: 'Updated intro: ' }, selection: { anchor: 0 } }).state;
        } finally {
            dateNowSpy.mockRestore();
        }
        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBeLessThan(210);

        ensureSyntaxTree(state, state.doc.length, 5000);
        state = state.update({}).state;

        expectEqWidgets(blockWidgets(state), before);
    });

    it('renders the edited source once the cursor leaves a block edited in place', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nOutro';
        let state = createState(doc, 0);
        const { editOffset } = blockWidgets(state)[0] as mermaidRenderer.MermaidWidget;

        const alphaPos = doc.indexOf('Alpha');
        state = state.update({ selection: { anchor: alphaPos } }).state;
        state = state.update({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        }).state;
        expect(countBlockDecorations(state)).toBe(0);

        state = state.update({ selection: { anchor: 0 } }).state;
        expectEqWidgets(blockWidgets(state), [
            new mermaidRenderer.MermaidWidget('flowchart LR\n  Gamma --> Beta', editOffset),
        ]);
    });

    it('builds Mermaid decorations without rendering until a view mounts them', () => {
        const state = createState(buildMermaidDoc(3), 0);
        const widgets: mermaidRenderer.MermaidWidget[] = [];
        for (const source of state.facet(EditorView.decorations)) {
            if (typeof source !== 'function') {
                for (const iter = source.iter(); iter.value; iter.next()) {
                    widgets.push((iter.value.spec as { widget: mermaidRenderer.MermaidWidget }).widget);
                }
            }
        }

        expect(widgets).toHaveLength(3);
        // No render has happened, so neither the widget nor the shared cache knows a height yet.
        expect(widgets.map((widget) => widget.estimatedHeight)).toEqual([-1, -1, -1]);
    });

    it('builds BlockMath decorations and previews without running KaTeX until a view mounts them', () => {
        const katexSpy = vi.mocked(renderToString);
        katexSpy.mockClear();
        const doc = 'Intro\n\n$$\nx^2 + y^2 = z^2\n$$\n\nOutro';
        let state = createState(doc, 0);
        const [rendered] = collectBlockDecorations(state);

        const blockStart = doc.indexOf('$$');
        state = state.update({ selection: { anchor: blockStart + 3 } }).state;
        expect(collectPreviewDecorations(state)).toHaveLength(1);

        state = state.update({ selection: { anchor: doc.length } }).state;
        expect(state.selection.main.head).toBe(doc.length);
        expect(collectBlockDecorations(state)).toEqual([rendered]);
        expect(katexSpy).not.toHaveBeenCalled();

        const view = new EditorView({ parent: document.createElement('div') });
        try {
            widgetOf(rendered!).toDOM(view);
        } finally {
            view.destroy();
        }
        expect(katexSpy).toHaveBeenCalledExactlyOnceWith(
            'x^2 + y^2 = z^2',
            expect.objectContaining({ displayMode: true })
        );
    });
});

describe('blockRenderingField live previews', () => {
    const mermaidSource = 'flowchart LR\n  Alpha --> Beta';
    const doc = `Intro\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\`\n\n$$\nx^2\n$$\n\nOutro`;
    const mermaidEnd = doc.indexOf('```\n\n$$') + 3;

    beforeEach(() => {
        resetLastKnownMermaidWidth();
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
    });

    it('places a block preview widget after the closing line of each revealed block', () => {
        const state = createState(doc, doc.indexOf('Alpha'), doc.indexOf('x^2'));

        const previews = collectPreviewDecorations(state);
        expect(previews.map((preview) => preview.from)).toEqual([mermaidEnd, doc.indexOf('\n\nOutro')]);
        for (const preview of previews) {
            expect(preview.value.spec).toMatchObject({ block: true, side: 1 });
        }
        expect(
            widgetOf(previews[0]!.value).eq(new mermaidRenderer.MermaidWidget(mermaidSource, 0, undefined, true))
        ).toBe(true);
        expect(countBlockDecorations(state)).toBe(0);

        const left = state.update({ selection: { anchor: 0 } }).state;
        expect(collectPreviewDecorations(left)).toHaveLength(0);
        expect(countBlockDecorations(left)).toBe(2);
    });

    it('keeps the preview decoration while the cursor moves within a revealed block', () => {
        let state = createState(doc, doc.indexOf('Alpha'));
        const [preview] = collectPreviewDecorations(state);

        state = state.update({ selection: { anchor: doc.indexOf('Beta') } }).state;

        expect(collectPreviewDecorations(state).map((range) => range.value)).toEqual([preview!.value]);
    });

    it('recreates a revealed Mermaid preview at the new width', () => {
        let state = setWidth(createWidthAwareState(doc, doc.indexOf('Alpha')), 640);

        state = setWidth(state, 512);

        const [preview] = collectPreviewDecorations(state);
        expect(widgetOf(preview!.value).eq(new mermaidRenderer.MermaidWidget(mermaidSource, 0, 512, true))).toBe(true);
    });
});

describe('blockRenderingField Mermaid width changes', () => {
    const mermaidSource = 'flowchart LR\n  Alpha --> Beta';
    const doc = `Intro\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\`\n\n$$\nx^2 + y^2 = z^2\n$$\n\nOutro`;
    const editOffset = doc.indexOf('flowchart') - doc.indexOf('```');

    beforeEach(() => {
        resetLastKnownMermaidWidth();
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
    });

    it('recreates Mermaid widgets at the new width and keeps math widgets equal', () => {
        const before = setWidth(createWidthAwareState(doc), 640);
        const [, beforeMath] = blockWidgets(before);

        const after = setWidth(before, 512);

        expect(getMermaidMaxWidth(after)).toBe(512);
        expectEqWidgets(blockWidgets(after), [
            new mermaidRenderer.MermaidWidget(mermaidSource, editOffset, 512),
            beforeMath!,
        ]);
    });

    it('keeps a revealed Mermaid block revealed across a width change and renders it at the new width on leave', () => {
        let state = setWidth(createWidthAwareState(doc, doc.indexOf('Alpha')), 640);
        expect(countBlockDecorations(state)).toBe(1);

        state = setWidth(state, 512);
        expect(countBlockDecorations(state)).toBe(1);

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(blockWidgets(state)[0]!.eq(new mermaidRenderer.MermaidWidget(mermaidSource, editOffset, 512))).toBe(
            true
        );
    });

    it('applies a width change combined with a document edit in one transaction', () => {
        let state = setWidth(createWidthAwareState(doc), 640);

        state = state.update({
            changes: { from: 0, insert: 'Edited ' },
            effects: setMermaidMaxWidthEffect.of(512),
        }).state;

        expect(countBlockDecorations(state)).toBe(2);
        expect(blockWidgets(state)[0]!.eq(new mermaidRenderer.MermaidWidget(mermaidSource, editOffset, 512))).toBe(
            true
        );
    });
});
