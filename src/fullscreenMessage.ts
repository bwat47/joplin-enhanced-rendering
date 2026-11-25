/**
 * Message contract between the CodeMirror content script and the plugin's main process for
 * opening a Mermaid diagram in the full-screen dialog.
 */

/** ID the CodeMirror content script is registered under; also the `onMessage` channel. */
export const CONTENT_SCRIPT_ID = 'enhancedRendering';

export interface OpenMermaidFullscreenMessage {
    type: 'openMermaidFullscreen';
    /** Pele SVG markup rendered without a width constraint. */
    svg: string;
    /** Whether the editor uses a dark theme, selecting the Pele color fallbacks. */
    dark: boolean;
}

/** Narrows an untyped content script message to an {@link OpenMermaidFullscreenMessage}. */
export function isOpenMermaidFullscreenMessage(message: unknown): message is OpenMermaidFullscreenMessage {
    if (typeof message !== 'object' || message === null) {
        return false;
    }

    const candidate = message as Partial<OpenMermaidFullscreenMessage>;
    return (
        candidate.type === 'openMermaidFullscreen' &&
        typeof candidate.svg === 'string' &&
        typeof candidate.dark === 'boolean'
    );
}
