/**
 * Webview script for the full-screen diagram dialog: drag to pan, wheel or pinch to zoom,
 * double-click to fit, plus toolbar and keyboard zoom controls.
 *
 * Joplin loads this script once per dialog webview and may set or replace the dialog HTML before or
 * after it runs, so a MutationObserver attaches a fresh controller to each new viewer root.
 */

import {
    applyGesture,
    fitTransform,
    scaleLimits,
    wheelZoomFactor,
    zoomAround,
    type Point,
    type ScaleLimits,
    type Transform,
} from './panZoomMath';

const ROOT_SELECTOR = '.er-fullscreen';
const ZOOM_STEP = 1.25;

interface Viewer {
    root: HTMLElement;
    dispose: () => void;
}

/** Wires pan/zoom handling to one viewer root. Returns `null` if the markup is incomplete. */
function attachViewer(root: HTMLElement): Viewer | null {
    const viewport = root.querySelector<HTMLElement>('.er-fullscreen__viewport');
    const stage = root.querySelector<HTMLElement>('.er-fullscreen__stage');
    const zoomLevel = root.querySelector<HTMLElement>('.er-fullscreen__zoom-level');
    if (!viewport || !stage || !zoomLevel) {
        return null;
    }

    let transform: Transform = { x: 0, y: 0, scale: 1 };
    let limits: ScaleLimits = scaleLimits(1);
    // While true, the diagram re-fits when the viewport resizes; any pan or zoom clears it.
    let followsFit = true;
    const pointers = new Map<number, Point>();

    const apply = (next: Transform): void => {
        transform = next;
        stage.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
        zoomLevel.textContent = `${Math.round(next.scale * 100)}%`;
    };

    const adjust = (next: Transform): void => {
        if (next.x === transform.x && next.y === transform.y && next.scale === transform.scale) {
            return;
        }
        followsFit = false;
        apply(next);
    };

    const fit = (): void => {
        const viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
        if (viewportSize.width === 0 || viewportSize.height === 0) {
            return;
        }

        const fitted = fitTransform({ width: stage.offsetWidth, height: stage.offsetHeight }, viewportSize);
        limits = scaleLimits(fitted.scale);
        followsFit = true;
        apply(fitted);
    };

    const viewportPoint = (event: MouseEvent): Point => {
        const rect = viewport.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const viewportCenter = (): Point => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });

    const zoomBy = (factor: number, point: Point = viewportCenter()): void => {
        adjust(zoomAround(transform, factor, point, limits));
    };

    const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }

        try {
            viewport.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic or already-ended pointers cannot be captured.
        }
        pointers.set(event.pointerId, viewportPoint(event));
        viewport.classList.add('er-fullscreen__viewport--panning');
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (!pointers.has(event.pointerId)) {
            return;
        }

        const before = [...pointers.values()];
        pointers.set(event.pointerId, viewportPoint(event));
        adjust(applyGesture(transform, before, [...pointers.values()], limits));
    };

    const onPointerEnd = (event: PointerEvent): void => {
        pointers.delete(event.pointerId);
        if (pointers.size === 0) {
            viewport.classList.remove('er-fullscreen__viewport--panning');
        }
    };

    const onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        if (event.deltaY === 0) {
            return;
        }
        zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), viewportPoint(event));
    };

    const runAction = (action: string | undefined): void => {
        if (action === 'zoom-in') {
            zoomBy(ZOOM_STEP);
        } else if (action === 'zoom-out') {
            zoomBy(1 / ZOOM_STEP);
        } else if (action === 'fit') {
            fit();
        }
    };

    const onToolbarClick = (event: MouseEvent): void => {
        const target = event.target instanceof Element ? event.target : null;
        runAction(target?.closest<HTMLElement>('[data-action]')?.dataset.action);
    };

    const KEY_ACTIONS: Record<string, string> = { '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'fit' };
    const onKeyDown = (event: KeyboardEvent): void => {
        const action = KEY_ACTIONS[event.key];
        if (action && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            runAction(action);
        }
    };

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerEnd);
    viewport.addEventListener('pointercancel', onPointerEnd);
    viewport.addEventListener('lostpointercapture', onPointerEnd);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('dblclick', fit);
    root.addEventListener('click', onToolbarClick);
    document.addEventListener('keydown', onKeyDown);

    // Fires once after layout, then on every dialog resize.
    const resizeObserver = new ResizeObserver(() => {
        if (followsFit) {
            fit();
        }
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(stage);

    return {
        root,
        dispose: () => {
            resizeObserver.disconnect();
            document.removeEventListener('keydown', onKeyDown);
        },
    };
}

let activeViewer: Viewer | null = null;

function attachToCurrentRoot(): void {
    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    if (root === (activeViewer?.root ?? null)) {
        return;
    }

    activeViewer?.dispose();
    activeViewer = root ? attachViewer(root) : null;
}

new MutationObserver(attachToCurrentRoot).observe(document.documentElement, { childList: true, subtree: true });
attachToCurrentRoot();
