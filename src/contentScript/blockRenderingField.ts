import { syntaxTree } from '@codemirror/language';
import {
    EditorSelection,
    EditorState,
    StateField,
    type Extension,
    type Range,
    type Text,
    type Transaction,
    type TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import { extractBlockMath, MathWidget } from './mathRenderer';
import { extractMermaidBlock, MermaidWidget } from './mermaidRenderer';
import { getMermaidMaxWidth, hasMermaidMaxWidthChanged } from './mermaidWidth';
import { getRevealSelection, hasRevealSelectionChanged, isReleasingFrozenSelection } from './pointerRevealFreeze';
import { rangeIntersectsSelection } from './renderUtils';

type BlockKind = 'mermaid' | 'math';

interface BlockEntry {
    readonly kind: BlockKind;
    readonly source: string;
    readonly replaceFrom: number;
    readonly replaceTo: number;
    readonly editOffset: number;
    /** False while the selection reveals the block's source. */
    readonly rendered: boolean;
}

interface BlockRenderingState {
    readonly blocks: readonly BlockEntry[];
    readonly decorations: DecorationSet;
}

/**
 * Creates the widget decoration for a block: a click-to-edit replacement while rendered, or a
 * read-only live preview after the closing line while revealed.
 *
 * Decorations are rebuilt freely. Widgets render lazily when mounted, the renderers cache their
 * output, and CodeMirror keeps the mounted DOM when a new widget is `eq` to the old one.
 */
function createBlockDecoration(block: BlockEntry, mermaidMaxWidth: number | null): Range<Decoration> {
    const { kind, source, rendered } = block;
    const editOffset = rendered ? block.editOffset : 0;
    const preview = !rendered;
    const widget =
        kind === 'mermaid'
            ? new MermaidWidget(source, editOffset, mermaidMaxWidth ?? undefined, preview)
            : new MathWidget(source, true, editOffset, preview);

    return rendered
        ? Decoration.replace({ widget, block: true }).range(block.replaceFrom, block.replaceTo)
        : Decoration.widget({ widget, block: true, side: 1 }).range(block.replaceTo);
}

function createBlockState(blocks: readonly BlockEntry[], mermaidMaxWidth: number | null): BlockRenderingState {
    const decorations = blocks.map((block) => createBlockDecoration(block, mermaidMaxWidth));
    return { blocks, decorations: Decoration.set(decorations, true) };
}

function collectBlocks(state: EditorState): BlockEntry[] {
    const blocks: BlockEntry[] = [];
    const revealSelection = getRevealSelection(state);
    const addBlock = (kind: BlockKind, source: string, replaceFrom: number, replaceTo: number, editOffset: number) => {
        const rendered = !rangeIntersectsSelection(revealSelection, replaceFrom, replaceTo);
        blocks.push({ kind, source, replaceFrom, replaceTo, editOffset, rendered });
    };

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'FencedCode') {
                const block = extractMermaidBlock(state, node);
                if (block) {
                    addBlock('mermaid', block.source, block.replaceFrom, block.replaceTo, block.editOffset);
                }
                return false;
            }

            if (node.name === 'BlockMath') {
                const expr = extractBlockMath(state, node);
                if (expr) {
                    addBlock('math', expr.tex, expr.replaceFrom, expr.replaceTo, expr.editOffset);
                }
                return false;
            }

            return undefined;
        },
    });

    return blocks;
}

/** Returns `blocks` itself when the selection change doesn't reveal or render any block. */
function applyRevealSelection(blocks: readonly BlockEntry[], revealSelection: EditorSelection): readonly BlockEntry[] {
    const next = blocks.map((block) => {
        const rendered = !rangeIntersectsSelection(revealSelection, block.replaceFrom, block.replaceTo);
        return rendered === block.rendered ? block : { ...block, rendered };
    });
    return next.some((block, i) => block !== blocks[i]) ? next : blocks;
}

/**
 * CodeMirror 6 StateField providing block replacement decorations for Mermaid fences
 * and display (`$$...$$`) math blocks. Must be a StateField because CM6 forbids
 * ViewPlugins from supplying `block: true` or multi-line replacement decorations.
 */
