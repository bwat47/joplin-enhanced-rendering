import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';

import { blockRenderingExtension } from './blockRenderingField';
import { blockSelectionSnapFilter } from './blockSelectionSnap';
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
    return selectRanges(state, EditorSelection.single(anchor, head));
}

function selectRanges(state: EditorState, selection: EditorSelection): EditorSelection {
    return state.update({ selection, userEvent: 'select' }).state.selection;
}

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

    it('grows both ends of a backward range spanning multiple rendered blocks', () => {
        const range = select(createState(2), MATH_FROM + 4, MERMAID_FROM + 5).main;
        expect([range.anchor, range.head]).toEqual([MATH_TO, MERMAID_FROM]);
    });

    it('leaves selections that touch no rendered block alone', () => {
        const range = select(createState(0), 0, 5).main;
        expect([range.anchor, range.head]).toEqual([0, 5]);
    });

    it('treats a range ending on a block boundary as touching the block', () => {
        const range = select(createState(2), 2, MERMAID_FROM).main;
        expect([range.from, range.to]).toEqual([2, MERMAID_TO]);
    });

    it('merges ranges that grow over the same block', () => {
        const middle = DOC.indexOf('Middle line');
        const selection = selectRanges(
            createState(2),
            EditorSelection.create([
                EditorSelection.range(2, MERMAID_FROM + 3),
                EditorSelection.range(MERMAID_TO - 3, middle),
            ])
        );
        expect(selection.ranges).toHaveLength(1);
        expect([selection.main.from, selection.main.to]).toEqual([2, middle]);
    });

    it('leaves a caret inside a rendered block alone while growing other ranges', () => {
        const middle = DOC.indexOf('Middle line');
        const caret = MERMAID_FROM + 5;
        const selection = selectRanges(
            createState(2),
            EditorSelection.create([EditorSelection.cursor(caret), EditorSelection.range(middle, MATH_FROM + 4)], 0)
        );
        expect(selection.ranges.map((range) => [range.anchor, range.head])).toEqual([
            [caret, caret],
            [middle, MATH_TO],
        ]);
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

    it('is a no-op when blockRenderingExtension is not installed', () => {
        const state = EditorState.create({
            doc: DOC,
            extensions: [blockSelectionSnapFilter],
        });
        const range = select(state, 0, MERMAID_FROM + 5).main;
        expect([range.anchor, range.head]).toEqual([0, MERMAID_FROM + 5]);
    });
});
