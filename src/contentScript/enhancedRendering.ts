import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import 'katex/dist/katex.min.css';

import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import type { OpenMermaidFullscreenMessage } from '../fullscreenMessage';
import { logger } from '../logger';
import { peleThemeVariables } from '../peleTheme';
import { blockRenderingExtension } from './blockRenderingField';
import { blockSelectionSnapFilter } from './blockSelectionSnap';
import { BLOCK_BORDER_WIDTH_PX, BLOCK_HORIZONTAL_PADDING_PX } from './blockStyle';
import { inlineMathPlugin } from './inlineMathPlugin';
import { mermaidFullscreenHandler, type MermaidFullscreenRequest } from './mermaidFullscreenButton';
import { mermaidWidthExtension } from './mermaidWidth';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';

/**
 * Neutralizes the browser's native `::selection` highlight on block widgets.
 *
 * CodeMirror's `drawSelection` only blanks native `::selection` inside `.cm-line`, while
 * `block: true` replace widgets are direct children of `.cm-content`.
 * `currentColor` preserves the element's text color when the host sets a selection color.
 */
const NATIVE_SELECTION_RESET = {
    'background-color': 'transparent !important',
    color: 'currentColor !important',
};

/**
 * Widget layout, full-screen button, error styling, KaTeX specificity overrides, and Pele CSS
 * custom properties mapped to Joplin's theme variables with CodeMirror light/dark fallbacks.
 */
