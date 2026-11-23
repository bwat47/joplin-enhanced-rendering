import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

import type { CodeMirrorControl } from 'api/types';
import createContentScript, { enhancedRenderingExtension } from './enhancedRendering';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';
import { BLOCK_PREVIEW, RENDERED_MATH_BLOCK, RENDERED_MERMAID } from './testing/selectors';

function createView(doc: string, cursorPos = 0, includeMath = true): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);

    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: { anchor: cursorPos },
            extensions: [createJoplinMarkdownExtension(includeMath), enhancedRenderingExtension],
        }),
    });
}

describe('enhancedRendering content script', () => {
    it('registers the CM6 extension when cm6 is available', () => {
        const addExtension = vi.fn();
        const control = {
            cm6: {},
            addExtension,
        } as unknown as CodeMirrorControl;

        const module = createContentScript();
        module.plugin(control);

        expect(addExtension).toHaveBeenCalledTimes(1);
        expect(addExtension).toHaveBeenCalledWith(enhancedRenderingExtension);
    });

    it('skips registration when cm6 is not available', () => {
        const addExtension = vi.fn();
        const control = {
            cm6: undefined,
            addExtension,
        } as unknown as CodeMirrorControl;

        const module = createContentScript();
        module.plugin(control);

        expect(addExtension).not.toHaveBeenCalled();
    });

    it('exports the bundled stylesheet asset', () => {
        const module = createContentScript();

        expect(module.assets?.()).toEqual([{ name: './enhancedRendering.css' }]);
    });
});

