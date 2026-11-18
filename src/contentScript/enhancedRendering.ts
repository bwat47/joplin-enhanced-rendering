import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import 'katex/dist/katex.min.css';

import type { CodeMirrorControl, MarkdownEditorContentScriptModule } from 'api/types';
import { blockRenderingExtension } from './blockRenderingField';
import { inlineMathPlugin } from './inlineMathPlugin';
import './styles.css';

/**
 * Maps Pele's CSS custom properties to Joplin's theme variables with CodeMirror light/dark
 * fallbacks so Mermaid SVGs adapt to theme changes without re-rendering.
 */
const enhancedRenderingTheme = EditorView.baseTheme({
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
