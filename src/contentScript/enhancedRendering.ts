import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import 'katex/dist/katex.min.css';

import type { CodeMirrorControl, MarkdownEditorContentScriptModule } from 'api/types';
import { blockRenderingExtension } from './blockRenderingField';
import { BLOCK_BORDER_WIDTH_PX, BLOCK_HORIZONTAL_PADDING_PX } from './blockStyle';
import { inlineMathPlugin } from './inlineMathPlugin';
import { mermaidWidthExtension } from './mermaidWidth';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';

/**
 * Widget layout, error styling, KaTeX specificity overrides, and Pele CSS custom properties
 * mapped to Joplin's theme variables with CodeMirror light/dark fallbacks.
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
    '.cm-enhanced-rendering-block:hover': {
        borderColor: 'var(--joplin-divider-color, rgba(128, 128, 128, 0.5))',
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
    '.cm-enhanced-rendering-math-block .katex-display': {
        margin: '0',
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
    '&light .cm-enhanced-rendering-mermaid': {
        '--pele-bg': 'var(--joplin-background-color, #ffffff)',
        '--pele-fg': 'var(--joplin-color, #1f1f1f)',
        '--pele-muted': 'var(--joplin-color-faded, #6e6e6e)',
        '--pele-line': 'var(--joplin-color, #1f1f1f)',
        '--pele-surface': 'var(--joplin-background-color3, #f3f3f3)',
        '--pele-surface-alt': 'var(--joplin-background-color-hover3, #e6e6e6)',
        '--pele-border': 'var(--joplin-divider-color, #8a8a8a)',
        '--pele-accent': 'var(--joplin-url-color, #205ea6)',
        '--pele-font': 'inherit',
        '--pele-radius': '4px',
    },
    '&dark .cm-enhanced-rendering-mermaid': {
        '--pele-bg': 'var(--joplin-background-color, #1d2024)',
        '--pele-fg': 'var(--joplin-color, #dddddd)',
        '--pele-muted': 'var(--joplin-color-faded, #9ca3af)',
        '--pele-line': 'var(--joplin-color, #dddddd)',
        '--pele-surface': 'var(--joplin-background-color3, #2b2f36)',
        '--pele-surface-alt': 'var(--joplin-background-color-hover3, #363b44)',
        '--pele-border': 'var(--joplin-divider-color, #555b66)',
        '--pele-accent': 'var(--joplin-url-color, #6ea8fe)',
        '--pele-font': 'inherit',
        '--pele-radius': '4px',
    },
});

export const enhancedRenderingExtension: Extension = [
    pointerRevealFreezeExtension,
    mermaidWidthExtension,
    blockRenderingExtension,
    inlineMathPlugin,
    enhancedRenderingTheme,
];

export default (): MarkdownEditorContentScriptModule => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorControl) => {
            if (!codeMirrorWrapper.cm6) {
                return;
            }

            codeMirrorWrapper.addExtension(enhancedRenderingExtension);
        },
        assets: () => [{ name: './enhancedRendering.css' }],
    };
};