const enhancedRenderingTheme = EditorView.baseTheme({
    /*
     * Block widgets in CodeMirror 6 must NOT have vertical margins: CM6's HeightMap measures each
     * block's border-box height and assumes adjacent blocks stack flush. Vertical margins cause
     * cumulative drift in `posAtCoords`, placing clicks below the clicked line. Use padding instead.
     */
    '.cm-enhanced-rendering-block': {
        display: 'block',
        boxSizing: 'border-box',
        margin: '0',
        padding: `0.6em ${BLOCK_HORIZONTAL_PADDING_PX}px`,
        border: `${BLOCK_BORDER_WIDTH_PX}px solid transparent`,
        borderRadius: '4px',
        textAlign: 'center',
        overflowX: 'auto',
        cursor: 'pointer',
        transition: 'border-color 120ms ease',
    },
    '.cm-enhanced-rendering-block:not(.cm-enhanced-rendering-preview):hover': {
        borderColor: 'var(--joplin-divider-color, rgba(128, 128, 128, 0.5))',
    },
    // Live preview below revealed block source. Inset shadows frame it without changing the
    // border box that Mermaid width measurement budgets for.
    '.cm-enhanced-rendering-preview': {
        cursor: 'default',
        boxShadow:
            'inset 2px 0 0 var(--joplin-divider-color, rgba(128, 128, 128, 0.5)), inset -2px 0 0 var(--joplin-divider-color, rgba(128, 128, 128, 0.5))',
    },
    // `&.cm-focused` copies outrank Joplin's `&.cm-focused ::selection` (`!important`, 0,2,1)
    // regardless of stylesheet order.
    '.cm-enhanced-rendering-block::selection': NATIVE_SELECTION_RESET,
    '.cm-enhanced-rendering-block ::selection': NATIVE_SELECTION_RESET,
    '&.cm-focused .cm-enhanced-rendering-block::selection': NATIVE_SELECTION_RESET,
    '&.cm-focused .cm-enhanced-rendering-block ::selection': NATIVE_SELECTION_RESET,
    // Anchors the full-screen button. Pele scales diagrams to fit, so Mermaid blocks never scroll
    // horizontally and the button can't scroll out of view.
    '.cm-enhanced-rendering-mermaid': {
        position: 'relative',
    },
    '.cm-enhanced-rendering-fullscreen-button': {
        position: 'absolute',
        top: '4px',
        right: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        padding: '0',
        border: '1px solid var(--joplin-divider-color, rgba(128, 128, 128, 0.5))',
        borderRadius: '4px',
        backgroundColor: 'var(--joplin-background-color, transparent)',
        color: 'var(--joplin-color, inherit)',
        cursor: 'pointer',
        transition: 'opacity 120ms ease',
    },
    '.cm-enhanced-rendering-fullscreen-button:hover': {
        backgroundColor: 'var(--joplin-background-color-hover3, rgba(128, 128, 128, 0.15))',
    },
    // Reveal on hover where the device can hover; touch devices keep the button visible.
    '@media (hover: hover)': {
        '.cm-enhanced-rendering-fullscreen-button': {
            opacity: '0',
        },
        '.cm-enhanced-rendering-mermaid:hover > .cm-enhanced-rendering-fullscreen-button, .cm-enhanced-rendering-fullscreen-button:focus-visible':
            {
                opacity: '1',
            },
    },
    '.cm-enhanced-rendering-mermaid > svg.pele': {
        display: 'block',
        margin: '0 auto',
        maxWidth: '100%',
        height: 'auto',
    },
    '.cm-enhanced-rendering-inline': {
        display: 'inline-block',
        verticalAlign: 'baseline',
        cursor: 'pointer',
    },
    /*
     * Joplin's CM6 theme sets `& div, & span, & a { font-family: inherit }` (specificity 0,1,1)
     * and colors `.cm-inlineMath` / `.cm-mathBlock` green italic (specificity 0,2,0). Prefix with
     * `&.cm-editor` so these baseTheme rules win on specificity over Joplin's EditorView.theme.
     */
    '&.cm-editor .cm-enhanced-rendering-math, &.cm-editor .cm-enhanced-rendering-math-block': {
        color: 'var(--joplin-color, inherit)',
        fontStyle: 'normal',
    },
    '&.cm-editor .cm-enhanced-rendering-math .katex, &.cm-editor .cm-enhanced-rendering-math-block .katex': {
        fontFamily: "KaTeX_Main, 'Times New Roman', serif",
    },
    /*
     * `contain: inline-size` decouples the math widget's intrinsic width from its contents so wide
     * expressions scroll inside the widget instead of expanding `.cm-content` when the editor has
     * no `max-width` cap (e.g. Joplin mobile and unlimited-width desktop).
     */
    '.cm-enhanced-rendering-math-block': {
        width: '100%',
        contain: 'inline-size',
    },
    '.cm-enhanced-rendering-math-block .katex-display': {
        margin: '0',
    },
    // Equal side columns center short equations. A wide equation and its tag can overflow together.
    // The row spans the block's visible width, not the scrolled width of wider earlier lines, so
    // a short final line keeps its tag at the visible right edge before horizontal scrolling.
    '.cm-enhanced-rendering-tagged-line': {
        display: 'grid',
        gridTemplateColumns: '1fr max-content 1fr',
        alignItems: 'baseline',
    },
    '.cm-enhanced-rendering-tagged-line > .cm-enhanced-rendering-tagged-equation': {
        gridColumn: '2',
    },
    '.cm-enhanced-rendering-tagged-line > .katex-tag': {
        gridColumn: '3',
        justifySelf: 'end',
        marginInlineStart: '1em',
    },
    // KaTeX sizes this strut for an absolutely positioned tag using the tallest part of the equation.
    // Grid aligns the tag by its baseline, so the strut would add extra height to shorter final lines.
    '.cm-enhanced-rendering-tagged-line > .katex-tag > .katex-strut': {
        display: 'none',
    },
    '.cm-enhanced-rendering-error': {
        display: 'inline-block',
        maxWidth: '100%',
        padding: '0.25em 0.5em',
        border: '1px solid var(--joplin-destructive-color, #cc0000)',
        borderRadius: '4px',
        color: 'var(--joplin-destructive-color, #cc0000)',
        backgroundColor: 'rgba(204, 0, 0, 0.08)',
        fontFamily: 'monospace',
        fontSize: '0.9em',
        textAlign: 'left',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    },
    '.cm-enhanced-rendering-inline .cm-enhanced-rendering-error': {
        padding: '0 0.3em',
    },
    '&light .cm-enhanced-rendering-mermaid': peleThemeVariables(false),
    '&dark .cm-enhanced-rendering-mermaid': peleThemeVariables(true),
});

export const enhancedRenderingExtension: Extension = [
    pointerRevealFreezeExtension,
    mermaidWidthExtension,
    blockRenderingExtension,
    blockSelectionSnapFilter,
    inlineMathPlugin,
    enhancedRenderingTheme,
];

export default (context: ContentScriptContext): MarkdownEditorContentScriptModule => {
    const openFullscreen = ({ svg, dark }: MermaidFullscreenRequest): void => {
        const message: OpenMermaidFullscreenMessage = { type: 'openMermaidFullscreen', svg, dark };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Joplin's content script channel, not window.postMessage.
        context.postMessage(message).catch((error: unknown) => {
            logger.error('Could not open the full-screen diagram dialog.', error);
        });
    };

    return {
        plugin: (codeMirrorWrapper: CodeMirrorControl) => {
            if (!codeMirrorWrapper.cm6) {
                return;
            }

            codeMirrorWrapper.addExtension([enhancedRenderingExtension, mermaidFullscreenHandler.of(openFullscreen)]);
        },
        assets: () => [{ name: './enhancedRendering.css' }],
    };
};
