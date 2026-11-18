import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
    clearMathRenderCache,
    extractBlockMath,
    extractInlineMath,
    MathWidget,
    renderMath,
    type MathExpression,
} from './mathRenderer';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

function collectMath(doc: string): { inline: MathExpression[]; block: MathExpression[] } {
    const state = EditorState.create({
        doc,
        extensions: [createJoplinMarkdownExtension()],
    });
    const inline: MathExpression[] = [];
    const block: MathExpression[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            const inlineExpr = extractInlineMath(state, node);
            if (inlineExpr) {
                inline.push(inlineExpr);
            }
            const blockExpr = extractBlockMath(state, node);
            if (blockExpr) {
                block.push(blockExpr);
            }
        },
    });
    return { inline, block };
}

describe('extractInlineMath & extractBlockMath', () => {
    it('extracts inline math expressions and ignores inline code and escaped dollars', () => {
        const doc = 'Energy $E = mc^2$, code `$x$`, escaped \\$5 and $a + b$.';
        const { inline, block } = collectMath(doc);

        expect(block).toEqual([]);
        expect(inline.map((item) => item.tex)).toEqual(['E = mc^2', 'a + b']);
        expect(inline.every((item) => !item.displayMode)).toBe(true);
    });

    it('extracts multi-line and single-line display block math', () => {
        const doc = 'Before\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n$$a^2 + b^2 = c^2$$\n\nAfter';
        const { inline, block } = collectMath(doc);

        expect(inline).toEqual([]);
        expect(block).toHaveLength(2);
        expect(block[0]?.tex).toBe('\\int_0^1 x^2\\,dx = \\frac{1}{3}');
        expect(block[1]?.tex).toBe('a^2 + b^2 = c^2');
        expect(block.every((item) => item.displayMode)).toBe(true);
    });

    it('ignores unclosed, empty, and blockquoted block math', () => {
        const cases = ['$$\nx + 1', '$$   $$', '> $$\n> x + 1\n> $$'];
        for (const doc of cases) {
            expect(collectMath(doc).block).toEqual([]);
        }
    });
});

describe('renderMath', () => {
    beforeEach(() => {
        clearMathRenderCache();
    });

    it('renders inline and display math via KaTeX and caches by mode', () => {
        const inlineResult = renderMath('x^2', false);
        const blockResult = renderMath('x^2', true);

        expect(inlineResult.ok).toBe(true);
        expect(blockResult.ok).toBe(true);
        if (!inlineResult.ok || !blockResult.ok) throw new Error('Expected KaTeX render to succeed');
        expect(inlineResult.html).toContain('class="katex"');
        expect(inlineResult.html).not.toContain('katex-display');
        expect(blockResult.html).toContain('katex-display');
        expect(renderMath('x^2', false)).toBe(inlineResult);
    });

    it('returns an error result for invalid LaTeX', () => {
        const result = renderMath('\\frac{1}', false);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected KaTeX render to fail');
        expect(result.error.length).toBeGreaterThan(0);
    });

    it('disallows untrusted KaTeX commands such as \\href', () => {
        const result = renderMath('\\href{javascript:alert(1)}{click}', false);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected KaTeX render to succeed');
        expect(result.html).not.toContain('<a ');
        expect(result.html).not.toContain('href=');
    });

    it('implements widget equality', () => {
        const inlineRes = renderMath('x^2', false);
        const blockRes = renderMath('x^2', true);
        const widgetA = new MathWidget('x^2', false, inlineRes, 1);
        const widgetB = new MathWidget('x^2', false, inlineRes, 1);
        const widgetC = new MathWidget('x^2', true, blockRes, 2);

        expect(widgetA.eq(widgetB)).toBe(true);
        expect(widgetA.eq(widgetC)).toBe(false);
        expect(widgetA.ignoreEvent()).toBe(true);
    });
});
