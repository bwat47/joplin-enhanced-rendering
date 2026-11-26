import { buildStandaloneSvg, svgDataUrl } from './standaloneSvg';

function parseSvg(markup: string): SVGSVGElement {
    const container = document.createElement('div');
    container.innerHTML = markup;
    return container.querySelector('svg')!;
}

const SOURCE =
    '<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="-8 -4 160 64" width="160" height="64" style="max-width:100%;--_bg:var(--pele-bg,#fff);"><text>A &amp; B</text></svg>';

describe('buildStandaloneSvg', () => {
    it('sets the color variables on the root and keeps the natural size', () => {
        const result = buildStandaloneSvg(parseSvg(SOURCE), { '--pele-bg': '#1d2024', '--pele-fg': '#dddddd' });
        const svg = new DOMParser().parseFromString(result.markup, 'image/svg+xml').documentElement;

        expect(result).toMatchObject({ width: 160, height: 64 });
        expect(svg.getAttribute('style')).toBe(
            'max-width:100%;--_bg:var(--pele-bg,#fff);--pele-bg:#1d2024;--pele-fg:#dddddd'
        );
    });

    it('adds a background covering the view box', () => {
        const result = buildStandaloneSvg(parseSvg(SOURCE), { '--pele-bg': '#ffffff' });
        const svg = new DOMParser().parseFromString(result.markup, 'image/svg+xml').documentElement;
        const background = svg.firstElementChild!;

        expect(background.localName).toBe('rect');
        expect(['x', 'y', 'width', 'height', 'fill'].map((name) => background.getAttribute(name))).toEqual([
            '-8',
            '-4',
            '160',
            '64',
            '#ffffff',
        ]);
    });

    it('serializes well-formed XML without changing the shown diagram', () => {
        const source = parseSvg(SOURCE);
        const result = buildStandaloneSvg(source, { '--pele-bg': '#ffffff' });

        const parsed = new DOMParser().parseFromString(result.markup, 'image/svg+xml');
        expect(parsed.querySelector('parsererror')).toBeNull();
        expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(source.querySelector('rect')).toBeNull();
    });

    it('falls back to the view box size without width and height', () => {
        const result = buildStandaloneSvg(parseSvg('<svg viewBox="0 0 30 20"></svg>'), {});
        expect(result).toMatchObject({ width: 30, height: 20 });
    });
});

describe('svgDataUrl', () => {
    it('base64-encodes UTF-8 markup', () => {
        const url = svgDataUrl('<svg>é</svg>');
        expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
        const bytes = Uint8Array.from(atob(url.split(',')[1]!), (char) => char.charCodeAt(0));
        expect(new TextDecoder().decode(bytes)).toBe('<svg>é</svg>');
    });
});
