import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, LanguageDescription, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

import { blockRenderingExtension } from './blockRenderingField';
import * as mathRenderer from './mathRenderer';
import * as mermaidRenderer from './mermaidRenderer';
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

function countBlockDecorations(state: EditorState): number {
    let count = 0;
    for (const source of state.facet(EditorView.decorations)) {
        if (typeof source !== 'function') {
            for (const iter = source.iter(); iter.value; iter.next()) {
                count++;
            }
        }
    }
    return count;
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
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(renderSpy).toHaveBeenCalledTimes(210);
        renderSpy.mockClear();

        // Moving the cursor within plain text should not scan or re-render any diagrams.
        state = state.update({ selection: { anchor: 5 } }).state;
        state = state.update({ selection: { anchor: doc.length } }).state;
        expect(renderSpy).not.toHaveBeenCalled();

        // Entering and leaving the first diagram (already evicted from the 200-entry LRU cache)
        // without editing should still reuse its cached block decoration.
        const firstFencePos = doc.indexOf('```mermaid');
        state = state.update({ selection: { anchor: firstFencePos } }).state;
        expect(countBlockDecorations(state)).toBe(209);
        state = state.update({ selection: { anchor: 0 } }).state;
        expect(countBlockDecorations(state)).toBe(210);
        expect(state.selection.main.head).toBe(0);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('reuses a shared Mermaid render when leaving an initially revealed duplicate', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
        const prose = 'Plain prose before the diagrams.\n\n'.repeat(120);
        const diagram = '```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n';
        // Put both copies beyond the initial parse and follow them with enough unique diagrams
        // to evict the shared source from the renderer LRU once the full parse completes.
        const doc = prose + diagram + diagram + buildMermaidDoc(210);
        let state = createState(doc, prose.length + diagram.indexOf('Alpha'));

        expect(countBlockDecorations(state)).toBe(211);
        expect(renderSpy).toHaveBeenCalledTimes(211);
        renderSpy.mockClear();

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(countBlockDecorations(state)).toBe(212);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('reuses unchanged block decorations when editing plain text past the 200-entry LRU limit', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(renderSpy).toHaveBeenCalledTimes(210);
        renderSpy.mockClear();

        state = state.update({
            changes: { from: 0, to: 0, insert: 'Edited ' },
            selection: { anchor: 7 },
        }).state;
        expect(state.doc.sliceString(0, 7)).toBe('Edited ');
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('retains cached renders across a partial-to-complete parse transition after a prose edit', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
        const doc = buildMermaidDoc(210);
        let state = createState(doc, 0);

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
        expect(countBlockDecorations(state)).toBe(210);
        expect(renderSpy).toHaveBeenCalledTimes(210);
        renderSpy.mockClear();

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
        expect(renderSpy).not.toHaveBeenCalled();

        // Finish parsing the full document and verify all 210 diagrams return from the field cache.
        ensureSyntaxTree(state, state.doc.length, 5000);
        state = state.update({}).state;

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
        expect(countBlockDecorations(state)).toBe(210);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('evicts superseded renders in the parsed region even while the note stays partially parsed', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
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
        expect(renderSpy).toHaveBeenCalledTimes(1);

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
        renderSpy.mockClear();

        const gammaPos = state.doc.toString().indexOf('Gamma');
        state = state.update({ selection: { anchor: gammaPos } }).state;
        state = state.update({
            changes: { from: gammaPos, to: gammaPos + 'Gamma'.length, insert: 'Alpha' },
            selection: { anchor: gammaPos + 'Alpha'.length },
        }).state;
        state = state.update({ selection: { anchor: 0 } }).state;

        expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(renderSpy).toHaveBeenCalledWith('flowchart LR\n  Alpha --> Beta');
    });

    it('evicts a replaced block even when the replacement extends past the parsed region', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
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
        renderSpy.mockClear();
        state = state.update({
            changes: { from: prefix.length, to: state.doc.length, insert: alpha + tail },
        }).state;
        ensureSyntaxTree(state, parseLimit, 5000);
        state = state.update({}).state;

        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(renderSpy).toHaveBeenCalledExactlyOnceWith('flowchart LR\n  Alpha --> Beta');
    });

    it('evicts superseded renders past a fence with a pending language parser', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
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
        expect(renderSpy).toHaveBeenLastCalledWith('flowchart LR\n  Gamma --> Beta');

        mermaidRenderer.clearMermaidRenderCache();
        renderSpy.mockClear();
        state = state.update({ changes: { from, to: from + 5, insert: 'Alpha' } }).state;

        expect(syntaxTreeAvailable(state)).toBe(false);
        expect(countBlockDecorations(state)).toBe(1);
        expect(renderSpy).toHaveBeenCalledExactlyOnceWith('flowchart LR\n  Alpha --> Beta');
    });

    it.each(['rendered', 'revealed', 'revealed during the first render'])(
        'retains a shared render outside the parsed region when the remaining copy was %s',
        (initialOccurrence) => {
            const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
            const prose = 'Plain prose between blocks.\n\n'.repeat(160);
            const diagram = '```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n';
            const secondBlockFrom = prose.length + diagram.length + prose.length;
            const doc = prose + diagram + prose + diagram + prose;
            const firstBody = prose.length + diagram.indexOf('Alpha');
            const renderOnSelection = initialOccurrence === 'revealed during the first render';
            const anchor = initialOccurrence === 'rendered' ? 0 : firstBody;
            let state = createState(doc, anchor, renderOnSelection ? secondBlockFrom : anchor);
            expect(renderSpy).toHaveBeenCalledTimes(renderOnSelection ? 0 : 1);
            if (renderOnSelection) {
                state = state.update({ selection: { anchor: firstBody } }).state;
            }
            expect(countBlockDecorations(state)).toBe(initialOccurrence === 'rendered' ? 2 : 1);
            expect(renderSpy).toHaveBeenCalledTimes(1);
            mermaidRenderer.clearMermaidRenderCache();
            renderSpy.mockClear();

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
            expect(renderSpy).not.toHaveBeenCalled();
        }
    );

    it('skips rendering a Mermaid block while editing inside it and renders once on leave', () => {
        const renderSpy = vi.spyOn(mermaidRenderer, 'renderMermaid');
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nOutro';
        let state = createState(doc, 0);

        expect(renderSpy).toHaveBeenCalledTimes(1);
        renderSpy.mockClear();

        const alphaPos = doc.indexOf('Alpha');
        state = state.update({ selection: { anchor: alphaPos } }).state;
        state = state.update({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        }).state;
        expect(renderSpy).not.toHaveBeenCalled();

        state = state.update({ selection: { anchor: 0 } }).state;
        expect(state.selection.main.head).toBe(0);
        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(renderSpy).toHaveBeenCalledWith('flowchart LR\n  Gamma --> Beta');
    });

    it('keeps BlockMath render results across selection-only updates', () => {
        const renderSpy = vi.spyOn(mathRenderer, 'renderMath');
        const doc = 'Intro\n\n$$\nx^2 + y^2 = z^2\n$$\n\nOutro';
        let state = createState(doc, 0);

        expect(renderSpy).toHaveBeenCalledTimes(1);
        renderSpy.mockClear();

        state = state.update({ selection: { anchor: 3 } }).state;
        const blockStart = doc.indexOf('$$');
        state = state.update({ selection: { anchor: blockStart + 3 } }).state;
        state = state.update({ selection: { anchor: doc.length } }).state;

        expect(state.selection.main.head).toBe(doc.length);
        expect(renderSpy).not.toHaveBeenCalled();
    });
});
