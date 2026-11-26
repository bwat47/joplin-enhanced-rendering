import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { ExportAppearance } from '../exportOptions';
import { renderFullscreenDialogHtml } from './dialogHtml';
import './styles.css';

// Includes a MathML label in a <foreignObject>, like Mermaid math, to check the PNG canvas stays readable.
const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="0 0 100 50" width="100" height="50" style="max-width:100%;--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#000)">' +
    '<rect x="10" y="10" width="30" height="30" fill="var(--_fg)"/>' +
    '<foreignObject x="50" y="10" width="40" height="30"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></foreignObject>' +
    '</svg>';

const postMessage = vi.fn<(message: unknown) => Promise<unknown>>();
const downloads: { name: string; href: string }[] = [];

function mountDialog(appearance: ExportAppearance, pngScale = 2): void {
    document.body.innerHTML = renderFullscreenDialogHtml({
        svg: SVG,
        dark: false,
        openId: 1,
        exportConfig: { options: { appearance, pngScale }, fileName: 'My note' },
    });
}

async function chooseExport(action: string): Promise<void> {
    await userEvent.click(document.querySelector<HTMLElement>('.er-fullscreen__export')!);
    await userEvent.click(document.querySelector<HTMLElement>(`[data-export="${action}"]`)!);
}

async function nextDownload(): Promise<{ name: string; blob: Blob }> {
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    const { name, href } = downloads[0]!;
    return { name, blob: await (await fetch(href)).blob() };
}

async function copiedHtml(): Promise<HTMLImageElement> {
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    const message = postMessage.mock.calls[0]![0] as { type: string; html: string };
    expect(message.type).toBe('copyDiagramHtml');
    const container = document.createElement('div');
    container.innerHTML = message.html;
    return container.querySelector('img')!;
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
}

function pixel(image: HTMLImageElement, x: number, y: number): number[] {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(x, y, 1, 1).data];
}

describe('full-screen export menu (browser)', () => {
    beforeAll(async () => {
        (window as unknown as { webviewApi: unknown }).webviewApi = { postMessage };
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            downloads.push({ name: this.download, href: this.href });
        });
        await import('./exportMenu');
    });

    afterEach(() => {
        document.body.replaceChildren();
        downloads.length = 0;
        postMessage.mockReset();
    });

    it('opens the menu below the Export button and closes it after a choice', async () => {
        mountDialog('light');
        const button = document.querySelector<HTMLElement>('.er-fullscreen__export')!;
        const menu = document.querySelector<HTMLElement>('.er-fullscreen__menu')!;

        await userEvent.click(button);
        expect(menu.matches(':popover-open')).toBe(true);
        expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(button.getBoundingClientRect().bottom);

        await userEvent.click(menu.querySelector<HTMLElement>('[data-export="save-svg"]')!);
        expect(menu.matches(':popover-open')).toBe(false);
    });

    it('saves a standalone SVG in the chosen appearance', async () => {
        mountDialog('dark');
        await chooseExport('save-svg');

        const { name, blob } = await nextDownload();
        expect(name).toBe('My note.svg');
        expect(blob.type).toBe('image/svg+xml');
        const markup = await blob.text();
        expect(markup).toContain('--pele-bg:#1d2024');
        expect(markup).toContain('fill="#1d2024"');
    });

    it('saves a PNG at the configured scale with an opaque background', async () => {
        mountDialog('dark', 3);
        await chooseExport('save-png');

        const { name, blob } = await nextDownload();
        expect(name).toBe('My note.png');
        const image = await decodeImage(URL.createObjectURL(blob));
        expect([image.naturalWidth, image.naturalHeight]).toEqual([300, 150]);
        expect(pixel(image, 1, 1)).toEqual([0x1d, 0x20, 0x24, 255]);
        // The light rect drawn with --pele-fg.
        expect(pixel(image, 75, 75)).toEqual([0xdd, 0xdd, 0xdd, 255]);
    });

    it('copies the diagram as HTML with a base64 PNG at its natural size', async () => {
        postMessage.mockResolvedValue({ ok: true });
        mountDialog('light');
        await chooseExport('copy-html-png');

        const img = await copiedHtml();
        expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
        expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['100', '50']);
        const image = await decodeImage(img.getAttribute('src')!);
        expect(image.naturalWidth).toBe(200);
        await vi.waitFor(() =>
            expect(document.querySelector('.er-fullscreen__hint')?.textContent).toBe('Copied to clipboard')
        );
    });

    it('copies the diagram as HTML with a base64 SVG and reports copy failures', async () => {
        postMessage.mockResolvedValue({ ok: false });
        mountDialog('light');
        await chooseExport('copy-html-svg');

        const img = await copiedHtml();
        const src = img.getAttribute('src')!;
        expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(atob(src.split(',')[1]!)).toContain('--pele-bg:#ffffff');
        await vi.waitFor(() =>
            expect(document.querySelector('.er-fullscreen__hint')?.textContent).toBe('Could not copy the diagram')
        );
    });

    it('resolves colors from the Joplin theme for the "as shown" appearance', async () => {
        document.documentElement.style.setProperty('--joplin-background-color', 'rgb(1, 2, 3)');
        try {
            mountDialog('current');
            await chooseExport('save-svg');

            const markup = await (await nextDownload()).blob.text();
            expect(markup).toContain('--pele-bg:rgb(1, 2, 3)');
            // Variables Joplin doesn't define resolve to the dialog's light fallbacks.
            expect(markup).toContain('--pele-fg:#1f1f1f');
        } finally {
            document.documentElement.style.removeProperty('--joplin-background-color');
        }
    });
});
