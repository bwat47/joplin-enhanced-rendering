import { cursorLineDown, cursorLineUp } from '@codemirror/commands';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { enhancedRenderingExtension } from './enhancedRendering';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

// Simulates Joplin's CM6 theme rules from packages/editor/CodeMirror/theme.ts that could
// otherwise interfere with KaTeX font family and math colors.
const joplinThemeOverrides = EditorView.theme({
    '&': {
        fontFamily: 'sans-serif',
        color: '#222222',
    },
    '& div, & span, & a': {
        fontFamily: 'inherit',
    },
    '& .cm-mathBlock, & .cm-inlineMath': {
        color: '#227766',
    },
});

function createBrowserView(doc: string, cursorPos = 0, extraExtensions: Extension[] = []): EditorView {
    const parent = document.createElement('div');
    parent.style.width = '700px';
    document.body.append(parent);

    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: { anchor: cursorPos },
            extensions: [
                createJoplinMarkdownExtension(),
                joplinThemeOverrides,
                enhancedRenderingExtension,
                ...extraExtensions,
            ],
        }),
    });
}

describe('enhancedRenderingExtension (browser)', () => {
    let views: EditorView[] = [];

    const track = (view: EditorView): EditorView => {
        views.push(view);
        return view;
    };

    afterEach(() => {
        for (const view of views) {
            view.destroy();
            view.dom.parentElement?.remove();
        }
        views = [];
    });

    it('renders a Pele Mermaid SVG with non-zero layout dimensions and supports click-to-edit', () => {
        const doc = 'Heading\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Output]\n```\n\nFooter';
        const view = track(createBrowserView(doc, 0));

        const svg = view.dom.querySelector<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele');
        expect(svg).not.toBeNull();

        const rect = svg!.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(50);
        expect(rect.height).toBeGreaterThan(20);

        const widget = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-mermaid')!;
        widget.click();

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).toBeNull();
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));
    });

    it('restores KaTeX_Main font family despite Joplin span font-family: inherit rule', () => {
        const doc = 'Intro\n\n$$\n\\frac{a + b}{c}\n$$\n\nInline $E = mc^2$ text.';
        const view = track(createBrowserView(doc, 0));

        const inlineKatex = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math .katex');
        const blockKatex = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math-block .katex');
        expect(inlineKatex).not.toBeNull();
        expect(blockKatex).not.toBeNull();

        expect(getComputedStyle(inlineKatex!).fontFamily).toContain('KaTeX_Main');
        expect(getComputedStyle(blockKatex!).fontFamily).toContain('KaTeX_Main');
        expect(blockKatex!.getBoundingClientRect().height).toBeGreaterThan(15);
    });

    it('reveals a Mermaid block when moving the cursor into it with ArrowDown or ArrowUp', () => {
        const doc = 'Line above\n```mermaid\nflowchart LR\n  A --> B\n```\nLine below';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();

        cursorLineDown(view);

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).toBeNull();
        expect(view.contentDOM.textContent).toContain('flowchart LR');

        // Move to Line below so it re-renders, then press ArrowUp to enter from below.
        view.dispatch({ selection: { anchor: doc.indexOf('Line below') } });
        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();

        cursorLineUp(view);

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).toBeNull();
        expect(view.contentDOM.textContent).toContain('flowchart LR');
    });

    it('applies dark fallback Pele CSS variables under a dark CodeMirror theme', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createBrowserView(doc, 0, [EditorView.theme({}, { dark: true })]));

        const container = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-mermaid')!;
        expect(getComputedStyle(container).getPropertyValue('--pele-bg').trim()).toBe('#1d2024');
        expect(getComputedStyle(container).getPropertyValue('--pele-fg').trim()).toBe('#dddddd');
    });
});
