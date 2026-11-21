import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type * as pele from 'pele';
import { render as renderPele } from 'pele';

import { clearMermaidRenderCache, extractMermaidBlock, MermaidWidget, type MermaidBlock } from './mermaidRenderer';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

// Wrap Pele's renderer so tests can count real renders (ESM namespaces cannot be spied on directly).
vi.mock('pele', async (importOriginal) => {
    const actual = await importOriginal<typeof pele>();
    return { ...actual, render: vi.fn(actual.render) };
});

const WRAPPING_SOURCE =
    'flowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record] --> E[Finish]';

function collectMermaidBlocks(doc: string): MermaidBlock[] {
    const state = EditorState.create({
        doc,
        extensions: [createJoplinMarkdownExtension()],
    });
    const blocks: MermaidBlock[] = [];
    syntaxTree(state).iterate({
        enter(node) {
            const block = extractMermaidBlock(state, node);
            if (block) {
                blocks.push(block);
            }
        },
    });
    return blocks;
}

describe('extractMermaidBlock', () => {
    it('extracts closed mermaid fenced code blocks', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nOutro';
        const blocks = collectMermaidBlocks(doc);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.source).toBe('flowchart LR\n  A --> B');
        expect(doc.slice(blocks[0]!.replaceFrom, blocks[0]!.replaceTo)).toBe(
            '```mermaid\nflowchart LR\n  A --> B\n```'
        );
    });

    it('supports case-insensitive language info, extra info tokens, and tilde fences', () => {
        const doc = '~~~MERMAID title="Flow"\nflowchart TD\n  A --> B\n~~~';
        const blocks = collectMermaidBlocks(doc);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.source).toBe('flowchart TD\n  A --> B');
    });

    it('dedents mermaid fences indented inside list items', () => {
        const doc = '- Item\n\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```';
        const blocks = collectMermaidBlocks(doc);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.source).toBe('flowchart LR\n  A --> B');
    });

    it('ignores non-mermaid, unclosed, empty, and blockquoted fences', () => {
        const cases = [
            '```ts\nconst x = 1;\n```',
            '```mermaid\nflowchart LR\n  A --> B',
            '```mermaid\n\n```',
            '```mermaid\n   \n```',
            '> ```mermaid\n> flowchart LR\n>   A --> B\n> ```',
        ];

        for (const doc of cases) {
            expect(collectMermaidBlocks(doc)).toEqual([]);
        }
    });
});

