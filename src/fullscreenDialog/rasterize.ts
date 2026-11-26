/**
 * Renders a standalone diagram SVG to a PNG canvas in the dialog webview.
 */

import { svgDataUrl, type StandaloneSvg } from './standaloneSvg';

// Chromium refuses larger canvases, and a full-size RGBA buffer at the area limit is ~256 MB.
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 8_192 * 8_192;

/** Lowers `requested` if needed so a `width`×`height` diagram's canvas stays within the limits. */
export function fitPngScale(width: number, height: number, requested: number): number {
    if (width <= 0 || height <= 0) {
        return requested;
    }
    const limit = Math.min(
        MAX_CANVAS_SIDE / width,
        MAX_CANVAS_SIDE / height,
        Math.sqrt(MAX_CANVAS_AREA / (width * height))
    );
    return Math.min(requested, limit);
}

/**
 * Draws the SVG onto a canvas at `scale` times its natural size. The browser rasterizes the vector
 * image at the destination size, so higher scales stay sharp.
 *
 * The image loads from a `data:` URL, which keeps the canvas readable even though Mermaid math
 * labels use `<foreignObject>`.
 */
export async function rasterizeSvg(svg: StandaloneSvg, scale: number): Promise<HTMLCanvasElement> {
    const image = new Image();
    image.src = svgDataUrl(svg.markup);
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(svg.width * scale));
    canvas.height = Math.max(1, Math.round(svg.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Canvas 2D context is not available.');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/** Encodes a canvas as a PNG blob. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode PNG.'))), 'image/png');
    });
}
