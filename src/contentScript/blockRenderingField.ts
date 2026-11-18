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

import { extractBlockMath, MathWidget, renderMath } from './mathRenderer';
import { extractMermaidBlock, MermaidWidget, renderMermaid } from './mermaidRenderer';
import { rangeIntersectsSelection } from './renderUtils';

function buildBlockDecorations(state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === 'FencedCode') {
                const block = extractMermaidBlock(state, node);
                if (block && !rangeIntersectsSelection(state.selection, block.replaceFrom, block.replaceTo)) {
                    const result = renderMermaid(block.source);
                    const widget = new MermaidWidget(block.source, result, block.editOffset);
                    decorations.push(
                        Decoration.replace({ widget, block: true }).range(block.replaceFrom, block.replaceTo)
                    );
                }
                return false;
            }

            if (node.name === 'BlockMath') {
                const expr = extractBlockMath(state, node);
                if (expr && !rangeIntersectsSelection(state.selection, expr.replaceFrom, expr.replaceTo)) {
                    const result = renderMath(expr.tex, true);
                    const widget = new MathWidget(expr.tex, true, result, expr.editOffset);
                    decorations.push(
                        Decoration.replace({ widget, block: true }).range(expr.replaceFrom, expr.replaceTo)
                    );
                }
                return false;
            }

            return undefined;
        },
    });

    return Decoration.set(decorations, true);
}

/**
 * CodeMirror 6 StateField providing block replacement decorations for Mermaid fences
 * and display (`$$...$$`) math blocks. Must be a StateField because CM6 forbids
 * ViewPlugins from supplying `block: true` or multi-line replacement decorations.
 */
const blockRenderingField = StateField.define<DecorationSet>({
    create(state): DecorationSet {
        return buildBlockDecorations(state);
    },
    update(decorations, transaction): DecorationSet {
        const selectionChanged = !transaction.newSelection.eq(transaction.startState.selection);
        const treeChanged = syntaxTree(transaction.state) !== syntaxTree(transaction.startState);

        if (transaction.docChanged || selectionChanged || treeChanged) {
            return buildBlockDecorations(transaction.state);
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

interface BlockLineSpan {
    from: number;
    to: number;
    startLine: number;
    endLine: number;
}

function collectBlockSpans(doc: Text, decorations: DecorationSet): BlockLineSpan[] {
    const spans: BlockLineSpan[] = [];
    for (const iter = decorations.iter(); iter.value; iter.next()) {
        spans.push({
            from: iter.from,
            to: iter.to,
            startLine: doc.lineAt(iter.from).number,
            endLine: doc.lineAt(iter.to).number,
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

function redirectSkippedBlockSelection(transaction: Transaction): TransactionSpec | readonly TransactionSpec[] {
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
        !newSelection.main.empty
    ) {
        return transaction;
    }

    const doc = transaction.startState.doc;
    const oldLine = doc.lineAt(oldSelection.main.head).number;
    const newLine = doc.lineAt(newSelection.main.head).number;
    if (Math.abs(newLine - oldLine) <= 1) {
        return transaction;
    }

    const decorations = transaction.startState.field(blockRenderingField);
    const entryPos = findSkippedBlockEntryPos(collectBlockSpans(doc, decorations), oldLine, newLine);
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
