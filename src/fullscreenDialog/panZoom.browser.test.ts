import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { renderFullscreenDialogHtml } from './dialogHtml';
import './styles.css';

const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="0 0 400 200" width="400" height="200" style="max-width:100%;height:auto"><rect width="400" height="200"/></svg>';

function nextFrames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function stageTransform(): DOMMatrix {
    const stage = document.querySelector<HTMLElement>('.er-fullscreen__stage')!;
    return new DOMMatrix(getComputedStyle(stage).transform);
}

function zoomLevel(): string | null | undefined {
    return document.querySelector('.er-fullscreen__zoom-level')?.textContent;
}

describe('full-screen pan/zoom viewer (browser)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('fits the diagram, then zooms with the toolbar, wheel, and pans by dragging', async () => {
        // Simulates Joplin setting the dialog HTML after the script has loaded.
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml(SVG, false, 1);
        await nextFrames();

        const viewport = document.querySelector<HTMLElement>('.er-fullscreen__viewport')!;
        const viewportRect = viewport.getBoundingClientRect();
        const svg = document.querySelector('svg')!;

        // Shown at natural size despite Pele's inline max-width, then fit (capped at 2x) and centered.
        expect(svg.getBoundingClientRect().width / stageTransform().a).toBeCloseTo(400, 0);
        expect(stageTransform().a).toBeCloseTo(2);
        expect(zoomLevel()).toBe('200%');
        const svgRect = svg.getBoundingClientRect();
        expect(svgRect.left - viewportRect.left).toBeCloseTo(viewportRect.right - svgRect.right, 0);

        await userEvent.click(document.querySelector<HTMLElement>('[data-action="zoom-out"]')!);
        expect(stageTransform().a).toBeCloseTo(1.6);

        viewport.dispatchEvent(
            new WheelEvent('wheel', {
                deltaY: -100,
                clientX: viewportRect.left + 50,
                clientY: viewportRect.top + 50,
                bubbles: true,
                cancelable: true,
            })
        );
        expect(stageTransform().a).toBeGreaterThan(1.6);

        const before = stageTransform();
        const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true };
        const x = viewportRect.left + 100;
        const y = viewportRect.top + 100;
        viewport.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: x, clientY: y }));
        viewport.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: x + 30, clientY: y - 20 }));
        viewport.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: x + 30, clientY: y - 20 }));
        expect(stageTransform().e - before.e).toBeCloseTo(30);
        expect(stageTransform().f - before.f).toBeCloseTo(-20);

        await userEvent.dblClick(viewport);
        expect(stageTransform().a).toBeCloseTo(2);
    });

    it('attaches to replacement markup when the dialog is reopened', async () => {
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml(SVG, false, 2);
        await nextFrames();
        await userEvent.click(document.querySelector<HTMLElement>('[data-action="zoom-in"]')!);
        expect(zoomLevel()).toBe('250%');

        document.body.innerHTML = renderFullscreenDialogHtml(SVG, false, 3);
        await nextFrames();
        expect(zoomLevel()).toBe('200%');
        await userEvent.click(document.querySelector<HTMLElement>('[data-action="fit"]')!);
        expect(stageTransform().a).toBeCloseTo(2);
    });
});
