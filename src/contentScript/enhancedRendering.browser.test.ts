import {
    cursorDocEnd,
    cursorDocStart,
    cursorLineDown,
    cursorLineUp,
    selectLineDown,
    selectLineUp,
} from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, rectangularSelection } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { enhancedRenderingExtension } from './enhancedRendering';
import { clearMermaidRenderCache, MermaidWidget } from './mermaidRenderer';
import { resetLastKnownMermaidWidth } from './mermaidWidth';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';
import { BLOCK_PREVIEW, RENDERED_MATH_BLOCK, RENDERED_MERMAID } from './testing/selectors';

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

/** Waits two animation frames so CodeMirror measure/update cycles and widget callbacks settle. */
function nextFrames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

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

        const svg = view.dom.querySelector<SVGSVGElement>(`${RENDERED_MERMAID} > svg.pele`);
        expect(svg).not.toBeNull();

        const rect = svg!.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(50);
        expect(rect.height).toBeGreaterThan(20);

        const widget = view.dom.querySelector<HTMLElement>(RENDERED_MERMAID)!;
        view.focus();
        await userEvent.click(widget, { delay: 100 });

        expect(view.dom.querySelector(RENDERED_MERMAID)).toBeNull();
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));
    });

    it('restores KaTeX_Main font family despite Joplin span font-family: inherit rule', () => {
        const doc = 'Intro\n\n$$\n\\frac{a + b}{c}\n$$\n\nInline $E = mc^2$ text.';
        const view = track(createBrowserView(doc, 0));

        const inlineKatex = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math .katex');
        const blockKatex = view.dom.querySelector<HTMLElement>(`${RENDERED_MATH_BLOCK} .katex`);
        expect(inlineKatex).not.toBeNull();
        expect(blockKatex).not.toBeNull();

        expect(getComputedStyle(inlineKatex!).fontFamily).toContain('KaTeX_Main');
        expect(getComputedStyle(blockKatex!).fontFamily).toContain('KaTeX_Main');
        expect(blockKatex!.getBoundingClientRect().height).toBeGreaterThan(15);
    });

    it('reveals a Mermaid block when moving the cursor into it with ArrowDown or ArrowUp', () => {
        const doc = 'Line above\n```mermaid\nflowchart LR\n  A --> B\n```\nLine below';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();

        cursorLineDown(view);

        expect(view.dom.querySelector(RENDERED_MERMAID)).toBeNull();
        expect(view.contentDOM.textContent).toContain('flowchart LR');

        // Move to Line below so it re-renders, then press ArrowUp to enter from below.
        view.dispatch({ selection: { anchor: doc.indexOf('Line below') } });
        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();

        cursorLineUp(view);

        expect(view.dom.querySelector(RENDERED_MERMAID)).toBeNull();
        expect(view.contentDOM.textContent).toContain('flowchart LR');
    });

    it.each([
        ['Mermaid', '```mermaid\nflowchart LR\n  A --> B\n```'],
        ['display math', '$$\nx^2 + y^2\n$$'],
    ])('moves the cursor past the live preview of a revealed %s block with ArrowDown and ArrowUp', (_label, block) => {
        const doc = `Line above\n${block}\nLine below`;
        const closeLine = block.slice(block.lastIndexOf('\n') + 1);
        const closeLineFrom = doc.lastIndexOf(closeLine);
        const view = track(createBrowserView(doc, closeLineFrom));

        expect(view.dom.querySelector(BLOCK_PREVIEW)).not.toBeNull();

        cursorLineDown(view);
        expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('Line below');

        // Re-enter from below: the cursor lands on the closing line, not inside the preview.
        cursorLineUp(view);
        expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe(closeLine);
        expect(view.dom.querySelector(BLOCK_PREVIEW)).not.toBeNull();
    });

    it('does not redirect cursorDocEnd or cursorDocStart into a rendered block between the first and last lines', () => {
        const doc = 'Line above\n```mermaid\nflowchart LR\n  A --> B\n```\nLine below';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();

        cursorDocEnd(view);

        expect(view.state.selection.main.head).toBe(doc.length);
        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();

        cursorDocStart(view);

        expect(view.state.selection.main.head).toBe(0);
        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();
    });

    it('applies dark fallback Pele CSS variables under a dark CodeMirror theme', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createBrowserView(doc, 0, [EditorView.theme({}, { dark: true })]));

        const container = view.dom.querySelector<HTMLElement>(RENDERED_MERMAID)!;
        expect(getComputedStyle(container).getPropertyValue('--pele-bg').trim()).toBe('#1d2024');
        expect(getComputedStyle(container).getPropertyValue('--pele-fg').trim()).toBe('#dddddd');
    });

    it('renders $$...$$ math inside Mermaid diagrams with measured MathML layout', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A["$$x^2 + y^2 = z^2$$"] --> B["$$\\frac{a}{b}$$"]\n```';
        const view = track(createBrowserView(doc, 0));

        const mathObjects = Array.from(
            view.dom.querySelectorAll<SVGForeignObjectElement>(`${RENDERED_MERMAID} foreignObject.pele-math`)
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
        await nextFrames();

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

    it('snaps a mouse drag reaching into the near half of a rendered Mermaid block to cover all of it', () => {
        const mermaid = '```mermaid\nflowchart LR\n  A --> B\n```';
        const doc = `Heading\n\n${mermaid}\n\nFooter`;
        const from = doc.indexOf(mermaid);
        const to = from + mermaid.length;
        const footer = doc.indexOf('Footer');

        for (const [anchor, fraction, expectedHead] of [
            [0, 0.25, to],
            [footer, 0.75, from],
        ] as const) {
            const view = track(createBrowserView(doc, anchor));
            const rect = view.dom.querySelector(RENDERED_MERMAID)!.getBoundingClientRect();
            view.contentDOM.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 })
            );

            // The near half of a block widget maps to the block boundary the drag came from.
            const head = view.posAtCoords({ x: rect.left + rect.width / 2, y: rect.top + rect.height * fraction });
            expect(head).toBe(expectedHead === to ? from : to);
            view.dispatch({ selection: { anchor, head: head! }, userEvent: 'select.pointer' });

            expect(view.state.selection.main.anchor).toBe(anchor);
            expect(view.state.selection.main.head).toBe(expectedHead);
            expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();
        }
    });

    it('selects a rendered block whole when Shift+ArrowDown or Shift+ArrowUp crosses it', () => {
        const mermaid = '```mermaid\nflowchart LR\n  A --> B\n```';
        const doc = `Heading\n\n${mermaid}\n\nFooter`;
        const from = doc.indexOf(mermaid);
        const to = from + mermaid.length;

        const down = track(createBrowserView(doc, 0));
        selectLineDown(down);
        selectLineDown(down);
        expect(down.state.selection.main.from).toBe(0);
        expect(down.state.selection.main.to).toBeGreaterThanOrEqual(to);

        const footer = doc.indexOf('Footer');
        const up = track(createBrowserView(doc, footer));
        selectLineUp(up);
        selectLineUp(up);
        expect(up.state.selection.main.to).toBe(footer);
        expect(up.state.selection.main.from).toBeLessThanOrEqual(from);
    });

    it('freezes widget reveal during a left-button mouse drag and reveals on mouseup', async () => {
        const doc = 'Start line\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nInline $x + 1$ end line';
        const view = track(createBrowserView(doc, 0));

        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();
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
        expect(view.dom.querySelector(RENDERED_MERMAID)).not.toBeNull();
        expect(view.dom.querySelector('.cm-enhanced-rendering-math')).not.toBeNull();

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        await nextFrames();

        // After mouseup, both expand to raw Markdown while keeping the dragged selection.
        expect(view.dom.querySelector(RENDERED_MERMAID)).toBeNull();
        expect(view.dom.querySelector('.cm-enhanced-rendering-math')).toBeNull();
        expect(view.state.selection.main.from).toBe(0);
        expect(view.state.selection.main.to).toBe(doc.length);
    });

    it('places the cursor on the first content line below the opening fence when clicking Mermaid or block math', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Output]\n```\n\n$$\nx = y + z\n$$\n\nFooter';
        const view = track(createBrowserView(doc, 0));
        view.focus();

        // Click on the left padding of the Mermaid block widget.
        const mermaidWidget = view.dom.querySelector<HTMLElement>(RENDERED_MERMAID)!;
        await userEvent.click(mermaidWidget, { position: { x: 5, y: 15 } });
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));

        // Move back to Intro and click on the SVG text label inside the Mermaid diagram.
        view.dispatch({ selection: { anchor: 0 } });
        const svgLabel = view.dom.querySelector<SVGTextElement>(`${RENDERED_MERMAID} text.pele-label`)!;
        await userEvent.click(svgLabel);
        expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart LR'));

        // Click on the multi-line block math widget even when text is currently selected elsewhere.
        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const mathWidget = view.dom.querySelector<HTMLElement>(RENDERED_MATH_BLOCK)!;
        await userEvent.click(mathWidget);
        expect(view.state.selection.main.head).toBe(doc.indexOf('x = y + z'));
    });

    it('adapts wide Mermaid diagrams to narrow editor panes on resize', async () => {
        const doc =
            'Intro\n\n```mermaid\nflowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Persist Record] --> E[Send Notification]\n```\n\nFooter';
        const view = track(createBrowserView(doc, 0));
        const parent = view.dom.parentElement!;

        await nextFrames();

        const wideSvg = view.dom.querySelector<SVGSVGElement>(`${RENDERED_MERMAID} > svg.pele`)!;
        const wideWidth = Number(wideSvg.getAttribute('width'));
        const wideHeight = Number(wideSvg.getAttribute('height'));
        expect(wideWidth).toBeGreaterThan(wideHeight);

        // Narrow the editor container and wait for the debounced width update.
        parent.style.width = '360px';
        await new Promise((resolve) => setTimeout(resolve, 300));

        const narrowSvg = view.dom.querySelector<SVGSVGElement>(`${RENDERED_MERMAID} > svg.pele`)!;
        const narrowWidth = Number(narrowSvg.getAttribute('width'));
        const narrowHeight = Number(narrowSvg.getAttribute('height'));
        expect(narrowWidth).toBeLessThan(wideWidth);
        expect(narrowHeight).toBeGreaterThan(narrowWidth);

        // Widen back to desktop width and verify it returns to horizontal layout.
        parent.style.width = '700px';
        await new Promise((resolve) => setTimeout(resolve, 300));

        const restoredSvg = view.dom.querySelector<SVGSVGElement>(`${RENDERED_MERMAID} > svg.pele`)!;
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
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(1);
        expect(initialWidgets[0]!.estimatedHeight).toBeGreaterThan(0);
        // The off-screen diagram has a decoration, but has not been rendered yet.
        expect(initialWidgets[1]!.estimatedHeight).toBe(-1);

        // Narrow the pane: only the mounted diagram re-renders; the off-screen one stays unrendered.
        view.dom.parentElement!.style.width = '360px';
        await new Promise((resolve) => setTimeout(resolve, 300));
        const narrowedWidgets = getMermaidWidgets();
        expect(narrowedWidgets).toHaveLength(2);
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(1);
        expect(narrowedWidgets[0]!.estimatedHeight).toBeGreaterThan(0);
        expect(narrowedWidgets[1]!.estimatedHeight).toBe(-1);

        view.dispatch({ effects: EditorView.scrollIntoView(doc.length - 'End'.length, { y: 'end' }) });
        await nextFrames();

        const bottomSvg = Array.from(view.dom.querySelectorAll<SVGSVGElement>(`${RENDERED_MERMAID} > svg.pele`)).find(
            (svg) => svg.textContent.includes('Bottom')
        );
        expect(bottomSvg).toBeDefined();
        expect(narrowedWidgets[1]!.estimatedHeight).toBeGreaterThan(0);
        // Rendered lazily at the narrow width, so the long LR chain wraps into a taller layout.
        expect(Number(bottomSvg!.getAttribute('height'))).toBeGreaterThan(Number(bottomSvg!.getAttribute('width')));
    });

    it('scrolls wide display math inside the block widget without expanding the editor or shifting other math on narrow viewports', async () => {
        const longMath =
            '$$\n' +
            'a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}\n' +
            '+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}\n' +
            '+a_{16}+a_{17}+a_{18}+a_{19}+a_{20}\n' +
            '$$';
        const shortMath = '$$\nx^2 + y^2 = z^2\n$$';
        const filler = 'Filler line.\n\n'.repeat(120);
        const doc = `Top\n\n${shortMath}\n\n${filler}Before long:\n\n${shortMath}\n\nVery long horizontal expression:\n\n${longMath}\n\nEnd`;

        const view = track(
            createBrowserView(doc, 0, [
                EditorView.lineWrapping,
                EditorView.theme({
                    '&': { height: '400px' },
                    '& .cm-scroller': { overflow: 'auto' },
                }),
            ])
        );
        view.dom.parentElement!.style.width = '360px';

        await nextFrames();

        const initialContentWidth = view.contentDOM.getBoundingClientRect().width;
        expect(initialContentWidth).toBeLessThanOrEqual(360);

        const topShortBlock = view.dom.querySelector<HTMLElement>(RENDERED_MATH_BLOCK)!;
        const topShortBase = topShortBlock.querySelector<HTMLElement>('.katex-html .katex-base')!;
        const topShortCenterX =
            topShortBase.getBoundingClientRect().left + topShortBase.getBoundingClientRect().width / 2;

        // Scroll the wide expression (and the second short expression above it) into view.
        ensureSyntaxTree(view.state, doc.length, 5000);
        view.dispatch({ effects: EditorView.scrollIntoView(doc.length - 'End'.length, { y: 'end' }) });
        await nextFrames();

        const mathBlocks = Array.from(view.dom.querySelectorAll<HTMLElement>(RENDERED_MATH_BLOCK));
        expect(mathBlocks.length).toBeGreaterThanOrEqual(2);
        const bottomShortBlock = mathBlocks[mathBlocks.length - 2]!;
        const longBlock = mathBlocks[mathBlocks.length - 1]!;

        // Editor width must stay bounded to the viewport instead of expanding to fit the wide formula.
        expect(view.contentDOM.getBoundingClientRect().width).toBeLessThanOrEqual(360);
        expect(view.scrollDOM.scrollWidth).toBe(view.scrollDOM.clientWidth);

        // The wide display math block itself should overflow horizontally and be scrollable.
        expect(longBlock.getBoundingClientRect().width).toBeLessThanOrEqual(360);
        expect(longBlock.scrollWidth).toBeGreaterThan(longBlock.clientWidth);

        // The start of the overflowing expression must remain reachable (not clipped off the left edge).
        const firstTerm = longBlock.querySelector<HTMLElement>('.katex-html .katex-base')!;
        expect(firstTerm.getBoundingClientRect().left).toBeGreaterThanOrEqual(longBlock.getBoundingClientRect().left);

        // Scrolling the block horizontally reaches the trailing terms without scrolling the editor.
        longBlock.scrollLeft = longBlock.scrollWidth;
        expect(longBlock.scrollLeft).toBeGreaterThan(0);
        expect(view.scrollDOM.scrollLeft).toBe(0);

        // Other centered display math expressions must stay centered in the viewport, not shift right.
        const bottomShortBase = bottomShortBlock.querySelector<HTMLElement>('.katex-html .katex-base')!;
        const bottomShortCenterX =
            bottomShortBase.getBoundingClientRect().left + bottomShortBase.getBoundingClientRect().width / 2;
        expect(Math.abs(bottomShortCenterX - topShortCenterX)).toBeLessThan(2);
    });

    it('keeps tags beside their equations when display math scrolls', async () => {
        const longFormula = Array.from({ length: 22 }, (_, index) => `a_{${index + 1}}`).join('+');
        const doc = `Intro\n\n$$\nx^2\\tag{1}\n$$\n\n$$\n${longFormula}\\tag{123}\n$$\n\nEnd`;
        const view = track(createBrowserView(doc, 0, [EditorView.lineWrapping]));
        view.dom.parentElement!.style.width = '360px';
        await document.fonts.ready;

        const blocks = view.dom.querySelectorAll<HTMLElement>(RENDERED_MATH_BLOCK);
        const shortBlock = blocks[0]!;
        const shortRect = shortBlock.getBoundingClientRect();
        const shortTerm = shortBlock.querySelector('.katex-base')!.getBoundingClientRect();
        const shortTag = shortBlock.querySelector('.katex-tag')!.getBoundingClientRect();
        expect(Math.abs((shortTerm.left + shortTerm.right - shortRect.left - shortRect.right) / 2)).toBeLessThan(1);
        expect(shortTag.left).toBeGreaterThan(shortTerm.right);
        expect(shortRect.right - shortTag.right).toBeLessThan(20);

        const block = blocks[1]!;
        const terms = block.querySelectorAll('.katex-base');
        const rightmostTerm = terms[terms.length - 1]!;
        const tag = block.querySelector('.katex-tag')!;
        expect(tag.getBoundingClientRect().left).toBeGreaterThan(rightmostTerm.getBoundingClientRect().right);
        expect(block.scrollWidth).toBeGreaterThan(block.clientWidth);
        expect(view.scrollDOM.scrollWidth).toBe(view.scrollDOM.clientWidth);

        block.scrollLeft = block.scrollWidth;
        const visibleLeft = block.getBoundingClientRect().left + block.clientLeft;
        const visibleRight = visibleLeft + block.clientWidth;
        expect(block.scrollLeft).toBeGreaterThan(0);
        expect(rightmostTerm.getBoundingClientRect().left).toBeGreaterThanOrEqual(visibleLeft);
        expect(tag.getBoundingClientRect().right).toBeLessThanOrEqual(visibleRight + 1);
        expect(view.scrollDOM.scrollLeft).toBe(0);
    });

    it('shows a short final line and its tag together when an earlier line overflows', async () => {
        const longFormula = Array.from({ length: 30 }, (_, index) => `a_{${index + 1}}`).join('+');
        const doc = `Intro\n\n$$\n${longFormula} \\newline z \\tag{1}\n$$\n\nEnd`;
        const view = track(createBrowserView(doc, 0, [EditorView.lineWrapping]));
        view.dom.parentElement!.style.width = '360px';
        await document.fonts.ready;

        const block = view.dom.querySelector<HTMLElement>(RENDERED_MATH_BLOCK)!;
        const terms = Array.from(block.querySelectorAll('.katex-html .katex-base'));
        const finalTerm = terms.pop()!;
        const lastWideTerm = terms.pop()!;
        const tag = block.querySelector('.katex-tag')!;
        const visibleLeft = block.getBoundingClientRect().left + block.clientLeft;
        const visibleRight = visibleLeft + block.clientWidth;

        expect(finalTerm.getBoundingClientRect().left).toBeGreaterThanOrEqual(visibleLeft);
        expect(tag.getBoundingClientRect().left).toBeGreaterThan(finalTerm.getBoundingClientRect().right);
        expect(tag.getBoundingClientRect().right).toBeLessThanOrEqual(visibleRight);
        expect(lastWideTerm.getBoundingClientRect().right).toBeGreaterThan(visibleRight);

        block.scrollLeft = block.scrollWidth;
        expect(lastWideTerm.getBoundingClientRect().right).toBeLessThanOrEqual(visibleRight + 1);
        expect(view.scrollDOM.scrollLeft).toBe(0);
    });

    it('aligns the tag with the last line after an explicit line break', async () => {
        const doc = 'Intro\n\n$$\na \\newline 1\\frac{b}{c} \\tag{1}\n$$';
        const view = track(createBrowserView(doc));
        await document.fonts.ready;
        const block = view.dom.querySelector(RENDERED_MATH_BLOCK)!;
        const terms = block.querySelectorAll('.katex-html .katex-base');
        expect(terms).toHaveLength(2);
        const lastLine = terms[1]!.getBoundingClientRect();
        expect(lastLine.top).toBeGreaterThanOrEqual(terms[0]!.getBoundingClientRect().bottom);
        const tag = block.querySelector('.katex-tag')!;
        expect(tag.textContent).toBe('(1)');
        const finalLineText = terms[1]!.querySelector('.mord')!.getBoundingClientRect();
        const tagText = tag.querySelector('.mord')!.getBoundingClientRect();
        expect(Math.abs(tagText.top - finalLineText.top)).toBeLessThan(1);
    });

    it('keeps a tag from adding space below a short final line', async () => {
        const equation = String.raw`\left(\dfrac{1}{\dfrac{1}{\dfrac{1}{\dfrac{1}{x}}}}\right) \newline a`;
        const doc = `Intro\n\n$$\n${equation}\n$$\n\n$$\n${equation} \\tag{1}\n$$`;
        const view = track(createBrowserView(doc));
        await document.fonts.ready;
        const equations = view.dom.querySelectorAll(`${RENDERED_MATH_BLOCK} .katex-html`);
        expect(equations).toHaveLength(2);
        const untagged = equations[0]!.getBoundingClientRect();
        const tagged = equations[1]!.getBoundingClientRect();
        expect(tagged.height).toBeLessThan(untagged.height + 1);
    });

    it('places the tag on the blank line after a trailing explicit line break', async () => {
        const doc = 'Intro\n\n$$\na \\newline \\tag{1}\n$$';
        const view = track(createBrowserView(doc));
        await document.fonts.ready;
        const block = view.dom.querySelector(RENDERED_MATH_BLOCK)!;
        const firstLine = block.querySelector('.katex-base')!.getBoundingClientRect();
        const tagText = block.querySelector('.katex-tag .mord')!.getBoundingClientRect();
        expect(tagText.top).toBeGreaterThanOrEqual(firstLine.bottom - 1);
    });

    it('keeps a display math block at full editor width when the cursor is on the following line', async () => {
        const doc = '$$\nx^2 + y^2 = z^2\n$$';
        const view = track(createBrowserView(doc, 0, [EditorView.lineWrapping]));
        view.dom.parentElement!.style.width = '360px';

        // Add a trailing line and place the cursor there so the math block renders instead of revealing its source.
        const docWithTrailingLine = `${doc}\n`;
        view.dispatch({
            changes: { from: 0, to: doc.length, insert: docWithTrailingLine },
            selection: { anchor: docWithTrailingLine.length },
        });
        await nextFrames();

        const block = view.dom.querySelector<HTMLElement>(RENDERED_MATH_BLOCK)!;
        expect(block.getBoundingClientRect().width).toBeGreaterThan(300);
        expect(block.getBoundingClientRect().width).toBeLessThanOrEqual(360);
    });

    it('suppresses native ::selection highlights on Mermaid and display math block widgets', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A["$$x^2$$"] --> B[Output]\n```\n\n$$\nE = mc^2\n$$\n\nOutro';
        const joplinFocusedSelection = EditorView.theme({
            '&.cm-focused ::selection': {
                backgroundColor: 'rgb(0, 102, 204) !important',
                color: 'rgb(255, 255, 255) !important',
            },
        });
        const view = track(createBrowserView(doc, 0, [joplinFocusedSelection]));

        const targets: Element[] = [
            view.dom.querySelector(RENDERED_MERMAID)!,
            view.dom.querySelector(`${RENDERED_MERMAID} text.pele-label`)!,
            view.dom.querySelector(`${RENDERED_MERMAID} foreignObject.pele-math math`)!,
            view.dom.querySelector(RENDERED_MATH_BLOCK)!,
            view.dom.querySelector(`${RENDERED_MATH_BLOCK} .mord`)!,
        ];

        for (const focused of [false, true]) {
            if (focused) {
                view.focus();
            }
            await expect.poll(() => view.dom.classList.contains('cm-focused')).toBe(focused);
            for (const target of targets) {
                expect(target).not.toBeNull();
                const selectionStyle = getComputedStyle(target, '::selection');
                expect(selectionStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
                expect(selectionStyle.color).toBe(getComputedStyle(target).color);
            }
        }
    });
});
