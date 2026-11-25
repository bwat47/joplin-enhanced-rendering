/**
 * Pure pan/zoom geometry for the full-screen diagram viewer. A {@link Transform} maps diagram
 * coordinates to viewport coordinates as `viewport = diagram * scale + (x, y)`.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Transform {
    x: number;
    y: number;
    scale: number;
}

export interface ScaleLimits {
    min: number;
    max: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Small diagrams grow to fill the viewport, but no more than this. */
const MAX_FIT_SCALE = 2;
const FIT_PADDING_PX = 16;
/** Wheel pixels per e-fold of zoom; tuned so one mouse-wheel notch (~100px) zooms ~20%. */
const WHEEL_PX_PER_EFOLD = 500;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

const IDENTITY: Transform = { x: 0, y: 0, scale: 1 };

/** Centers `content` in `viewport`, scaled to fit inside a small padding. */
export function fitTransform(content: Size, viewport: Size): Transform {
    if (content.width <= 0 || content.height <= 0) {
        return IDENTITY;
    }

    const availableWidth = Math.max(viewport.width - 2 * FIT_PADDING_PX, 1);
    const availableHeight = Math.max(viewport.height - 2 * FIT_PADDING_PX, 1);
    const scale = Math.min(availableWidth / content.width, availableHeight / content.height, MAX_FIT_SCALE);

    return {
        scale,
        x: (viewport.width - content.width * scale) / 2,
        y: (viewport.height - content.height * scale) / 2,
    };
}

/** Zoom limits that always allow returning to the fitted scale, however large the diagram. */
export function scaleLimits(fitScale: number): ScaleLimits {
    return { min: Math.min(MIN_SCALE, fitScale), max: Math.max(MAX_SCALE, fitScale) };
}

/** Scales by `factor` (clamped to `limits`) while keeping the diagram point under `point` fixed. */
export function zoomAround(transform: Transform, factor: number, point: Point, limits: ScaleLimits): Transform {
    const scale = Math.min(Math.max(transform.scale * factor, limits.min), limits.max);
    if (scale === transform.scale) {
        return transform;
    }

    const ratio = scale / transform.scale;
    return {
        scale,
        x: point.x - (point.x - transform.x) * ratio,
        y: point.y - (point.y - transform.y) * ratio,
    };
}

function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function panBy(transform: Transform, from: Point, to: Point): Transform {
    return { ...transform, x: transform.x + to.x - from.x, y: transform.y + to.y - from.y };
}

/**
 * Applies a pointer move to `transform`. `before` and `after` list the active pointers in the same
 * order, before and after the move. One pointer pans; two pointers pan with their midpoint and
 * pinch-zoom around it. Extra pointers are ignored.
 */
export function applyGesture(
    transform: Transform,
    before: readonly Point[],
    after: readonly Point[],
    limits: ScaleLimits
): Transform {
    const [firstBefore, secondBefore] = before;
    const [firstAfter, secondAfter] = after;
    if (!firstBefore || !firstAfter) {
        return transform;
    }

    if (!secondBefore || !secondAfter) {
        return panBy(transform, firstBefore, firstAfter);
    }

    const midAfter = midpoint(firstAfter, secondAfter);
    const panned = panBy(transform, midpoint(firstBefore, secondBefore), midAfter);
    const distanceBefore = distance(firstBefore, secondBefore);
    const distanceAfter = distance(firstAfter, secondAfter);
    return distanceBefore > 0 && distanceAfter > 0
        ? zoomAround(panned, distanceAfter / distanceBefore, midAfter, limits)
        : panned;
}

/**
 * Converts a wheel event's vertical delta to a zoom factor: scrolling up (negative delta) zooms in.
 * `deltaMode` follows `WheelEvent`: 0 = pixels, 1 = lines, 2 = pages.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
    const unit = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1;
    return Math.exp((-deltaY * unit) / WHEEL_PX_PER_EFOLD);
}
