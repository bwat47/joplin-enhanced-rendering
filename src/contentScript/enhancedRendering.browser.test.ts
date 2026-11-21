import { cursorDocEnd, cursorDocStart, cursorLineDown, cursorLineUp } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, rectangularSelection } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { enhancedRenderingExtension } from './enhancedRendering';
import { clearMermaidRenderCache, MermaidWidget } from './mermaidRenderer';
import { resetLastKnownMermaidWidth } from './mermaidWidth';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

// Match Joplin's createEditor.ts, which disables Chrome EditContext and uses contenteditable.
(EditorView as unknown as { EDIT_CONTEXT: boolean }).EDIT_CONTEXT = false;

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
                EditorState.allowMultipleSelections.of(true),
                rectangularSelection(),
                drawSelection(),
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
        clearMermaidRenderCache();
        resetLastKnownMermaidWidth();
    });

    it('renders a Pele Mermaid SVG with non-zero layout dimensions and supports click-to-edit', async () => {
        const doc = 'Heading\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Output]\n```\n\nFooter';
        const view = track(createBrowserView(doc, 0));

        const svg = view.dom.querySelector<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele');
        expect(svg).not.toBeNull();

        const rect = svg!.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(50);
        expect(rect.height).toBeGreaterThan(20);

        const widget = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-mermaid')!;
        view.focus();
        await userEvent.click(widget, { delay: 100 });

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

    it('does not redirect cursorDocEnd or cursorDocStart into a rendered block between the first and last lines', () => {
        const doc = 'Line above\n```mermaid\nflowchart LR\n  A --> B\n```\nLine below';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();

        cursorDocEnd(view);

        expect(view.state.selection.main.head).toBe(doc.length);
        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();

        cursorDocStart(view);

        expect(view.state.selection.main.head).toBe(0);
        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();
    });

    it('applies dark fallback Pele CSS variables under a dark CodeMirror theme', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createBrowserView(doc, 0, [EditorView.theme({}, { dark: true })]));

        const container = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-mermaid')!;
        expect(getComputedStyle(container).getPropertyValue('--pele-bg').trim()).toBe('#1d2024');
        expect(getComputedStyle(container).getPropertyValue('--pele-fg').trim()).toBe('#dddddd');
    });

    it('renders $$...$$ math inside Mermaid diagrams with measured MathML layout', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A["$$x^2 + y^2 = z^2$$"] --> B["$$\\frac{a}{b}$$"]\n```';
        const view = track(createBrowserView(doc, 0));

        const mathObjects = Array.from(
            view.dom.querySelectorAll<SVGForeignObjectElement>('.cm-enhanced-rendering-mermaid foreignObject.pele-math')
        );
        expect(mathObjects).toHaveLength(2);

        for (const foreignObject of mathObjects) {
            const mathEl = foreignObject.querySelector('math');
            expect(mathEl).not.toBeNull();
            const rect = mathEl!.getBoundingClientRect();
            expect(rect.width).toBeGreaterThan(5);
            expect(rect.height).toBeGreaterThan(5);
        }
    });

    it('maps clicks accurately to every visible line after scrolling past many block math and Mermaid widgets', async () => {
        const sections = Array.from({ length: 80 }, (_, i) => {
            if (i % 10 === 0) {
                return `Section ${i + 1} diagram:\n\n\`\`\`mermaid\nflowchart LR\n  A${i} --> B${i}\n\`\`\`\n`;
            }
            if (i % 5 === 0) {
                return `Section ${i + 1} matrix:\n\n$$\n\\begin{bmatrix}\n1 & 2 & 3 \\\\\n4 & 5 & 6 \\\\\n7 & 8 & 9\n\\end{bmatrix}\n$$\n`;
            }
            return `Section ${i + 1} label:\n\n$$\n\\frac{x_${i + 1} + 1}{y_${i + 1} + 2}\n$$\n`;
        }).join('\n');
        const doc = `# Top\n\n${sections}\nFinal line.`;

        const view = track(
            createBrowserView(doc, 0, [
                EditorView.theme({
                    '&': { height: '400px' },
                    '& .cm-scroller': { overflow: 'auto' },
                }),
            ])
        );

        // Scroll deep past dozens of rendered block widgets.
        view.scrollDOM.scrollTop = 4000;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        const visibleTextLines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')).filter((el) => {
            if (!el.textContent.includes('Section ')) return false;
            const rect = el.getBoundingClientRect();
            return rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom;
        });

        expect(visibleTextLines.length).toBeGreaterThan(0);

        for (const lineEl of visibleTextLines) {
            const expectedLineNumber = view.state.doc.lineAt(view.posAtDOM(lineEl)).number;
            const rect = lineEl.getBoundingClientRect();
            const clickPos = view.posAtCoords({ x: rect.left + 10, y: rect.top + rect.height / 2 });

            expect(clickPos).not.toBeNull();
            expect(view.state.doc.lineAt(clickPos!).number).toBe(expectedLineNumber);
        }
    });

    it('freezes widget reveal during a left-button mouse drag and reveals on mouseup', async () => {
        const doc = 'Start line\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nInline $x + 1$ end line';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();
        expect(view.dom.querySelector('.cm-enhanced-rendering-math')).not.toBeNull();

        const firstLine = view.contentDOM.querySelector<HTMLElement>('.cm-line')!;
        const firstRect = firstLine.getBoundingClientRect();

        firstLine.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                buttons: 1,
                clientX: firstRect.left + 5,
                clientY: firstRect.top + firstRect.height / 2,
            })
        );

        view.dispatch({
            selection: { anchor: 0, head: doc.length },
            userEvent: 'select.pointer',
        });

        // Both Mermaid and inline math remain rendered while left button is held.
        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).not.toBeNull();
        expect(view.dom.querySelector('.cm-enhanced-rendering-math')).not.toBeNull();

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // After mouseup, both expand to raw Markdown while keeping the dragged selection.
        expect(view.dom.querySelector('.cm-enhanced-rendering-mermaid')).toBeNull();
        expect(view.dom.querySelector('.cm-enhanced-rendering-math')).toBeNull();
        expect(view.state.selection.main.from).toBe(0);
        expect(view.state.selection.main.to).toBe(doc.length);
    });

    it('places the cursor on the first content line below the opening fence when clicking Mermaid or block math', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Output]\n```\n\n$$\nx = y + z\n$$\n\nFooter';
        const view = track(createBrowserView(doc, 0));
        view.focus();

        // Click on the left padding of the Mermaid block widget.
        const mermaidWidget = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-mermaid')!;
        await userEvent.click(mermaidWidget, { position: { x: 5, y: 15 } });
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));

        // Move back to Intro and click on the SVG text label inside the Mermaid diagram.
        view.dispatch({ selection: { anchor: 0 } });
        const svgLabel = view.dom.querySelector<SVGTextElement>('.cm-enhanced-rendering-mermaid text.pele-label')!;
        await userEvent.click(svgLabel);
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));

        // Click on the multi-line block math widget even when text is currently selected elsewhere.
        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const mathWidget = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math-block')!;
        await userEvent.click(mathWidget);
        expect(view.state.selection.main.head).toBe(doc.indexOf('x = y + z'));
    });

    it('adapts wide Mermaid diagrams to narrow editor panes on resize', async () => {
        const doc =
            'Intro\n\n```mermaid\nflowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record] --> E[Send Notification]\n```\n\nFooter';
        const view = track(createBrowserView(doc, 0));
        const parent = view.dom.parentElement!;

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const wideSvg = view.dom.querySelector<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele')!;
        const wideWidth = Number(wideSvg.getAttribute('width'));
        const wideHeight = Number(wideSvg.getAttribute('height'));
        expect(wideWidth).toBeGreaterThan(wideHeight);

        // Narrow the editor container and wait for the debounced width update.
        parent.style.width = '360px';
        await new Promise((resolve) => setTimeout(resolve, 300));

        const narrowSvg = view.dom.querySelector<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele')!;
        const narrowWidth = Number(narrowSvg.getAttribute('width'));
        const narrowHeight = Number(narrowSvg.getAttribute('height'));
        expect(narrowWidth).toBeLessThan(wideWidth);
        expect(narrowHeight).toBeGreaterThan(narrowWidth);

        // Widen back to desktop width and verify it returns to horizontal layout.
        parent.style.width = '700px';
        await new Promise((resolve) => setTimeout(resolve, 300));

        const restoredSvg = view.dom.querySelector<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele')!;
        expect(Number(restoredSvg.getAttribute('width'))).toBeGreaterThan(Number(restoredSvg.getAttribute('height')));
    });

    it('defers off-screen Mermaid diagrams until scrolled into view and renders them at the current width', async () => {
        const chain = 'A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record]';
        const filler = 'Filler prose line.\n\n'.repeat(400);
        const doc = `Intro\n\n\`\`\`mermaid\nflowchart LR\n  ${chain}\n\`\`\`\n\n${filler}\`\`\`mermaid\nflowchart LR\n  ${chain} --> E[Bottom]\n\`\`\`\n\nEnd`;
        const view = track(
            createBrowserView(doc, 0, [
                EditorView.theme({
                    '&': { height: '300px' },
                    '& .cm-scroller': { overflow: 'auto' },
                }),
            ])
        );
        const nextFrames = (): Promise<void> =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const getMermaidWidgets = (): MermaidWidget[] => {
            const widgets: MermaidWidget[] = [];
            for (const source of view.state.facet(EditorView.decorations)) {
                if (typeof source !== 'function') {
                    for (const iter = source.iter(); iter.value; iter.next()) {
                        const widget = (iter.value.spec as { widget?: unknown }).widget;
                        if (widget instanceof MermaidWidget) {
                            widgets.push(widget);
                        }
                    }
                }
            }
            return widgets;
        };

        // Complete parsing so both Mermaid blocks have decorations even while the bottom one is off-screen.
        ensureSyntaxTree(view.state, doc.length, 5000);
        view.dispatch({});
        await nextFrames();
        const initialWidgets = getMermaidWidgets();
        expect(initialWidgets).toHaveLength(2);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-mermaid')).toHaveLength(1);
        expect(initialWidgets[0]!.estimatedHeight).toBeGreaterThan(0);
        // The off-screen diagram has a decoration, but has not been rendered yet.
        expect(initialWidgets[1]!.estimatedHeight).toBe(-1);

        // Narrow the pane: only the mounted diagram re-renders; the off-screen one stays unrendered.
        view.dom.parentElement!.style.width = '360px';
        await new Promise((resolve) => setTimeout(resolve, 300));
        const narrowedWidgets = getMermaidWidgets();
        expect(narrowedWidgets).toHaveLength(2);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-mermaid')).toHaveLength(1);
        expect(narrowedWidgets[0]!.estimatedHeight).toBeGreaterThan(0);
        expect(narrowedWidgets[1]!.estimatedHeight).toBe(-1);

        view.dispatch({ effects: EditorView.scrollIntoView(doc.length - 'End'.length, { y: 'end' }) });
        await nextFrames();

        const bottomSvg = Array.from(
            view.dom.querySelectorAll<SVGSVGElement>('.cm-enhanced-rendering-mermaid > svg.pele')
        ).find((svg) => svg.textContent.includes('Bottom'));
        expect(bottomSvg).toBeDefined();
        expect(narrowedWidgets[1]!.estimatedHeight).toBeGreaterThan(0);
        // Rendered lazily at the narrow width, so the long LR chain wraps into a taller layout.
        expect(Number(bottomSvg!.getAttribute('height'))).toBeGreaterThan(Number(bottomSvg!.getAttribute('width')));
    });
});
