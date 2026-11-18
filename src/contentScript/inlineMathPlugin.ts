import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import {
    Decoration,
    ViewPlugin,
    type DecorationSet,
    type EditorView,
    type PluginValue,
    type ViewUpdate,
} from '@codemirror/view';

import { extractInlineMath, MathWidget, renderMath } from './mathRenderer';
import { rangeIntersectsSelection } from './renderUtils';

function buildInlineMathDecorations(view: EditorView): DecorationSet {
    const state = view.state;
    const tree = syntaxTree(state);
    const decorations: Range<Decoration>[] = [];
    const seen = new Set<number>();

    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter(node) {
                if (node.name !== 'InlineMath' || seen.has(node.from)) {
                    return;
                }
                seen.add(node.from);

                const expr = extractInlineMath(state, node);
                if (!expr || rangeIntersectsSelection(state.selection, expr.replaceFrom, expr.replaceTo)) {
                    return;
                }

                const result = renderMath(expr.tex, false);
                const widget = new MathWidget(expr.tex, false, result, expr.editOffset);
                decorations.push(Decoration.replace({ widget }).range(expr.replaceFrom, expr.replaceTo));
            },
        });
    }

    return Decoration.set(decorations, true);
}

class InlineMathPlugin implements PluginValue {
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
        this.decorations = buildInlineMathDecorations(view);
    }

    public update(update: ViewUpdate): void {
        const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
        if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged) {
            this.decorations = buildInlineMathDecorations(update.view);
        }
    }
}

/**
 * CodeMirror 6 ViewPlugin replacing visible single-line `$...$` math nodes with KaTeX widgets
 * whenever the editor selection does not intersect the expression.
 */
export const inlineMathPlugin = ViewPlugin.fromClass(InlineMathPlugin, {
    decorations: (plugin) => plugin.decorations,
});
