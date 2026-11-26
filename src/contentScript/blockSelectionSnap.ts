import { EditorSelection, EditorState, type Extension, type SelectionRange } from '@codemirror/state';

import { getRenderedBlockSpans, type RenderedBlockSpan } from './blockRenderingField';

/** Grows one range until it contains every block it touches, keeping its direction. */
function snapRange(range: SelectionRange, blocks: readonly RenderedBlockSpan[]): SelectionRange {
    // A caret is not a partial selection. Caret placement around blocks belongs to click-to-edit
    // and vertical navigation.
    if (range.empty) {
        return range;
    }

    let from = range.from;
    let to = range.to;

    // Inclusive on both ends, matching how a selection reveals a block (`rangeIntersectsSelection`).
    for (const block of blocks) {
        if (block.from <= range.to && block.to >= range.from) {
            from = Math.min(from, block.from);
            to = Math.max(to, block.to);
        }
    }

    if (from === range.from && to === range.to) {
        return range;
    }

    return range.anchor <= range.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
}

/**
 * Grows a selection so that no range holds part of a rendered block.
 *
 * A rendered Mermaid diagram or display math block is one widget over hidden Markdown, so a
 * selection reaching into it would end at a point in source the user cannot see. Any contact
 * with a rendered block therefore swallows the whole block.
 *
 * @returns The grown selection, or null when nothing needed moving.
 */
function snapSelectionToBlocks(
    selection: EditorSelection,
    blocks: readonly RenderedBlockSpan[]
): EditorSelection | null {
    const ranges = selection.ranges.map((range) => snapRange(range, blocks));
    const changed = ranges.some((range, index) => range !== selection.ranges[index]);

    // `create` merges any ranges the growth pushed into each other.
    return changed ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

/**
 * Snaps user selection gestures to cover every block rendered in the start state, so extending a
 * selection (Shift+Arrow or mouse drag) into a diagram or display math block selects all of it.
 * Blocks already revealed for editing are left alone, so their source can be selected freely.
 *
 * Document changes, search matches (`select.search`), and programmatic selections are left alone:
 * this exists for interactive selection gestures, and edits or search decide their own selection.
 * The original transaction stays first so its annotations and effects survive; the second,
 * sequential spec only replaces its selection.
 */
export const blockSelectionSnapFilter: Extension = EditorState.transactionFilter.of((tr) => {
    if (
        tr.docChanged ||
        !tr.selection ||
        !tr.isUserEvent('select') ||
        tr.isUserEvent('select.search') ||
        tr.selection.ranges.every((range) => range.empty)
    ) {
        return tr;
    }

    const snapped = snapSelectionToBlocks(tr.selection, getRenderedBlockSpans(tr.startState));
    return snapped ? [tr, { selection: snapped, sequential: true }] : tr;
});
