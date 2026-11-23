import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, LanguageDescription, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, type Decoration, type WidgetType } from '@codemirror/view';
import { vi, type Mock } from 'vitest';

import { blockRenderingExtension } from './blockRenderingField';
import * as mathRenderer from './mathRenderer';
import * as mermaidRenderer from './mermaidRenderer';
import { mermaidWidthExtension, resetLastKnownMermaidWidth, setMermaidMaxWidthEffect } from './mermaidWidth';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

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

/**
 * Spies on replacement `MermaidWidget` constructions only. Live previews of revealed blocks are
 * recreated on every edit by design, so tests about render reuse ignore them.
 */
function spyOnReplacementMermaidWidgets(): Mock {
    const calls = vi.fn();
    const OriginalWidget = mermaidRenderer.MermaidWidget;
    vi.spyOn(mermaidRenderer, 'MermaidWidget').mockImplementation(
        class extends OriginalWidget {
            public constructor(...args: ConstructorParameters<typeof OriginalWidget>) {
                super(...args);
                if (args[3] !== true) {
                    calls(...args.slice(0, 3));
                }
            }
        }
    );
    return calls;
}

function buildMermaidDoc(count: number): string {
    const sections = ['Plain text intro line'];
    for (let i = 0; i < count; i++) {
        sections.push(`\`\`\`mermaid\nflowchart LR\n  A${i} --> B${i}\n\`\`\``);
    }
    sections.push('Plain text outro line');
    return sections.join('\n\n');
}

