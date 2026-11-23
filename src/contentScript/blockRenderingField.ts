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

import { extractBlockMath, MathWidget } from './mathRenderer';
import { extractMermaidBlock, MermaidWidget } from './mermaidRenderer';
import { getMermaidMaxWidth, hasMermaidMaxWidthChanged } from './mermaidWidth';
import { getRevealSelection, hasRevealSelectionChanged, isReleasingFrozenSelection } from './pointerRevealFreeze';
import { rangeIntersectsSelection } from './renderUtils';

type BlockKind = 'mermaid' | 'math';

const EMPTY_BLOCK_CACHE: ReadonlyMap<string, CachedBlockDecoration> = new Map();

interface BlockEntry {
    readonly kind: BlockKind;
    readonly source: string;
    readonly replaceFrom: number;
    readonly replaceTo: number;
    readonly editOffset: number;
    readonly decoration: Range<Decoration> | null;
    /** Live preview shown below the source while the block is revealed; null while rendered. */
    readonly preview: Range<Decoration> | null;
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

function mermaidCachePrefix(mermaidMaxWidth: number | null): string {
    return `mermaid:${mermaidMaxWidth ?? 'auto'}:`;
}

function blockCacheKey(kind: BlockKind, editOffset: number, source: string, mermaidMaxWidth: number | null): string {
    return kind === 'mermaid'
        ? `${mermaidCachePrefix(mermaidMaxWidth)}${editOffset}:${source}`
        : `${kind}:${editOffset}:${source}`;
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
    changes: ChangeDesc | null,
    mermaidMaxWidth: number | null
): Map<string, CachedBlockDecoration> {
    const retained = new Map<string, CachedBlockDecoration>();
    if (parsedTo >= docLength) {
        return retained;
    }

    const activeMermaidPrefix = mermaidCachePrefix(mermaidMaxWidth);
    // The outer Markdown tree can cover a block even when an earlier fenced language was skipped.
    for (const [key, entry] of previousCache) {
        if (key.startsWith('mermaid:') && !key.startsWith(activeMermaidPrefix)) {
            continue;
        }
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

function retainNonMermaidCacheEntries(
    previousCache: ReadonlyMap<string, CachedBlockDecoration>
): Map<string, CachedBlockDecoration> {
    const retained = new Map<string, CachedBlockDecoration>();
    for (const [key, entry] of previousCache) {
        if (!key.startsWith('mermaid:')) {
            retained.set(key, entry);
        }
    }
    return retained;
}

function recordRevealedBlockOccurrences(
    blocks: readonly BlockEntry[],
    cache: Map<string, CachedBlockDecoration> | null,
    mermaidMaxWidth: number | null,
    previousCache?: ReadonlyMap<string, CachedBlockDecoration>
): void {
    if (!cache) {
        return;
    }

    for (const block of blocks) {
        if (block.decoration) {
            continue;
        }
        const key = blockCacheKey(block.kind, block.editOffset, block.source, mermaidMaxWidth);
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
    mermaidMaxWidth: number | null,
    cached?: Decoration
): Range<Decoration> {
    if (cached) {
        return cached.range(replaceFrom, replaceTo);
    }

    const widget =
        kind === 'mermaid'
            ? new MermaidWidget(source, editOffset, mermaidMaxWidth ?? undefined)
            : new MathWidget(source, true, editOffset);
    return Decoration.replace({ widget, block: true }).range(replaceFrom, replaceTo);
}

/**
 * Creates the read-only widget placed after a revealed block's closing line so its rendered output
 * stays visible below the source while editing. Widgets are cheap to recreate: both kinds render
 * lazily when mounted, and CodeMirror keeps the mounted DOM when the new widget is `eq` to the old one.
 */
function createPreviewDecoration(
    kind: BlockKind,
    source: string,
    replaceTo: number,
    mermaidMaxWidth: number | null
): Range<Decoration> {
    const widget =
        kind === 'mermaid'
            ? new MermaidWidget(source, 0, mermaidMaxWidth ?? undefined, true)
            : new MathWidget(source, true, 0, true);
    return Decoration.widget({ widget, block: true, side: 1 }).range(replaceTo);
}

function activeDecoration(entry: BlockEntry): Range<Decoration> | null {
    return entry.rendered ? entry.decoration : entry.preview;
}

function createBlockEntry(
    kind: BlockKind,
    source: string,
    replaceFrom: number,
    replaceTo: number,
    editOffset: number,
    revealSelection: EditorSelection,
    mermaidMaxWidth: number | null,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    nextCache: Map<string, CachedBlockDecoration>
): BlockEntry {
    const key = blockCacheKey(kind, editOffset, source, mermaidMaxWidth);
    const rendered = !rangeIntersectsSelection(revealSelection, replaceFrom, replaceTo);
    const reused = (nextCache.get(key) ?? previousCache.get(key))?.decoration;
    const decoration =
        rendered || reused
            ? createBlockDecoration(kind, source, replaceFrom, replaceTo, editOffset, mermaidMaxWidth, reused)
            : null;

    if (decoration) {
        recordCachedDecoration(nextCache, key, decoration.value, replaceTo);
    }

    const preview = rendered ? null : createPreviewDecoration(kind, source, replaceTo, mermaidMaxWidth);
    return { kind, source, replaceFrom, replaceTo, editOffset, decoration, preview, rendered };
}

function buildBlockState(
    state: EditorState,
    previousCache: ReadonlyMap<string, CachedBlockDecoration> = new Map(),
    changes: ChangeDesc | null = null
): BlockRenderingState {
    const blocks: BlockEntry[] = [];
    const activeDecorations: Range<Decoration>[] = [];
    const revealSelection = getRevealSelection(state);
    const mermaidMaxWidth = getMermaidMaxWidth(state);
    const tree = syntaxTree(state);
    const nextCache = retainUnparsedCacheEntries(
        tree.length,
        state.doc.length,
        previousCache,
        changes,
        mermaidMaxWidth
    );

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
                        mermaidMaxWidth,
                        previousCache,
                        nextCache
                    );
                    blocks.push(entry);
                    const active = activeDecoration(entry);
                    if (active) {
                        activeDecorations.push(active);
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
                        mermaidMaxWidth,
                        previousCache,
                        nextCache
                    );
                    blocks.push(entry);
                    const active = activeDecoration(entry);
                    if (active) {
                        activeDecorations.push(active);
                    }
                }
                return false;
            }

            return undefined;
        },
    });

    recordRevealedBlockOccurrences(blocks, nextCache, mermaidMaxWidth);

    return {
        blocks,
        decorations: Decoration.set(activeDecorations, true),
        cache: nextCache,
    };
}