const blockRenderingField = StateField.define<BlockRenderingState>({
    create(state): BlockRenderingState {
        return createBlockState(collectBlocks(state), getMermaidMaxWidth(state));
    },
    update(value, transaction): BlockRenderingState {
        const state = transaction.state;
        const mermaidMaxWidth = getMermaidMaxWidth(state);
        if (transaction.docChanged || syntaxTree(state) !== syntaxTree(transaction.startState)) {
            return createBlockState(collectBlocks(state), mermaidMaxWidth);
        }

        const widthChanged = hasMermaidMaxWidthChanged(transaction.startState, state);
        if (!widthChanged && !hasRevealSelectionChanged(transaction.startState, state)) {
            return value;
        }

        const blocks = applyRevealSelection(value.blocks, getRevealSelection(state));
        return widthChanged || blocks !== value.blocks ? createBlockState(blocks, mermaidMaxWidth) : value;
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Document range a rendered block widget replaces. */
export interface RenderedBlockSpan {
    readonly from: number;
    readonly to: number;
}

/** Returns the replaced ranges of every block currently drawn as a widget, in document order. */
export function getRenderedBlockSpans(state: EditorState): readonly RenderedBlockSpan[] {
    const field = state.field(blockRenderingField, false);
    if (!field) {
        return [];
    }

    return field.blocks
        .filter((block) => block.rendered)
        .map((block) => ({ from: block.replaceFrom, to: block.replaceTo }));
}

interface BlockLineSpan {
    from: number;
    to: number;
    startLine: number;
    endLine: number;
    editOffset: number;
}

function collectBlockSpans(doc: Text, blocks: readonly BlockEntry[]): BlockLineSpan[] {
    const spans: BlockLineSpan[] = [];
    for (const block of blocks) {
        if (!block.rendered) {
            continue;
        }
        spans.push({
            from: block.replaceFrom,
            to: block.replaceTo,
            startLine: doc.lineAt(block.replaceFrom).number,
            endLine: doc.lineAt(block.replaceTo).number,
            editOffset: block.editOffset,
        });
    }
    return spans;
}

function findDownwardEntryPos(spans: BlockLineSpan[], oldLine: number, newLine: number): number | null {
    const firstIndex = spans.findIndex((span) => span.startLine === oldLine + 1);
    if (firstIndex === -1) {
        return null;
    }

    let endLine = spans[firstIndex]!.endLine;
    for (let i = firstIndex + 1; i < spans.length && spans[i]!.startLine === endLine + 1; i++) {
        endLine = spans[i]!.endLine;
    }

    return newLine === endLine + 1 ? spans[firstIndex]!.from : null;
}

function findUpwardEntryPos(spans: BlockLineSpan[], oldLine: number, newLine: number): number | null {
    const lastIndex = spans.findIndex((span) => span.endLine === oldLine - 1);
    if (lastIndex === -1) {
        return null;
    }

    let startLine = spans[lastIndex]!.startLine;
    for (let i = lastIndex - 1; i >= 0 && spans[i]!.endLine === startLine - 1; i--) {
        startLine = spans[i]!.startLine;
    }

    return newLine === startLine - 1 ? spans[lastIndex]!.to : null;
}

function findSkippedBlockEntryPos(spans: BlockLineSpan[], oldLine: number, newLine: number): number | null {
    return newLine > oldLine
        ? findDownwardEntryPos(spans, oldLine, newLine)
        : findUpwardEntryPos(spans, oldLine, newLine);
}

function findBoundaryClickEditPos(spans: BlockLineSpan[], cursorPos: number, docLength: number): number | null {
    for (const span of spans) {
        if ((cursorPos === span.from || cursorPos === span.to) && span.editOffset > 0) {
            return Math.min(span.from + span.editOffset, docLength);
        }
    }
    return null;
}

function redirectBlockBoundaryClick(transaction: Transaction): TransactionSpec | readonly TransactionSpec[] | null {
    if (transaction.docChanged || transaction.selection || !isReleasingFrozenSelection(transaction)) {
        return null;
    }

    const selection = transaction.startState.selection;
    if (selection.ranges.length !== 1 || !selection.main.empty) {
        return null;
    }

    const doc = transaction.startState.doc;
    const { blocks } = transaction.startState.field(blockRenderingField);
    const editPos = findBoundaryClickEditPos(collectBlockSpans(doc, blocks), selection.main.head, doc.length);
    if (editPos === null) {
        return null;
    }

    return [transaction, { selection: EditorSelection.cursor(editPos) }];
}

function redirectSkippedBlockSelection(transaction: Transaction): TransactionSpec | readonly TransactionSpec[] {
    const boundaryRedirect = redirectBlockBoundaryClick(transaction);
    if (boundaryRedirect !== null) {
        return boundaryRedirect;
    }

    if (
        transaction.docChanged ||
        !transaction.selection ||
        !transaction.isUserEvent('select') ||
        transaction.isUserEvent('select.pointer')
    ) {
        return transaction;
    }

    const oldSelection = transaction.startState.selection;
    const newSelection = transaction.selection;
    if (
        oldSelection.ranges.length !== 1 ||
        newSelection.ranges.length !== 1 ||
        !oldSelection.main.empty ||
        !newSelection.main.empty ||
        newSelection.main.goalColumn === undefined
    ) {
        return transaction;
    }

    const doc = transaction.startState.doc;
    const oldLine = doc.lineAt(oldSelection.main.head).number;
    const newLine = doc.lineAt(newSelection.main.head).number;
    if (Math.abs(newLine - oldLine) <= 1) {
        return transaction;
    }

    const { blocks } = transaction.startState.field(blockRenderingField);
    const entryPos = findSkippedBlockEntryPos(collectBlockSpans(doc, blocks), oldLine, newLine);
    if (entryPos === null) {
        return transaction;
    }

    return [transaction, { selection: EditorSelection.cursor(entryPos) }];
}

/**
 * Intercepts keyboard vertical cursor movement (ArrowDown/ArrowUp, Vim j/k) that would
 * otherwise jump completely over a `block: true` replacement widget, landing on the block's
 * boundary so it expands into raw Markdown for editing.
 */
const blockVerticalNavigationFilter = EditorState.transactionFilter.of(redirectSkippedBlockSelection);

export const blockRenderingExtension: Extension = [blockRenderingField, blockVerticalNavigationFilter];