describe('MermaidWidget', () => {
    let view: EditorView;
    const renderSpy = vi.mocked(renderPele);

    function mount(source: string, maxWidth?: number): { widget: MermaidWidget; dom: HTMLElement } {
        const widget = new MermaidWidget(source, 11, maxWidth);
        return { widget, dom: widget.toDOM(view) };
    }

    function svgSize(dom: HTMLElement): { width: number; height: number } {
        const [, , width = 0, height = 0] = (dom.querySelector('svg')?.getAttribute('viewBox') ?? '')
            .split(' ')
            .map(Number);
        return { width, height };
    }

    beforeEach(() => {
        clearMermaidRenderCache();
        renderSpy.mockClear();
        view = new EditorView({ parent: document.body });
    });

    afterEach(() => {
        view.destroy();
    });

    it('renders valid Mermaid diagrams to SVG via Pele and caches results by source', () => {
        const source = 'flowchart LR\n  A[Start] --> B[End]';
        const { dom } = mount(source);
        mount(source);

        expect(dom.querySelector('svg.pele')).not.toBeNull();
        expect(dom.dataset.renderError).toBeUndefined();
        expect(svgSize(dom).width).toBeGreaterThan(0);
        expect(svgSize(dom).height).toBeGreaterThan(0);
        expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    it('shows an inline error for invalid Mermaid syntax', () => {
        const { dom } = mount('not-a-valid-diagram-type ???');

        expect(dom.dataset.renderError).toBe('true');
        expect(dom.querySelector('svg')).toBeNull();
        expect(dom.querySelector('.cm-enhanced-rendering-error')?.textContent).toMatch(/^Mermaid syntax error: .+/);
    });

    it('renders $$...$$ math labels inside Mermaid diagrams via KaTeX MathML', () => {
        const { dom } = mount('flowchart LR\n  A["$$x^2 + y^2 = z^2$$"] --> B["$$\\frac{a}{b}$$"]');

        expect(dom.querySelector('.pele-math math')).not.toBeNull();
    });

    it('falls back gracefully when a Mermaid diagram contains invalid math', () => {
        const { dom } = mount('flowchart LR\n  A["$$\\frac{1}$$"] --> B[Done]');

        expect(dom.querySelector('svg.pele')).not.toBeNull();
        expect(dom.textContent).toContain('Done');
    });

    it('adapts wide Mermaid diagrams to maxWidth and caches results per width bucket', () => {
        const unconstrained = svgSize(mount(WRAPPING_SOURCE).dom);
        const narrow = svgSize(mount(WRAPPING_SOURCE, 320).dom);
        mount(WRAPPING_SOURCE, 320);

        expect(renderSpy).toHaveBeenCalledTimes(2);
        expect(renderSpy).toHaveBeenLastCalledWith(WRAPPING_SOURCE, expect.objectContaining({ maxWidth: 320 }));
        expect(narrow.width).toBeLessThan(unconstrained.width);
        expect(narrow.height).toBeGreaterThan(unconstrained.height);
    });

    it('implements identity-based widget equality without rendering', () => {
        const source = 'flowchart LR\n  A --> B';
        const widget = new MermaidWidget(source, 11, 640);

        expect(widget.eq(new MermaidWidget(source, 11, 640))).toBe(true);
        expect(widget.eq(new MermaidWidget(source, 11, 640.9))).toBe(true);
        expect(new MermaidWidget(source, 11, 0).eq(new MermaidWidget(source, 11))).toBe(true);
        expect(new MermaidWidget(source, 11, Number.NaN).eq(new MermaidWidget(source, 11))).toBe(true);
        expect(widget.eq(new MermaidWidget(source, 11, 320))).toBe(false);
        expect(widget.eq(new MermaidWidget(source, 12, 640))).toBe(false);
        expect(widget.eq(new MermaidWidget('flowchart TD\n  A --> B', 11, 640))).toBe(false);
        expect(widget.ignoreEvent()).toBe(true);
        // Equality checks must not render: the height is still unknown.
        expect(widget.estimatedHeight).toBe(-1);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('defers rendering until toDOM and estimates heights from the last render at any width', () => {
        const source = 'flowchart LR\n  A --> B';
        const wide = new MermaidWidget(source, 11, 640);
        expect(wide.estimatedHeight).toBe(-1);

        const dom = wide.toDOM(view);
        expect(dom.querySelector('svg.pele')).not.toBeNull();
        expect(wide.estimatedHeight).toBeGreaterThan(0);

        // An unrendered widget at another width falls back to the last known height for its source.
        expect(new MermaidWidget(source, 11, 320).estimatedHeight).toBe(wide.estimatedHeight);

        // Rendering at a narrower width updates the fallback height for unrendered buckets.
        mount(WRAPPING_SOURCE, 640);
        mount(WRAPPING_SOURCE, 320);
        const expectedWideHeight = new MermaidWidget(WRAPPING_SOURCE, 11, 640).estimatedHeight;
        const expectedNarrowHeight = new MermaidWidget(WRAPPING_SOURCE, 11, 320).estimatedHeight;
        expect(expectedNarrowHeight).toBeGreaterThan(expectedWideHeight);
        expect(new MermaidWidget(WRAPPING_SOURCE, 11, 704).estimatedHeight).toBe(expectedNarrowHeight);

        // Hitting the 640px cache refreshes the last known height back to the wide layout.
        renderSpy.mockClear();
        mount(WRAPPING_SOURCE, 640);
        expect(renderSpy).not.toHaveBeenCalled();
        expect(new MermaidWidget(WRAPPING_SOURCE, 11, 704).estimatedHeight).toBe(expectedWideHeight);
    });

    it('keeps mounted DOM when a width change produces an identical SVG and swaps it otherwise', () => {
        const smallSource = 'flowchart LR\n  A --> B';
        const { widget: smallWide, dom: smallDom } = mount(smallSource, 640);
        const smallSvg = smallDom.querySelector('svg');
        expect(new MermaidWidget(smallSource, 11, 320).updateDOM(smallDom, view, smallWide)).toBe(true);
        expect(smallDom.querySelector('svg')).toBe(smallSvg);

        const { widget: wideWidget, dom: wideDom } = mount(WRAPPING_SOURCE, 640);
        const wideSvg = wideDom.querySelector('svg');
        expect(new MermaidWidget(WRAPPING_SOURCE, 11, 320).updateDOM(wideDom, view, wideWidget)).toBe(true);
        expect(wideDom.querySelector('svg')).not.toBe(wideSvg);
        expect(wideDom.querySelectorAll('svg.pele')).toHaveLength(1);

        // A different click target cannot be patched in place because the click handler captures it.
        expect(new MermaidWidget(WRAPPING_SOURCE, 12, 320).updateDOM(wideDom, view, wideWidget)).toBe(false);

        const invalidSource = 'not-a-valid-diagram-type ???';
        const { widget: errorWide, dom: errorDom } = mount(invalidSource, 640);
        const errorBox = errorDom.querySelector('.cm-enhanced-rendering-error');
        expect(errorBox).not.toBeNull();
        expect(new MermaidWidget(invalidSource, 11, 320).updateDOM(errorDom, view, errorWide)).toBe(true);
        expect(errorDom.querySelector('.cm-enhanced-rendering-error')).toBe(errorBox);
    });
});