describe('enhancedRenderingExtension integration', () => {
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

    it('renders Mermaid code blocks as block SVG widgets and reveals source when selection overlaps', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nOutro';
        const view = track(createView(doc, 0));

        expect(view.dom.querySelectorAll(`${RENDERED_MERMAID} > svg.pele`)).toHaveLength(1);
        expect(view.contentDOM.textContent).not.toContain('flowchart LR');

        // Move cursor onto the opening fence line -> should expand back to raw Markdown.
        const fenceStart = doc.indexOf('```mermaid');
        view.dispatch({ selection: { anchor: fenceStart } });
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(0);
        expect(view.contentDOM.textContent).toContain('flowchart LR');

        // Move cursor back to Outro -> should re-render the diagram.
        view.dispatch({ selection: { anchor: doc.length } });
        expect(view.dom.querySelectorAll(`${RENDERED_MERMAID} > svg.pele`)).toHaveLength(1);
    });

    it('gives identical Mermaid diagrams distinct SVG ID prefixes', () => {
        const doc = 'Top\n\n```mermaid\nsankey-beta\nA,B,10\n```\n\n```mermaid\nsankey-beta\nA,B,10\n```';
        const view = track(createView(doc, 0));

        const svgs = Array.from(view.dom.querySelectorAll(`${RENDERED_MERMAID} > svg.pele`));
        expect(svgs).toHaveLength(2);

        const idsA = Array.from(svgs[0]!.querySelectorAll('[id]')).map((el) => el.id);
        const idsB = Array.from(svgs[1]!.querySelectorAll('[id]')).map((el) => el.id);
        expect(idsA.length).toBeGreaterThan(0);
        expect(idsB.length).toBeGreaterThan(0);
        expect(idsA.some((id) => idsB.includes(id))).toBe(false);
    });

    it('renders Mermaid syntax errors cleanly without crashing', () => {
        const doc = 'Top\n\n```mermaid\nnotvalid ???\n```';
        const view = track(createView(doc, 0));

        const widget = view.dom.querySelector<HTMLElement>(RENDERED_MERMAID);
        expect(widget?.dataset.renderError).toBe('true');
        expect(widget?.querySelector('.cm-enhanced-rendering-error')?.textContent).toContain('Mermaid syntax error:');
    });

    it('renders display block math and inline math with KaTeX and reveals on cursor overlap', () => {
        const doc = 'Intro\n\n$$\nx^2 + y^2 = z^2\n$$\n\nInline $E = mc^2$ and code `$a$` here.';
        const view = track(createView(doc, 0));

        expect(view.dom.querySelectorAll(`${RENDERED_MATH_BLOCK} .katex-display`)).toHaveLength(1);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math .katex')).toHaveLength(1);
        expect(view.contentDOM.textContent).toContain('`$a$`');

        // Cursor inside inline math reveals only the inline math.
        const inlineStart = doc.indexOf('$E = mc^2$');
        view.dispatch({ selection: { anchor: inlineStart + 2 } });
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(0);
        expect(view.dom.querySelectorAll(RENDERED_MATH_BLOCK)).toHaveLength(1);

        // Cursor inside block math reveals block math and re-renders inline math.
        const blockStart = doc.indexOf('$$');
        view.dispatch({ selection: { anchor: blockStart + 3 } });
        expect(view.dom.querySelectorAll(RENDERED_MATH_BLOCK)).toHaveLength(0);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math .katex')).toHaveLength(1);
    });

    it('renders invalid KaTeX math as an inline/block error widget', () => {
        const doc = 'Top\n\n$$\n\\frac{1}\n$$\n\nBad $\\frac{1}$ here.';
        const view = track(createView(doc, 0));

        const blockErr = view.dom.querySelector<HTMLElement>(RENDERED_MATH_BLOCK);
        const inlineErr = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math');

        expect(blockErr?.dataset.renderError).toBe('true');
        expect(blockErr?.querySelector('.cm-enhanced-rendering-error')?.textContent).toContain('KaTeX error:');
        expect(inlineErr?.dataset.renderError).toBe('true');
        expect(inlineErr?.querySelector('.cm-enhanced-rendering-error')?.textContent).toBe('\\frac{1}');
    });

    it('respects Joplin disabling math parsing while still rendering Mermaid', () => {
        const doc = 'Intro $x^2$\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createView(doc, 0, false));

        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(0);
        expect(view.dom.querySelectorAll(`${RENDERED_MERMAID} > svg.pele`)).toHaveLength(1);
    });

    it('expands rendered widgets back to Markdown when clicked', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nText $x + 1$ end.';
        const view = track(createView(doc, 0));

        const mermaidWidget = view.dom.querySelector<HTMLElement>(RENDERED_MERMAID);
        expect(mermaidWidget).not.toBeNull();
        mermaidWidget!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

        const bodyStart = doc.indexOf('flowchart LR');
        expect(view.state.selection.main.head).toBe(bodyStart);
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(0);

        // Now click the inline math widget.
        const inlineWidget = view.dom.querySelector<HTMLElement>('.cm-enhanced-rendering-math');
        expect(inlineWidget).not.toBeNull();
        inlineWidget!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

        const inlineContentStart = doc.indexOf('x + 1');
        expect(view.state.selection.main.head).toBe(inlineContentStart);
        expect(view.dom.querySelectorAll('.cm-enhanced-rendering-math')).toHaveLength(0);
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(1);
    });

    it('updates the rendered diagram after editing raw Mermaid source', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nEnd';
        const view = track(createView(doc, 0));

        expect(view.dom.querySelector(RENDERED_MERMAID)?.textContent).toContain('Alpha');

        const alphaPos = doc.indexOf('Alpha');
        view.dispatch({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        });
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(0);

        view.dispatch({ selection: { anchor: 0 } });
        const svgText = view.dom.querySelector(RENDERED_MERMAID)?.textContent ?? '';
        expect(svgText).toContain('Gamma');
        expect(svgText).not.toContain('Alpha');
    });

    it('shows a live preview below revealed block source and removes it on leave', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\n$$\nx^2\n$$\n\nInline $a$ end.';
        const view = track(createView(doc, 0));
        expect(view.dom.querySelectorAll(BLOCK_PREVIEW)).toHaveLength(0);

        view.dispatch({ selection: { anchor: doc.indexOf('Alpha') } });
        const mermaidPreview = view.dom.querySelector<HTMLElement>(`${BLOCK_PREVIEW}.cm-enhanced-rendering-mermaid`);
        expect(mermaidPreview?.querySelector('svg.pele')?.textContent).toContain('Alpha');
        expect(mermaidPreview?.getAttribute('aria-label')).toBe('Mermaid diagram preview');
        // The preview follows the closing fence line, after the revealed source.
        const closingFence = view.domAtPos(doc.indexOf('```\n\n$$')).node;
        expect(closingFence.compareDocumentPosition(mermaidPreview!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        view.dispatch({ selection: { anchor: doc.indexOf('x^2') } });
        expect(view.dom.querySelectorAll(BLOCK_PREVIEW)).toHaveLength(1);
        expect(
            view.dom.querySelector(`${BLOCK_PREVIEW}.cm-enhanced-rendering-math-block .katex-display`)
        ).not.toBeNull();
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(1);

        // Inline math reveals without a preview.
        view.dispatch({ selection: { anchor: doc.indexOf('$a$') + 1 } });
        expect(view.dom.querySelectorAll(BLOCK_PREVIEW)).toHaveLength(0);
        expect(view.dom.querySelectorAll(RENDERED_MATH_BLOCK)).toHaveLength(1);
    });

    it('updates the live preview while editing revealed source', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nEnd';
        const alphaPos = doc.indexOf('Alpha');
        const view = track(createView(doc, alphaPos));

        view.dispatch({
            changes: { from: alphaPos, to: alphaPos + 'Alpha'.length, insert: 'Gamma' },
            selection: { anchor: alphaPos + 'Gamma'.length },
        });

        const previewText = view.dom.querySelector(BLOCK_PREVIEW)?.textContent ?? '';
        expect(previewText).toContain('Gamma');
        expect(previewText).not.toContain('Alpha');
        expect(view.dom.querySelectorAll(RENDERED_MERMAID)).toHaveLength(0);
    });

    it('shows render errors in the live preview while editing', () => {
        const doc = 'Top\n\n$$\nx^2\n$$';
        const texPos = doc.indexOf('x^2');
        const view = track(createView(doc, texPos));

        view.dispatch({ changes: { from: texPos, insert: '\\frac{' } });

        const preview = view.dom.querySelector<HTMLElement>(BLOCK_PREVIEW);
        expect(preview?.dataset.renderError).toBe('true');
        expect(preview?.textContent).toContain('KaTeX error:');
    });

    it('keeps the selection when the live preview is clicked', () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  Alpha --> Beta\n```\n\nEnd';
        const betaPos = doc.indexOf('Beta');
        const view = track(createView(doc, betaPos));
        const preview = view.dom.querySelector<HTMLElement>(BLOCK_PREVIEW)!;

        const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
        preview.dispatchEvent(mousedown);
        preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

        expect(mousedown.defaultPrevented).toBe(true);
        expect(view.state.selection.main.head).toBe(betaPos);
        expect(view.dom.querySelectorAll(BLOCK_PREVIEW)).toHaveLength(1);
    });
});
