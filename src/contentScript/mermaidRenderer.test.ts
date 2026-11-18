import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

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

    it('implements widget equality and height estimation', () => {
        const result = renderMermaid('flowchart LR\n  A --> B');
        const widgetA = new MermaidWidget('flowchart LR\n  A --> B', result, 11);
        const widgetB = new MermaidWidget('flowchart LR\n  A --> B', result, 11);
        const widgetC = new MermaidWidget('flowchart TD\n  A --> B', result, 11);

        expect(widgetA.eq(widgetB)).toBe(true);
        expect(widgetA.eq(widgetC)).toBe(false);
        expect(widgetA.estimatedHeight).toBeGreaterThan(0);
        expect(widgetA.ignoreEvent()).toBe(true);
    });
});
