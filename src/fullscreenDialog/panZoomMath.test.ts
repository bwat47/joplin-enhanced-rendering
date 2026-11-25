import { applyGesture, fitTransform, scaleLimits, wheelZoomFactor, zoomAround } from './panZoomMath';

const LIMITS = scaleLimits(1);

describe('fitTransform', () => {
    it('shrinks large content to fit inside the padded viewport and centers it', () => {
        const fitted = fitTransform({ width: 2000, height: 500 }, { width: 1032, height: 800 });

        expect(fitted.scale).toBeCloseTo(0.5);
        expect(fitted.x).toBeCloseTo(16);
        expect(fitted.y).toBeCloseTo((800 - 250) / 2);
    });

    it('grows small content, but no more than 2x', () => {
        expect(fitTransform({ width: 100, height: 100 }, { width: 1000, height: 1000 }).scale).toBe(2);
    });

    it('returns the identity transform for empty content', () => {
        expect(fitTransform({ width: 0, height: 0 }, { width: 500, height: 500 })).toEqual({ x: 0, y: 0, scale: 1 });
    });
});

describe('scaleLimits', () => {
    it('extends the limits so the fitted scale is always reachable', () => {
        expect(scaleLimits(0.02)).toEqual({ min: 0.02, max: 8 });
        expect(scaleLimits(1)).toEqual({ min: 0.1, max: 8 });
    });
});

describe('zoomAround', () => {
    it('keeps the diagram point under the zoom origin fixed', () => {
        const start = { x: 10, y: 20, scale: 1 };
        const point = { x: 110, y: 220 };
        const zoomed = zoomAround(start, 2, point, LIMITS);

        // Diagram point (100, 200) stays under the viewport point.
        expect(zoomed.scale).toBe(2);
        expect(100 * zoomed.scale + zoomed.x).toBeCloseTo(point.x);
        expect(200 * zoomed.scale + zoomed.y).toBeCloseTo(point.y);
    });

    it('clamps the scale to the limits', () => {
        expect(zoomAround({ x: 0, y: 0, scale: 4 }, 10, { x: 0, y: 0 }, LIMITS).scale).toBe(8);
        expect(zoomAround({ x: 0, y: 0, scale: 0.2 }, 0.01, { x: 0, y: 0 }, LIMITS).scale).toBe(0.1);
    });

    it('returns the original transform when the clamped scale is unchanged', () => {
        const start = { x: 0.1, y: 0.2, scale: LIMITS.min };
        expect(zoomAround(start, 0.5, { x: 1000, y: 1000 }, LIMITS)).toBe(start);
    });
});

describe('applyGesture', () => {
    const start = { x: 0, y: 0, scale: 1 };

    it('pans with a single pointer', () => {
        expect(applyGesture(start, [{ x: 5, y: 5 }], [{ x: 15, y: -5 }], LIMITS)).toEqual({ x: 10, y: -10, scale: 1 });
    });

    it('pinch-zooms around the midpoint of two pointers', () => {
        const before = [
            { x: 90, y: 100 },
            { x: 110, y: 100 },
        ];
        const after = [
            { x: 80, y: 100 },
            { x: 120, y: 100 },
        ];
        const result = applyGesture(start, before, after, LIMITS);

        expect(result.scale).toBeCloseTo(2);
        expect(100 * result.scale + result.x).toBeCloseTo(100);
    });

    it('pans with the midpoint when two pointers move together', () => {
        const before = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ];
        const after = [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
        ];

        expect(applyGesture(start, before, after, LIMITS)).toEqual({ x: 5, y: 5, scale: 1 });
    });

    it('pans without snapping scale when two pointers coincide after moving', () => {
        const before = [
            { x: 90, y: 100 },
            { x: 110, y: 100 },
        ];
        const after = [
            { x: 105, y: 110 },
            { x: 105, y: 110 },
        ];

        expect(applyGesture(start, before, after, LIMITS)).toEqual({ x: 5, y: 10, scale: 1 });
    });

    it('ignores moves without pointers', () => {
        expect(applyGesture(start, [], [], LIMITS)).toBe(start);
    });
});

describe('wheelZoomFactor', () => {
    it('zooms in on upward scrolls and out on downward scrolls', () => {
        expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
        expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
        expect(wheelZoomFactor(100, 0) * wheelZoomFactor(-100, 0)).toBeCloseTo(1);
    });

    it('scales line and page deltas to pixels', () => {
        expect(wheelZoomFactor(1, 1)).toBeCloseTo(wheelZoomFactor(16, 0));
        expect(wheelZoomFactor(1, 2)).toBeCloseTo(wheelZoomFactor(800, 0));
    });
});
