/**
 * Turns the diagram shown in the full-screen dialog into a self-contained SVG document that looks
 * the same outside Joplin.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface StandaloneSvg {
    markup: string;
    /** Natural diagram size in CSS pixels. */
    width: number;
    height: number;
}

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function positiveNumber(value: string | null): number | null {
    const number = Number(value);
    return value !== null && Number.isFinite(number) && number > 0 ? number : null;
}

function viewBox(svg: SVGSVGElement): Box | null {
    // e.g. `0 0 160 64` or `-8,-8,176,80`
    const [x, y, width, height, ...rest] = (svg.getAttribute('viewBox') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    if (
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined ||
        rest.length > 0 ||
        ![x, y, width, height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
    ) {
        return null;
    }
    return { x, y, width, height };
}

/**
 * Clones a Pele SVG with concrete values for its `--pele-*` color variables and an opaque
 * background, then serializes it as standalone XML.
 *
 * Pele colors every element through `var(--pele-*)` references on the root, so setting the
 * variables on the root recolors the whole diagram without touching its layout. Fonts are left
 * alone: Pele lays text out for its own `sans-serif` fallback, which standalone files keep.
 *
 * @param colors `--pele-*` variable values; `--pele-bg` also fills the background.
 */
export function buildStandaloneSvg(source: SVGSVGElement, colors: Record<string, string>): StandaloneSvg {
    const svg = source.cloneNode(true) as SVGSVGElement;
    const box = viewBox(svg);
    const width = positiveNumber(svg.getAttribute('width')) ?? box?.width ?? 0;
    const height = positiveNumber(svg.getAttribute('height')) ?? box?.height ?? 0;

    const declarations = Object.entries(colors).map(([name, value]) => `${name}:${value}`);
    const style = (svg.getAttribute('style') ?? '').trim().replace(/;$/, '');
    svg.setAttribute('style', [style, ...declarations].filter(Boolean).join(';'));

    const background = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
    const area = box ?? { x: 0, y: 0, width, height };
    background.setAttribute('x', String(area.x));
    background.setAttribute('y', String(area.y));
    background.setAttribute('width', String(area.width));
    background.setAttribute('height', String(area.height));
    background.setAttribute('fill', colors['--pele-bg'] ?? '#ffffff');
    svg.insertBefore(background, svg.firstChild);

    // XML serialization keeps the output well-formed (self-closed elements, XML namespaces), which
    // the HTML `outerHTML` serializer doesn't guarantee.
    return { markup: new XMLSerializer().serializeToString(svg), width, height };
}

/** Encodes SVG markup as a base64 `data:` URL. */
export function svgDataUrl(markup: string): string {
    const bytes = new TextEncoder().encode(markup);
    let binary = '';
    // Chunked so very large diagrams don't exceed the engine's argument count limit.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
}