describe('blockRenderingField caching', () => {
    beforeEach(() => {
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps Mermaid render results across selection-only updates even past the 200-entry LRU limit', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(widgetSpy).toHaveBeenCalledTimes(210);
        widgetSpy.mockClear();

        // Moving the cursor within plain text should not scan or re-render any diagrams.
        state = state.update({ selection: { anchor: 5 } }).state;
        state = state.update({ selection: { anchor: doc.length } }).state;
        expect(widgetSpy).not.toHaveBeenCalled();

        // Entering and leaving the first diagram (already evicted from the 200-entry LRU cache)
        // without editing should still reuse its cached block decoration.
        const firstFencePos = doc.indexOf('```mermaid');
        state = state.update({ selection: { anchor: firstFencePos } }).state;
        expect(countBlockDecorations(state)).toBe(209);
        state = state.update({ selection: { anchor: 0 } }).state;
        expect(countBlockDecorations(state)).toBe(210);
        expect(state.selection.main.head).toBe(0);
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('reuses a shared Mermaid render when leaving an initially revealed duplicate', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const prose = 'Plain prose before the diagrams.\n\n'.repeat(120);
        const diagram = '```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n';
        // Put both copies beyond the initial parse and follow them with enough unique diagrams
        // to evict the shared source from the renderer LRU once the full parse completes.
        const doc = prose + diagram + diagram + buildMermaidDoc(210);
        let state = createState(doc, prose.length + diagram.indexOf('Alpha'));

        expect(countBlockDecorations(state)).toBe(211);
        expect(widgetSpy).toHaveBeenCalledTimes(211);
        widgetSpy.mockClear();

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(countBlockDecorations(state)).toBe(212);
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('reuses unchanged block decorations when editing plain text past the 200-entry LRU limit', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(widgetSpy).toHaveBeenCalledTimes(210);
        widgetSpy.mockClear();

        state = state.update({
            changes: { from: 0, to: 0, insert: 'Edited ' },
            selection: { anchor: 7 },
        }).state;
        expect(state.doc.sliceString(0, 7)).toBe('Edited ');
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('retains cached renders across a partial-to-complete parse transition after a prose edit', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
        expect(countBlockDecorations(state)).toBe(210);
        expect(widgetSpy).toHaveBeenCalledTimes(210);
        widgetSpy.mockClear();

        // Force Lezer's 20ms synchronous apply budget to expire mid-parse on a prose-only edit
        // above the diagrams so blockRenderingField observes a partial syntax tree.
        let now = 1_000;
        const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            const current = now;
            now += 25;
            return current;
        });
        try {
            state = state.update({
                changes: { from: 0, to: 0, insert: 'Updated intro: ' },
                selection: { anchor: 0 },
            }).state;
        } finally {
            dateNowSpy.mockRestore();
        }

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBeLessThan(210);
        expect(widgetSpy).not.toHaveBeenCalled();

        // Finish parsing the full document and verify all 210 diagrams return from the field cache.
        ensureSyntaxTree(state, state.doc.length, 5000);
        state = state.update({}).state;

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
        expect(countBlockDecorations(state)).toBe(210);
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('evicts superseded renders in the parsed region even while the note stays partially parsed', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const tail = `\n\n${'Plain prose tail line.\n'.repeat(1000)}`;
        const doc = `Intro\n\n\`\`\`mermaid\nflowchart LR\n  Alpha --> Beta\n\`\`\`${tail}`;

        // Create state without forcing a full parse so the tail remains unparsed.
        let state = EditorState.create({
            doc,
            selection: { anchor: 0 },
            extensions: [createJoplinMarkdownExtension(), pointerRevealFreezeExtension, blockRenderingExtension],
        });

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).toHaveBeenCalledTimes(1);

        // Edit Alpha -> Gamma and leave the block while the document stays partially parsed.
        const alphaPos = doc.indexOf('Alpha');
        state = state.update({ selection: { anchor: alphaPos } }).state;
        state = state.update({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        }).state;
        state = state.update({ selection: { anchor: 0 } }).state;
        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);

        // Clear the global LRU cache and revert Gamma -> Alpha. Because the superseded Alpha
        // render was in the parsed region, it should have been evicted from the field cache.
        mermaidRenderer.clearMermaidRenderCache();
        widgetSpy.mockClear();

        const gammaPos = state.doc.toString().indexOf('Gamma');
        state = state.update({ selection: { anchor: gammaPos } }).state;
        state = state.update({
            changes: { from: gammaPos, to: gammaPos + 'Gamma'.length, insert: 'Alpha' },
            selection: { anchor: gammaPos + 'Alpha'.length },
        }).state;
        state = state.update({ selection: { anchor: 0 } }).state;

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).toHaveBeenCalledTimes(1);
        expect(widgetSpy).toHaveBeenCalledWith('flowchart LR\n  Alpha --> Beta', expect.any(Number), undefined);
    });

    it('evicts a replaced block even when the replacement extends past the parsed region', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const prefix = 'Prose before the block.\n\n'.repeat(140);
        const tail = 'Prose after the block.\n\n'.repeat(1000);
        const alpha = '```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n';
        const gamma = alpha.replace('Alpha', 'Gamma');
        const parseLimit = prefix.length + 1000;
        let state = EditorState.create({
            doc: prefix + alpha + tail,
            extensions: [createJoplinMarkdownExtension(), pointerRevealFreezeExtension, blockRenderingExtension],
        });

        ensureSyntaxTree(state, parseLimit, 5000);
        state = state.update({}).state;
        expect(syntaxTreeAvailable(state, parseLimit)).toBe(true);
        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);

        state = state.update({
            changes: { from: prefix.length, to: state.doc.length, insert: gamma + tail },
        }).state;
        ensureSyntaxTree(state, parseLimit, 5000);
        state = state.update({}).state;
        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);

        mermaidRenderer.clearMermaidRenderCache();
        widgetSpy.mockClear();
        state = state.update({
            changes: { from: prefix.length, to: state.doc.length, insert: alpha + tail },
        }).state;
        ensureSyntaxTree(state, parseLimit, 5000);
        state = state.update({}).state;

        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(
            'flowchart LR\n  Alpha --> Beta',
            expect.any(Number),
            undefined
        );
    });

    it('evicts superseded renders past a fence with a pending language parser', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const doc = 'Intro\n\n```pending\nexample\n```\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```';
        const pending = LanguageDescription.of({ name: 'pending', load: () => new Promise(() => {}) });
        let state = EditorState.create({
            doc,
            extensions: [markdown({ codeLanguages: [pending] }), pointerRevealFreezeExtension, blockRenderingExtension],
        });
        expect(syntaxTree(state).length).toBe(doc.length);
        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);

        const from = doc.indexOf('Alpha');
        state = state.update({ changes: { from, to: from + 5, insert: 'Gamma' } }).state;
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).toHaveBeenLastCalledWith('flowchart LR\n  Gamma --> Beta', expect.any(Number), undefined);

        mermaidRenderer.clearMermaidRenderCache();
        widgetSpy.mockClear();
        state = state.update({ changes: { from, to: from + 5, insert: 'Alpha' } }).state;

        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(
            'flowchart LR\n  Alpha --> Beta',
            expect.any(Number),
            undefined
        );
    });

    it.each(['rendered', 'revealed', 'revealed during the first render'])(
        'retains a shared render outside the parsed region when the remaining copy was %s',
        (initialOccurrence) => {
            const widgetSpy = spyOnReplacementMermaidWidgets();
            const prose = 'Plain prose between blocks.\n\n'.repeat(160);
            const diagram = '```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n';
            const secondBlockFrom = prose.length + diagram.length + prose.length;
            const doc = prose + diagram + prose + diagram + prose;
            const firstBody = prose.length + diagram.indexOf('Alpha');
            const renderOnSelection = initialOccurrence === 'revealed during the first render';
            const anchor = initialOccurrence === 'rendered' ? 0 : firstBody;
            let state = createState(doc, anchor, renderOnSelection ? secondBlockFrom : anchor);
            expect(widgetSpy).toHaveBeenCalledTimes(renderOnSelection ? 0 : 1);
            if (renderOnSelection) {
                state = state.update({ selection: { anchor: firstBody } }).state;
            }
            expect(countBlockDecorations(state)).toBe(initialOccurrence === 'rendered' ? 2 : 1);
            expect(widgetSpy).toHaveBeenCalledTimes(1);
            mermaidRenderer.clearMermaidRenderCache();
            widgetSpy.mockClear();

            // Stop the synchronous parse before it reaches either occurrence of the diagram.
            let now = 1000;
            const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (now += 25));
            try {
                state = state.update({
                    changes: [
                        { from: 0, insert: 'Edited prose.\n\n' },
                        { from: secondBlockFrom, to: state.doc.length, insert: prose },
                    ],
                }).state;
            } finally {
                dateNowSpy.mockRestore();
            }
            expect(syntaxTreeAvailable(state, prose.length)).toBe(false);
            expect(countBlockDecorations(state)).toBe(0);

            ensureSyntaxTree(state, state.doc.length, 5000);
            state = state.update({ selection: { anchor: 0 } }).state;
            expect(syntaxTreeAvailable(state)).toBe(true);
            expect(countBlockDecorations(state)).toBe(1);
            expect(widgetSpy).not.toHaveBeenCalled();
        }
    );

    it('skips rendering a Mermaid block while editing inside it and renders once on leave', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nOutro';
        let state = createState(doc, 0);

        expect(widgetSpy).toHaveBeenCalledTimes(1);
        widgetSpy.mockClear();

        const alphaPos = doc.indexOf('Alpha');
        state = state.update({ selection: { anchor: alphaPos } }).state;
        state = state.update({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        }).state;
        expect(widgetSpy).not.toHaveBeenCalled();

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(state.selection.main.head).toBe(0);
        expect(widgetSpy).toHaveBeenCalledTimes(1);
        expect(widgetSpy).toHaveBeenCalledWith('flowchart LR\n  Gamma --> Beta', expect.any(Number), undefined);
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

    it('keeps BlockMath render results across selection-only updates', () => {
        const renderSpy = vi.spyOn(mathRenderer, 'renderMath');
        const doc = 'Intro\n\n$$\nx^2 + y^2 = z^2\n$$\n\nOutro';
        let state = createState(doc, 0);
        const [rendered] = collectBlockDecorations(state);

        expect(renderSpy).toHaveBeenCalledTimes(1);
        renderSpy.mockClear();

        state = state.update({ selection: { anchor: 3 } }).state;
        expect(renderSpy).not.toHaveBeenCalled();

        const blockStart = doc.indexOf('$$');
        state = state.update({ selection: { anchor: blockStart + 3 } }).state;
        // Only the live preview is created while revealed, and it hits the render cache.
        expect(renderSpy).toHaveBeenCalledExactlyOnceWith('x^2 + y^2 = z^2', true);
        renderSpy.mockClear();

        state = state.update({ selection: { anchor: doc.length } }).state;
        expect(state.selection.main.head).toBe(doc.length);
        expect(collectBlockDecorations(state)).toEqual([rendered]);
        expect(renderSpy).not.toHaveBeenCalled();
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

    beforeEach(() => {
        resetLastKnownMermaidWidth();
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('recreates Mermaid widgets at the new width while reusing math decorations', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const renderMathSpy = vi.spyOn(mathRenderer, 'renderMath');
        const before = setWidth(createWidthAwareState(doc), 640);
        const beforeMath = collectBlockDecorations(before).find(
            (decoration) => widgetOf(decoration) instanceof mathRenderer.MathWidget
        );
        expect(beforeMath).toBeDefined();
        widgetSpy.mockClear();
        renderMathSpy.mockClear();

        const after = setWidth(before, 512);
        const decorations = collectBlockDecorations(after);

        expect(decorations).toHaveLength(2);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(mermaidSource, expect.any(Number), 512);
        expect(decorations).toContain(beforeMath);
        expect(renderMathSpy).not.toHaveBeenCalled();

        // The pre-change state stays usable: revealing and leaving its math block reuses its own cache.
        const mathPos = doc.indexOf('x^2');
        const revealed = before.update({ selection: { anchor: mathPos } }).state;
        renderMathSpy.mockClear();
        const branched = revealed.update({ selection: { anchor: 0 } }).state;
        expect(collectBlockDecorations(branched)).toContain(beforeMath);
        expect(renderMathSpy).not.toHaveBeenCalled();
    });

    it('keeps a revealed Mermaid block revealed across a width change and renders it at the new width on leave', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        const alphaPos = doc.indexOf('Alpha');
        let state = setWidth(createWidthAwareState(doc, alphaPos), 640);
        expect(countBlockDecorations(state)).toBe(1);
        widgetSpy.mockClear();

        state = setWidth(state, 512);
        expect(countBlockDecorations(state)).toBe(1);
        expect(widgetSpy).not.toHaveBeenCalled();

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(countBlockDecorations(state)).toBe(2);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(mermaidSource, expect.any(Number), 512);
    });

    it('applies a width change combined with a document edit in one transaction', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        let state = setWidth(createWidthAwareState(doc), 640);
        widgetSpy.mockClear();

        state = state.update({
            changes: { from: 0, insert: 'Edited ' },
            effects: setMermaidMaxWidthEffect.of(512),
        }).state;

        expect(countBlockDecorations(state)).toBe(2);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(mermaidSource, expect.any(Number), 512);
    });

    it('drops cached Mermaid decorations for the previous width', () => {
        const widgetSpy = spyOnReplacementMermaidWidgets();
        let state = setWidth(createWidthAwareState(doc), 640);
        state = setWidth(state, 512);
        widgetSpy.mockClear();

        state = setWidth(state, 640);

        expect(countBlockDecorations(state)).toBe(2);
        expect(widgetSpy).toHaveBeenCalledExactlyOnceWith(mermaidSource, expect.any(Number), 640);
    });
});
