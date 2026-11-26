import type { ExportOptions } from '../exportOptions';
import { peleThemeVariables } from '../peleTheme';

const HINT = 'Drag to pan · Scroll or pinch to zoom · Double-click to fit';
const EXPORT_MENU_ID = 'er-fullscreen-export-menu';

/** Export settings for the dialog's Export menu, or omitted where export is unavailable. */
export interface DialogExportConfig {
    options: ExportOptions;
    /** Suggested file name for saved diagrams, without extension. */
    fileName: string;
}

export interface FullscreenDialogContent {
    /** Trusted Pele output (rendered with external images and links disabled). */
    svg: string;
    dark: boolean;
    /** Makes each opening's markup unique; see {@link renderFullscreenDialogHtml}. */
    openId: number;
    exportConfig: DialogExportConfig | null;
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toolButton(action: string, label: string, text: string): string {
    return `<button type="button" class="er-fullscreen__tool" data-action="${action}" title="${label}" aria-label="${label}">${text}</button>`;
}

function exportMenuItem(action: string, text: string): string {
    return `<button type="button" class="er-fullscreen__menu-item" data-export="${action}" popovertarget="${EXPORT_MENU_ID}" popovertargetaction="hide">${text}</button>`;
}

/** Export button plus its popover menu, which handles toggling, outside clicks, and Escape. */
function exportMenu(): string {
    return `<button type="button" class="er-fullscreen__tool er-fullscreen__export" popovertarget="${EXPORT_MENU_ID}" title="Export diagram" aria-label="Export diagram">Export</button>
        <div id="${EXPORT_MENU_ID}" class="er-fullscreen__menu" popover>
            ${exportMenuItem('save-svg', 'Save as SVG…')}
            ${exportMenuItem('save-png', 'Save as PNG…')}
            ${exportMenuItem('copy-html-svg', 'Copy as HTML (SVG)')}
            ${exportMenuItem('copy-html-png', 'Copy as HTML (PNG)')}
        </div>`;
}

function exportAttributes({ options, fileName }: DialogExportConfig): string {
    return ` data-export-appearance="${options.appearance}" data-export-png-scale="${options.pngScale}" data-export-file-name="${escapeAttribute(fileName)}"`;
}

/**
 * Builds the full-screen viewer markup around a Pele SVG.
 *
 * Pele's color variables are set inline on the stage so the dialog colors the diagram the same way
 * the editor does. `openId` makes each opening's markup unique, so Joplin always replaces the DOM
 * and the pan/zoom script starts from a fresh, fitted view. The Export menu and its options are
 * included only when `exportConfig` is set.
 */
export function renderFullscreenDialogHtml({ svg, dark, openId, exportConfig }: FullscreenDialogContent): string {
    const themeStyle = Object.entries(peleThemeVariables(dark))
        .map(([name, value]) => `${name}: ${value}`)
        .join('; ');

    return `<div class="er-fullscreen" data-open-id="${openId}"${exportConfig ? exportAttributes(exportConfig) : ''}>
    <div class="er-fullscreen__toolbar">
        <span class="er-fullscreen__hint">${HINT}</span>
        ${toolButton('zoom-out', 'Zoom out', '&minus;')}
        <span class="er-fullscreen__zoom-level">100%</span>
        ${toolButton('zoom-in', 'Zoom in', '+')}
        ${toolButton('fit', 'Fit to window', 'Fit')}
        ${exportConfig ? exportMenu() : ''}
    </div>
    <div class="er-fullscreen__viewport" role="img" aria-label="Mermaid diagram">
        <div class="er-fullscreen__stage" style="${themeStyle}">${svg}</div>
    </div>
</div>`;
}
