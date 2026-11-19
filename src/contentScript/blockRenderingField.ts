import { syntaxTree } from '@codemirror/language';
import {
    EditorSelection,
    EditorState,
    MapMode,
    StateField,
    type ChangeDesc,
    type Extension,
    type Range,
    type Text,
    type Transaction,
    type TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import { extractBlockMath, MathWidget, renderMath } from './mathRenderer';
import { extractMermaidBlock, MermaidWidget, renderMermaid } from './mermaidRenderer';
import { getRevealSelection, hasRevealSelectionChanged, isReleasingFrozenSelection } from './pointerRevealFreeze';
import { rangeIntersectsSelection } from './renderUtils';

type BlockKind = 'mermaid' | 'math';

interface BlockEntry {
    readonly kind: BlockKind;
    readonly source: string;
    readonly replaceFrom: number;
    readonly replaceTo: number;
    readonly editOffset: number;
    readonly decoration: Range<Decoration> | null;
    readonly rendered: boolean;
}

interface CachedBlockDecoration {
    readonly decoration: Decoration;
    readonly ends: Set<number>;
}

interface BlockRenderingState {
    readonly blocks: readonly BlockEntry[];
    readonly decorations: DecorationSet;
    readonly cache: ReadonlyMap<string, CachedBlockDecoration>;
}

function blockCacheKey(kind: BlockKind, editOffset: number, source: string): string {
    return `${kind}:${editOffset}:${source}`;
}

function recordCachedDecoration(
    cache: Map<string, CachedBlockDecoration>,
    key: string,
    decoration: Decoration,
    to: number,
    previousCache?: ReadonlyMap<string, CachedBlockDecoration>
): void {
    const existing = cache.get(key);
    // Identical blocks share the render, but each occurrence must survive edits independently.
    if (existing && existing !== previousCache?.get(key)) {
        existing.ends.add(to);
    } else {
        cache.set(key, { decoration, ends: new Set(existing?.ends).add(to) });
    }
}

function retainUnparsedCacheEntries(
    parsedTo: number,
    docLength: number,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    changes: ChangeDesc | null
): Map<string, CachedBlockDecoration> {
    const retained = new Map<string, CachedBlockDecoration>();
    if (parsedTo >= docLength) {
        return retained;
    }

    // The outer Markdown tree can cover a block even when an earlier fenced language was skipped.
    for (const [key, entry] of previousCache) {
        for (const to of entry.ends) {
            // Keep the endpoint attached to the block's last character, including at insertions.
            const mappedTo = changes ? changes.mapPos(to, -1, MapMode.TrackBefore) : to;
            if (mappedTo !== null && mappedTo > parsedTo) {
                recordCachedDecoration(retained, key, entry.decoration, mappedTo);
            }
        }
    }

    return retained;
}

function recordRevealedBlockOccurrences(
    blocks: readonly BlockEntry[],
    cache: Map<string, CachedBlockDecoration> | null,
    previousCache?: ReadonlyMap<string, CachedBlockDecoration>
): void {
    if (!cache) {
        return;
    }

    for (const block of blocks) {
        if (block.decoration) {
            continue;
        }
        const key = blockCacheKey(block.kind, block.editOffset, block.source);
        const cached = cache.get(key);
        // A duplicate can acquire a shared render after this occurrence was processed.
        if (cached && !cached.ends.has(block.replaceTo)) {
            recordCachedDecoration(cache, key, cached.decoration, block.replaceTo, previousCache);
        }
    }
}

function createBlockDecoration(
    kind: BlockKind,
    source: string,
    replaceFrom: number,
    replaceTo: number,
    editOffset: number,
    cached?: Decoration
): Range<Decoration> {
    if (cached) {
        return cached.range(replaceFrom, replaceTo);
    }

    const widget =
        kind === 'mermaid'
            ? new MermaidWidget(source, renderMermaid(source), editOffset)
            : new MathWidget(source, true, renderMath(source, true), editOffset);
    return Decoration.replace({ widget, block: true }).range(replaceFrom, replaceTo);
}

function createBlockEntry(
    kind: BlockKind,
    source: string,
    replaceFrom: number,
    replaceTo: number,
    editOffset: number,
    revealSelection: EditorSelection,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    nextCache: Map<string, CachedBlockDecoration>
): BlockEntry {
    const key = blockCacheKey(kind, editOffset, source);
    const rendered = !rangeIntersectsSelection(revealSelection, replaceFrom, replaceTo);
    const reused = (nextCache.get(key) ?? previousCache.get(key))?.decoration;
    const decoration =
        rendered || reused ? createBlockDecoration(kind, source, replaceFrom, replaceTo, editOffset, reused) : null;

    if (decoration) {
        recordCachedDecoration(nextCache, key, decoration.value, replaceTo);
    }

    return { kind, source, replaceFrom, replaceTo, editOffset, decoration, rendered };
}

function buildBlockState(
    state: EditorState,
    previousCache: ReadonlyMap<string, CachedBlockDecoration> = new Map(),
    changes: ChangeDesc | null = null
): BlockRenderingState {
    const blocks: BlockEntry[] = [];
    const activeDecorations: Range<Decoration>[] = [];
    const revealSelection = getRevealSelection(state);
    const tree = syntaxTree(state);
    const nextCache = retainUnparsedCacheEntries(tree.length, state.doc.length, previousCache, changes);

    tree.iterate({
        enter(node) {
            if (node.name === 'FencedCode') {
                const block = extractMermaidBlock(state, node);
                if (block) {
                    const entry = createBlockEntry(
                        'mermaid',
                        block.source,
                        block.replaceFrom,
                        block.replaceTo,
                        block.editOffset,
                        revealSelection,
                        previousCache,
                        nextCache
                    );
                    blocks.push(entry);
                    if (entry.rendered && entry.decoration) {
                        activeDecorations.push(entry.decoration);
                    }
                }
                return false;
            }

            if (node.name === 'BlockMath') {
                const expr = extractBlockMath(state, node);
                if (expr) {
                    const entry = createBlockEntry(
                        'math',
                        expr.tex,
                        expr.replaceFrom,
                        expr.replaceTo,
                        expr.editOffset,
                        revealSelection,
                        previousCache,
                        nextCache
                    );
                    blocks.push(entry);
                    if (entry.rendered && entry.decoration) {
                        activeDecorations.push(entry.decoration);
                    }
                }
                return false;
            }

            return undefined;
        },
    });

    recordRevealedBlockOccurrences(blocks, nextCache);

    return {
        blocks,
        decorations: Decoration.set(activeDecorations, true),
        cache: nextCache,
    };
}

function resolveBlockDecoration(
    block: BlockEntry,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    nextCache: Map<string, CachedBlockDecoration> | null
): { decoration: Range<Decoration>; nextCache: Map<string, CachedBlockDecoration> | null } {
    const key = blockCacheKey(block.kind, block.editOffset, block.source);
    const cached = (nextCache ?? previousCache).get(key);
    const decoration = createBlockDecoration(
        block.kind,
        block.source,
        block.replaceFrom,
        block.replaceTo,
        block.editOffset,
        cached?.decoration
    );
    if (!cached?.ends.has(block.replaceTo)) {
        nextCache ??= new Map(previousCache);
        recordCachedDecoration(nextCache, key, decoration.value, block.replaceTo, previousCache);
    }
    return { decoration, nextCache };
}

function updateBlockStateForSelection(
    previous: BlockRenderingState,
    revealSelection: EditorSelection
): BlockRenderingState {
    let changed = false;
    for (const block of previous.blocks) {
        const shouldRender = !rangeIntersectsSelection(revealSelection, block.replaceFrom, block.replaceTo);
        if (shouldRender !== block.rendered) {
            changed = true;
            break;
        }
    }

    if (!changed) {
        return previous;
    }

    const blocks: BlockEntry[] = [];
    const activeDecorations: Range<Decoration>[] = [];
    let nextCache: Map<string, CachedBlockDecoration> | null = null;

    for (const block of previous.blocks) {
        const shouldRender = !rangeIntersectsSelection(revealSelection, block.replaceFrom, block.replaceTo);
        let decoration = block.decoration;
        if (shouldRender) {
            if (!decoration) {
                ({ decoration, nextCache } = resolveBlockDecoration(block, previous.cache, nextCache));
            }
            activeDecorations.push(decoration);
        }

        if (shouldRender === block.rendered && decoration === block.decoration) {
            blocks.push(block);
        } else {
            blocks.push({ ...block, decoration, rendered: shouldRender });
        }
    }

    recordRevealedBlockOccurrences(blocks, nextCache, previous.cache);

    return {
        blocks,
        decorations: Decoration.set(activeDecorations, true),
        cache: nextCache ?? previous.cache,
    };
}

/**
 * CodeMirror 6 StateField providing block replacement decorations for Mermaid fences
 * and display (`$$...$$`) math blocks. Must be a StateField because CM6 forbids
 * ViewPlugins from supplying `block: true` or multi-line replacement decorations.
 */
const blockRenderingField = StateField.define<BlockRenderingState>({
    create(state): BlockRenderingState {
        return buildBlockState(state);
    },
    update(value, transaction): BlockRenderingState {
        const treeChanged = syntaxTree(transaction.state) !== syntaxTree(transaction.startState);
        if (transaction.docChanged || treeChanged) {
            return buildBlockState(transaction.state, value.cache, transaction.docChanged ? transaction.changes : null);
        }

        if (hasRevealSelectionChanged(transaction.startState, transaction.state)) {
            return updateBlockStateForSelection(value, getRevealSelection(transaction.state));
        }

        return value;
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

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
