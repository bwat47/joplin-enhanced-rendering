/**
 * Webview script for the full-screen dialog's Export menu (desktop only): saves the diagram as SVG
 * or PNG, or copies it to the clipboard as HTML.
 *
 * Saving uses an `<a download>` link, which makes Joplin desktop show its Save As dialog. Copying
 * needs `joplin.clipboard`, so the webview builds the HTML and posts it to the main process.
 *
 * Clicks are delegated from the document, so the menu keeps working when Joplin replaces the
 * dialog HTML for the next diagram. Export options arrive as data attributes on the viewer root.
 */

import { parseExportOptions, type ExportAppearance } from '../exportOptions';
import { logger } from '../logger';
import { peleThemeColors } from '../peleTheme';
import type { CopyDiagramHtmlMessage, CopyDiagramHtmlResult } from './exportMessage';
import { canvasToPngBlob, fitPngScale, rasterizeSvg } from './rasterize';
import { buildStandaloneSvg, svgDataUrl, type StandaloneSvg } from './standaloneSvg';

declare const webviewApi: { postMessage: (message: unknown) => Promise<unknown> };

type ExportAction = 'save-svg' | 'save-png' | 'copy-html-svg' | 'copy-html-png';

const EXPORT_ACTIONS: readonly string[] = ['save-svg', 'save-png', 'copy-html-svg', 'copy-html-png'];
const STATUS_DURATION_MS = 3000;
// Long enough for the download to start; revoking earlier could cancel it.
const OBJECT_URL_LIFETIME_MS = 60_000;

interface ExportTarget {
    root: HTMLElement;
    standalone: StandaloneSvg;
    fileName: string;
    pngScale: number;
}

/**
 * Pele color values for an export. `current` reads the variables the dialog resolved from Joplin's
 * theme on the stage, falling back to the light palette for any it couldn't resolve.
 */
function exportColors(appearance: ExportAppearance, stage: HTMLElement): Record<string, string> {
    if (appearance !== 'current') {
        return peleThemeColors(appearance === 'dark');
    }

    const computed = getComputedStyle(stage);
    const colors: Record<string, string> = peleThemeColors(false);
    for (const name of Object.keys(colors)) {
        const value = computed.getPropertyValue(name).trim();
        if (value) {
            colors[name] = value;
        }
    }
    return colors;
}

function exportTarget(root: HTMLElement): ExportTarget | null {
    const stage = root.querySelector<HTMLElement>('.er-fullscreen__stage');
    const svg = stage?.querySelector<SVGSVGElement>(':scope > svg');
    if (!stage || !svg) {
        return null;
    }

    const options = parseExportOptions(root.dataset.exportAppearance, root.dataset.exportPngScale);
    return {
        root,
        standalone: buildStandaloneSvg(svg, exportColors(options.appearance, stage)),
        fileName: root.dataset.exportFileName || 'mermaid-diagram',
        pngScale: options.pngScale,
    };
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message in place of the toolbar hint. */
function showStatus(root: HTMLElement, message: string): void {
    const hint = root.querySelector<HTMLElement>('.er-fullscreen__hint');
    if (!hint) {
        return;
    }

    hint.dataset.hint ??= hint.textContent;
    hint.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        hint.textContent = hint.dataset.hint ?? '';
    }, STATUS_DURATION_MS);
}

function download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

function imageHtml(src: string, { width, height }: StandaloneSvg): string {
    return `<img src="${src}" width="${Math.round(width)}" height="${Math.round(height)}" alt="Mermaid diagram">`;
}

interface RenderedPng {
    canvas: HTMLCanvasElement;
    /** Set when the requested PNG scale was lowered to stay within canvas size limits. */
    reducedScale: number | null;
}

function formatScale(scale: number): string {
    return `${Math.floor(scale * 10) / 10}×`;
}

async function renderPng(target: ExportTarget): Promise<RenderedPng> {
    const { width, height } = target.standalone;
    const scale = fitPngScale(width, height, target.pngScale);
    const canvas = await rasterizeSvg(target.standalone, scale);
    return { canvas, reducedScale: scale < target.pngScale ? scale : null };
}

async function copyHtml(target: ExportTarget, html: string, reducedScale: number | null = null): Promise<void> {
    const message: CopyDiagramHtmlMessage = { type: 'copyDiagramHtml', html };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Joplin's webview API, not window.postMessage.
    const result = (await webviewApi.postMessage(message)) as CopyDiagramHtmlResult | undefined;
    if (!result?.ok) {
        showStatus(target.root, 'Could not copy the diagram');
        return;
    }
    const status =
        reducedScale !== null
            ? `Copied to clipboard (PNG scale reduced to ${formatScale(reducedScale)})`
            : 'Copied to clipboard';
    showStatus(target.root, status);
}

async function runExport(target: ExportTarget, action: ExportAction): Promise<void> {
    const { standalone, fileName } = target;
    switch (action) {
        case 'save-svg':
            download(new Blob([standalone.markup], { type: 'image/svg+xml' }), `${fileName}.svg`);
            break;
        case 'save-png': {
            const { canvas, reducedScale } = await renderPng(target);
            download(await canvasToPngBlob(canvas), `${fileName}.png`);
            if (reducedScale !== null) {
                showStatus(target.root, `PNG scale reduced to ${formatScale(reducedScale)} to stay within size limits`);
            }
            break;
        }
        case 'copy-html-svg':
            await copyHtml(target, imageHtml(svgDataUrl(standalone.markup), standalone));
            break;
        case 'copy-html-png': {
            const { canvas, reducedScale } = await renderPng(target);
            await copyHtml(target, imageHtml(canvas.toDataURL('image/png'), standalone), reducedScale);
            break;
        }
    }
}

document.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-export]') : null;
    const action = item?.dataset.export;
    const root = item?.closest<HTMLElement>('.er-fullscreen');
    if (!action || !EXPORT_ACTIONS.includes(action) || !root) {
        return;
    }

    const exportDiagram = async (): Promise<void> => {
        const target = exportTarget(root);
        if (target) {
            await runExport(target, action as ExportAction);
        }
    };

    exportDiagram().catch((error: unknown) => {
        logger.error('Could not export the diagram.', error);
        showStatus(root, 'Could not export the diagram');
    });
});
