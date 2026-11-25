import { peleThemeVariables } from '../peleTheme';

const HINT = 'Drag to pan · Scroll or pinch to zoom · Double-click to fit';

function toolButton(action: string, label: string, text: string): string {
    return `<button type="button" class="er-fullscreen__tool" data-action="${action}" title="${label}" aria-label="${label}">${text}</button>`;
}

/**
 * Builds the full-screen viewer markup around a Pele SVG.
 *
 * Pele's color variables are set inline on the stage so the dialog colors the diagram the same way
 * the editor does. `openId` makes each opening's markup unique, so Joplin always replaces the DOM
 * and the pan/zoom script starts from a fresh, fitted view.
 *
 * @param svg Trusted Pele output (rendered with external images and links disabled).
 */
export function renderFullscreenDialogHtml(svg: string, dark: boolean, openId: number): string {
    const themeStyle = Object.entries(peleThemeVariables(dark))
        .map(([name, value]) => `${name}: ${value}`)
        .join('; ');

    return `<div class="er-fullscreen" data-open-id="${openId}">
    <div class="er-fullscreen__toolbar">
        <span class="er-fullscreen__hint">${HINT}</span>
        ${toolButton('zoom-out', 'Zoom out', '&minus;')}
        <span class="er-fullscreen__zoom-level">100%</span>
        ${toolButton('zoom-in', 'Zoom in', '+')}
        ${toolButton('fit', 'Fit to window', 'Fit')}
    </div>
    <div class="er-fullscreen__viewport" role="img" aria-label="Mermaid diagram">
        <div class="er-fullscreen__stage" style="${themeStyle}">${svg}</div>
    </div>
</div>`;
}
