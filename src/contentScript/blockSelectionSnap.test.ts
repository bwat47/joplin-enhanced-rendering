import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';

import { blockRenderingExtension } from './blockRenderingField';
import { blockSelectionSnapFilter, snapSelectionToBlocks } from './blockSelectionSnap';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

const MERMAID = '```mermaid\nflowchart LR\n  A --> B\n```';
const MATH = '$$\nE = mc^2\n$$';
const DOC = `Intro line\n\n${MERMAID}\n\nMiddle line\n\n${MATH}\n\nOutro line`;
const MERMAID_FROM = DOC.indexOf(MERMAID);
const MERMAID_TO = MERMAID_FROM + MERMAID.length;
const MATH_FROM = DOC.indexOf(MATH);
const MATH_TO = MATH_FROM + MATH.length;

function createState(anchor = 0, head = anchor): EditorState {
    const state = EditorState.create({
        doc: DOC,
        selection: { anchor, head },
        extensions: [
            createJoplinMarkdownExtension(),
            EditorState.allowMultipleSelections.of(true),
            pointerRevealFreezeExtension,
            blockRenderingExtension,
            blockSelectionSnapFilter,
        ],
    });
    ensureSyntaxTree(state, DOC.length, 5000);
    return state.update({}).state;
}

function select(state: EditorState, anchor: number, head: number): EditorSelection {
    return state.update({ selection: { anchor, head }, userEvent: 'select' }).state.selection;
}

describe('snapSelectionToBlocks', () => {
    const blocks = [
        { from: 10, to: 20 },
        { from: 30, to: 40 },
    ];

    it('returns null when no range touches a block', () => {
        expect(snapSelectionToBlocks(EditorSelection.single(0, 5), blocks)).toBeNull();
        expect(snapSelectionToBlocks(EditorSelection.single(21, 29), blocks)).toBeNull();
    });

    it('leaves carets alone, even inside a block', () => {
        expect(snapSelectionToBlocks(EditorSelection.single(15), blocks)).toBeNull();
    });

    it('grows forward and backward ranges over touched blocks, keeping direction', () => {
        const forward = snapSelectionToBlocks(EditorSelection.single(5, 15), blocks)!.main;
        expect([forward.anchor, forward.head]).toEqual([5, 20]);

        const backward = snapSelectionToBlocks(EditorSelection.single(35, 15), blocks)!.main;
        expect([backward.anchor, backward.head]).toEqual([40, 10]);
    });

    it('treats a range ending on a block boundary as touching it', () => {
        const range = snapSelectionToBlocks(EditorSelection.single(5, 10), blocks)!.main;
        expect([range.from, range.to]).toEqual([5, 20]);
    });

    it('merges ranges the growth pushes together', () => {
        const selection = EditorSelection.create([EditorSelection.range(5, 12), EditorSelection.range(18, 25)]);
        const snapped = snapSelectionToBlocks(selection, blocks)!;
        expect(snapped.ranges).toHaveLength(1);
        expect([snapped.main.from, snapped.main.to]).toEqual([5, 25]);
    });
});

describe('blockSelectionSnapFilter', () => {
    it('extends a selection reaching into a rendered Mermaid block to cover all of it', () => {
        const state = createState(2);
        const forward = select(state, 2, MERMAID_FROM + 5).main;
        expect([forward.anchor, forward.head]).toEqual([2, MERMAID_TO]);

        const middle = DOC.indexOf('Middle line');
        const backward = select(state, middle, MERMAID_TO - 3).main;
        expect([backward.anchor, backward.head]).toEqual([middle, MERMAID_FROM]);
    });

    it('extends a selection reaching into rendered display math to cover all of it', () => {
        const middle = DOC.indexOf('Middle line');
        const range = select(createState(middle), middle, MATH_FROM + 4).main;
        expect([range.from, range.to]).toEqual([middle, MATH_TO]);
    });

    it('leaves selections inside a revealed block alone', () => {
        const inside = MERMAID_FROM + 12;
        const range = select(createState(inside), inside, MERMAID_FROM + 20).main;
        expect([range.anchor, range.head]).toEqual([inside, MERMAID_FROM + 20]);
    });

    it('leaves document changes alone', () => {
        const state = createState(2);
        const next = state.update({
            changes: { from: 0, insert: 'x' },
            selection: { anchor: 3, head: MERMAID_FROM + 6 },
        }).state;
        expect([next.selection.main.anchor, next.selection.main.head]).toEqual([3, MERMAID_FROM + 6]);
    });

    it('leaves search and programmatic selections inside a rendered block alone', () => {
        const state = createState(0);
        const search = state.update({
            selection: { anchor: MERMAID_FROM, head: MERMAID_FROM + 3 },
            userEvent: 'select.search',
        }).state.selection.main;
        expect([search.anchor, search.head]).toEqual([MERMAID_FROM, MERMAID_FROM + 3]);

        const programmatic = state.update({
            selection: { anchor: MERMAID_FROM, head: MERMAID_FROM + 3 },
        }).state.selection.main;
        expect([programmatic.anchor, programmatic.head]).toEqual([MERMAID_FROM, MERMAID_FROM + 3]);
    });
});
