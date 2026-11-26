import { fitPngScale } from './rasterize';

describe('fitPngScale', () => {
    it('keeps the requested scale for ordinary diagrams', () => {
        expect(fitPngScale(800, 600, 4)).toBe(4);
    });

    it('lowers the scale to stay within the side limit', () => {
        expect(fitPngScale(8192, 100, 4)).toBe(2);
    });

    it('lowers the scale to stay within the area limit', () => {
        const scale = fitPngScale(4096, 4096, 4);
        expect(scale).toBe(2);
        expect(4096 * scale * 4096 * scale).toBeLessThanOrEqual(8192 * 8192);
    });
});
