import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
    clearMathRenderCache,
    extractBlockMath,
    extractInlineMath,
    MathWidget,
    renderMermaidMath,
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

function renderWidget(tex: string, displayMode: boolean): HTMLElement {
    const view = new EditorView({ parent: document.createElement('div') });
    const element = new MathWidget(tex, displayMode, 3).toDOM(view);
    view.destroy();
    return element;
}

describe('MathWidget', () => {
    beforeEach(() => {
        clearMathRenderCache();
    });

    it('renders inline and display math via KaTeX, keeping the modes apart', () => {
        const inline = renderWidget('x^2', false);
        const block = renderWidget('x^2', true);

        expect(inline.querySelector('.katex')).not.toBeNull();
        expect(inline.querySelector('.katex-display')).toBeNull();
        expect(block.querySelector('.katex-display')).not.toBeNull();
        expect(renderWidget('x^2', false).querySelector('.katex-display')).toBeNull();
    });

    it('shows an error for invalid LaTeX', () => {
        const inline = renderWidget('\\frac{1}', false);
        expect(inline.dataset.renderError).toBe('true');
        expect(inline.querySelector('.katex')).toBeNull();
        const inlineError = inline.querySelector<HTMLElement>('.cm-enhanced-rendering-error')!;
        expect(inlineError.textContent).toBe('\\frac{1}');
        expect(inlineError.title.length).toBeGreaterThan(0);

        const block = renderWidget('\\frac{1}', true);
        expect(block.querySelector('.cm-enhanced-rendering-error')!.textContent).toMatch(/^KaTeX error: /);
    });

    it('disallows untrusted KaTeX commands such as \\href', () => {
        const element = renderWidget('\\href{javascript:alert(1)}{click}', false);
        expect(element.dataset.renderError).toBeUndefined();
        expect(element.querySelector('.katex')).not.toBeNull();
        expect(element.querySelector('a')).toBeNull();
        expect(element.innerHTML).not.toContain('href=');
    });

    it('implements widget equality', () => {
        const widgetA = new MathWidget('x^2', false, 1);
        const widgetB = new MathWidget('x^2', false, 1);
        const widgetC = new MathWidget('x^2', true, 2);
        const preview = new MathWidget('x^2', false, 1, true);

        expect(widgetA.eq(widgetB)).toBe(true);
        expect(widgetA.eq(widgetC)).toBe(false);
        expect(widgetA.eq(preview)).toBe(false);
        expect(widgetA.ignoreEvent()).toBe(true);
    });
});

describe('MathWidget tagged display math', () => {
    const renderBlock = (tex: string): HTMLElement => renderWidget(tex, true);

    const childClasses = (element: Element): string[] => Array.from(element.children, (child) => child.className);

    beforeEach(() => {
        clearMathRenderCache();
    });

    // Guards against KaTeX markup changes: grouping silently no-ops if the expected structure changes.
    it('groups only the final line with its tag', () => {
        const html = renderBlock(String.raw`a \newline b + c \tag{1}`).querySelector('.katex-html')!;
        expect(childClasses(html)).toEqual(['katex-base', 'mspace katex-newline', 'cm-enhanced-rendering-tagged-line']);

        const taggedLine = html.lastElementChild!;
        expect(childClasses(taggedLine)).toEqual(['cm-enhanced-rendering-tagged-equation', 'katex-tag']);
        expect(childClasses(taggedLine.firstElementChild!).every((name) => name === 'katex-base')).toBe(true);
        expect(taggedLine.lastElementChild!.textContent).toBe('(1)');
    });

    it('leaves an empty equation cell when the tag follows a trailing line break', () => {
        const taggedLine = renderBlock(String.raw`a \newline \tag{1}`).querySelector(
            '.cm-enhanced-rendering-tagged-line'
        )!;
        expect(taggedLine.firstElementChild!.children).toHaveLength(0);
        expect(taggedLine.lastElementChild!.className).toBe('katex-tag');
    });

    it('leaves untagged equations unchanged', () => {
        const element = renderBlock('x^2 + y^2');
        expect(element.querySelector('.cm-enhanced-rendering-tagged-line')).toBeNull();
        expect(childClasses(element.querySelector('.katex-html')!).every((name) => name === 'katex-base')).toBe(true);
    });
});

describe('renderMermaidMath', () => {
    beforeEach(() => {
        clearMathRenderCache();
    });

    it('renders MathML markup with positive dimensions and caches results', () => {
        const first = renderMermaidMath('\\frac{a}{b}', 16);
        const second = renderMermaidMath('\\frac{a}{b}', 16);

        expect(first).not.toBeNull();
        expect(first && 'html' in first ? first.html : '').toContain('<math');
        expect(first?.width).toBeGreaterThan(0);
        expect(first?.height).toBeGreaterThan(0);
        expect(second).toBe(first);
    });

    it('returns null for invalid LaTeX so Pele falls back to raw text', () => {
        expect(renderMermaidMath('\\frac{1}', 16)).toBeNull();
    });
});
