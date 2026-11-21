import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
    clearMermaidRenderCache,
    extractMermaidBlock,
    MermaidWidget,
    renderMermaid,
    type MermaidBlock,
} from './mermaidRenderer';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

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

describe('renderMermaid', () => {
    beforeEach(() => {
        clearMermaidRenderCache();
    });

    it('renders valid Mermaid diagrams to SVG via Pele and caches results', () => {
        const source = 'flowchart LR\n  A[Start] --> B[End]';
        const first = renderMermaid(source);
        const second = renderMermaid(source);

        expect(first.ok).toBe(true);
        if (!first.ok) throw new Error('Expected Mermaid render to succeed');
        expect(first.svg).toContain('<svg');
        expect(first.svg).toContain('class="pele');
        expect(first.width).toBeGreaterThan(0);
        expect(first.height).toBeGreaterThan(0);
        expect(second).toBe(first);
    });

    it('returns an error result for invalid Mermaid syntax', () => {
        const result = renderMermaid('not-a-valid-diagram-type ???');
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected Mermaid render to fail');
        expect(result.error.length).toBeGreaterThan(0);
    });

    it('renders $$...$$ math labels inside Mermaid diagrams via KaTeX MathML', () => {
        const result = renderMermaid('flowchart LR\n  A["$$x^2 + y^2 = z^2$$"] --> B["$$\\frac{a}{b}$$"]');

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected Mermaid render with math to succeed');
        expect(result.svg).toContain('class="pele-math"');
        expect(result.svg).toContain('<math');
    });

    it('falls back gracefully when a Mermaid diagram contains invalid math', () => {
        const result = renderMermaid('flowchart LR\n  A["$$\\frac{1}$$"] --> B[Done]');

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected Mermaid render with invalid math label to succeed');
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('Done');
    });

    it('adapts wide Mermaid diagrams to maxWidth and caches results per width bucket', () => {
        const source =
            'flowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record] --> E[Finish]';
        const unconstrained = renderMermaid(source);
        const narrow = renderMermaid(source, 320);
        const narrowCached = renderMermaid(source, 320);

        expect(unconstrained.ok).toBe(true);
        expect(narrow.ok).toBe(true);
        if (!unconstrained.ok || !narrow.ok) throw new Error('Expected Mermaid renders to succeed');

        expect(narrow).toBe(narrowCached);
        expect(narrow).not.toBe(unconstrained);
        expect(narrow.width).toBeLessThan(unconstrained.width);
        expect(narrow.height).toBeGreaterThan(unconstrained.height);
    });

    it('implements identity-based widget equality without rendering', () => {
        const source = 'flowchart LR\n  A --> B';
        const widget = new MermaidWidget(source, 11, 640);

        expect(widget.eq(new MermaidWidget(source, 11, 640))).toBe(true);
        expect(widget.eq(new MermaidWidget(source, 11, 320))).toBe(false);
        expect(widget.eq(new MermaidWidget(source, 12, 640))).toBe(false);
        expect(widget.eq(new MermaidWidget('flowchart TD\n  A --> B', 11, 640))).toBe(false);
        expect(widget.ignoreEvent()).toBe(true);
        // Equality checks must not render: the height is still unknown.
        expect(widget.estimatedHeight).toBe(-1);
    });

    it('defers rendering until toDOM and estimates heights from the last render at any width', () => {
        const view = new EditorView({ parent: document.body });
        try {
            const source = 'flowchart LR\n  A --> B';
            const wide = new MermaidWidget(source, 11, 640);
            expect(wide.estimatedHeight).toBe(-1);

            const dom = wide.toDOM(view);
            expect(dom.querySelector('svg.pele')).not.toBeNull();
            expect(wide.estimatedHeight).toBeGreaterThan(0);

            // An unrendered widget at another width falls back to the last known height for its source.
            expect(new MermaidWidget(source, 11, 320).estimatedHeight).toBe(wide.estimatedHeight);
        } finally {
            view.destroy();
        }
    });

    it('keeps mounted DOM when a width change produces an identical SVG and swaps it otherwise', () => {
        const view = new EditorView({ parent: document.body });
        try {
            const smallSource = 'flowchart LR\n  A --> B';
            const smallWide = new MermaidWidget(smallSource, 11, 640);
            const smallDom = smallWide.toDOM(view);
            const smallSvg = smallDom.querySelector('svg');
            expect(new MermaidWidget(smallSource, 11, 320).updateDOM(smallDom, view, smallWide)).toBe(true);
            expect(smallDom.querySelector('svg')).toBe(smallSvg);

            const wideSource =
                'flowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record]';
            const wideWidget = new MermaidWidget(wideSource, 11, 640);
            const wideDom = wideWidget.toDOM(view);
            const wideSvg = wideDom.querySelector('svg');
            expect(new MermaidWidget(wideSource, 11, 320).updateDOM(wideDom, view, wideWidget)).toBe(true);
            expect(wideDom.querySelector('svg')).not.toBe(wideSvg);
            expect(wideDom.querySelectorAll('svg.pele')).toHaveLength(1);

            // A different click target cannot be patched in place because the click handler captures it.
            expect(new MermaidWidget(wideSource, 12, 320).updateDOM(wideDom, view, wideWidget)).toBe(false);
        } finally {
            view.destroy();
        }
    });
});
