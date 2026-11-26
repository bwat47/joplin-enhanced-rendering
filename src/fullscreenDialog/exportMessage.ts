/**
 * Message contract between the full-screen dialog's export menu (webview) and the plugin's main
 * process, which owns the clipboard.
 */

export interface CopyDiagramHtmlMessage {
    type: 'copyDiagramHtml';
    /** An `<img>` element whose `src` is a base64 SVG or PNG `data:` URL. */
    html: string;
}

/** What the main process answers to a {@link CopyDiagramHtmlMessage}. */
export interface CopyDiagramHtmlResult {
    ok: boolean;
}

/** Narrows an untyped webview message to a {@link CopyDiagramHtmlMessage}. */
export function isCopyDiagramHtmlMessage(message: unknown): message is CopyDiagramHtmlMessage {
    if (typeof message !== 'object' || message === null) {
        return false;
    }

    const candidate = message as Partial<CopyDiagramHtmlMessage>;
    return candidate.type === 'copyDiagramHtml' && typeof candidate.html === 'string';
}