function resolveBlockDecoration(
    block: BlockEntry,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    nextCache: Map<string, CachedBlockDecoration> | null,
    mermaidMaxWidth: number | null
): { decoration: Range<Decoration>; nextCache: Map<string, CachedBlockDecoration> | null } {
    const key = blockCacheKey(block.kind, block.editOffset, block.source, mermaidMaxWidth);
    const cached = (nextCache ?? previousCache).get(key);
    const decoration = createBlockDecoration(
        block.kind,
        block.source,
        block.replaceFrom,
        block.replaceTo,
        block.editOffset,
        mermaidMaxWidth,
        cached?.decoration
    );
    if (!cached?.ends.has(block.replaceTo)) {
        nextCache ??= new Map(previousCache);
        recordCachedDecoration(nextCache, key, decoration.value, block.replaceTo, previousCache);
    }
    return { decoration, nextCache };
}

/**
 * Applies `revealSelection` to an existing block: rendered blocks get a decoration (reused from
 * the cache when possible) and revealed blocks keep theirs for later reuse while showing a live
 * preview below their source. Returns the original entry when nothing changed. `nextCache` is
 * created lazily from `previousCache` on first write.
 */
function updateBlockForSelection(
    block: BlockEntry,
    revealSelection: EditorSelection,
    previousCache: ReadonlyMap<string, CachedBlockDecoration>,
    nextCache: Map<string, CachedBlockDecoration> | null,
    mermaidMaxWidth: number | null
): { entry: BlockEntry; nextCache: Map<string, CachedBlockDecoration> | null } {
    const shouldRender = !rangeIntersectsSelection(revealSelection, block.replaceFrom, block.replaceTo);
    let decoration = block.decoration;
    if (shouldRender && !decoration) {
        ({ decoration, nextCache } = resolveBlockDecoration(block, previousCache, nextCache, mermaidMaxWidth));
    }

    const preview = shouldRender
        ? null
        : (block.preview ?? createPreviewDecoration(block.kind, block.source, block.replaceTo, mermaidMaxWidth));

    const entry =
        shouldRender === block.rendered && decoration === block.decoration && preview === block.preview
            ? block
            : { ...block, decoration, preview, rendered: shouldRender };
    return { entry, nextCache };
}

function updateBlockStateForMermaidWidth(
    previous: BlockRenderingState,
    revealSelection: EditorSelection,
    mermaidMaxWidth: number | null
): BlockRenderingState {
    const nextCache = retainNonMermaidCacheEntries(previous.cache);
    const blocks: BlockEntry[] = [];
    const activeDecorations: Range<Decoration>[] = [];

    for (const block of previous.blocks) {
        const entry =
            block.kind === 'mermaid'
                ? createBlockEntry(
                      'mermaid',
                      block.source,
                      block.replaceFrom,
                      block.replaceTo,
                      block.editOffset,
                      revealSelection,
                      mermaidMaxWidth,
                      EMPTY_BLOCK_CACHE,
                      nextCache
                  )
                : updateBlockForSelection(block, revealSelection, previous.cache, nextCache, mermaidMaxWidth).entry;

        blocks.push(entry);
        const active = activeDecoration(entry);
        if (active) {
            activeDecorations.push(active);
        }
    }

    // Math entries in `nextCache` are shared with `previous.cache`; passing it lets
    // `recordCachedDecoration` copy them before adding ends instead of mutating previous state.
    recordRevealedBlockOccurrences(blocks, nextCache, mermaidMaxWidth, previous.cache);

    return {
        blocks,
        decorations: Decoration.set(activeDecorations, true),
        cache: nextCache,
    };
}

function updateBlockStateForSelection(
    previous: BlockRenderingState,
    revealSelection: EditorSelection,
    mermaidMaxWidth: number | null
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
        let entry: BlockEntry;
        ({ entry, nextCache } = updateBlockForSelection(
            block,
            revealSelection,
            previous.cache,
            nextCache,
            mermaidMaxWidth
        ));
        blocks.push(entry);
        const active = activeDecoration(entry);
        if (active) {
            activeDecorations.push(active);
        }
    }

    recordRevealedBlockOccurrences(blocks, nextCache, mermaidMaxWidth, previous.cache);

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

        const mermaidMaxWidth = getMermaidMaxWidth(transaction.state);
        if (hasMermaidMaxWidthChanged(transaction.startState, transaction.state)) {
            return updateBlockStateForMermaidWidth(value, getRevealSelection(transaction.state), mermaidMaxWidth);
        }

        if (hasRevealSelectionChanged(transaction.startState, transaction.state)) {
            return updateBlockStateForSelection(value, getRevealSelection(transaction.state), mermaidMaxWidth);
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
