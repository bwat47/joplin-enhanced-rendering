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
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 1, exportConfig: null });
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
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 2, exportConfig: null });
        await nextFrames();
        await userEvent.click(document.querySelector<HTMLElement>('[data-action="zoom-in"]')!);
        expect(zoomLevel()).toBe('250%');

        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 3, exportConfig: null });
        await nextFrames();
        expect(zoomLevel()).toBe('200%');
        await userEvent.click(document.querySelector<HTMLElement>('[data-action="fit"]')!);
        expect(stageTransform().a).toBeCloseTo(2);
    });

    it('disposes the viewer when its root is removed from the DOM', async () => {
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 4, exportConfig: null });
        await nextFrames();

        const activeKeydown = new KeyboardEvent('keydown', { key: '+', cancelable: true });
        document.dispatchEvent(activeKeydown);
        expect(activeKeydown.defaultPrevented).toBe(true);

        document.body.replaceChildren();
        await nextFrames();

        const disposedKeydown = new KeyboardEvent('keydown', { key: '+', cancelable: true });
        document.dispatchEvent(disposedKeydown);
        expect(disposedKeydown.defaultPrevented).toBe(false);
    });

    it('keeps auto-fit active after horizontal-only wheel events', async () => {
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 5, exportConfig: null });
        await nextFrames();

        const root = document.querySelector<HTMLElement>('.er-fullscreen')!;
        const viewport = document.querySelector<HTMLElement>('.er-fullscreen__viewport')!;
        const initialScale = stageTransform().a;

        viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, deltaY: 0, bubbles: true, cancelable: true }));
        root.style.width = '232px';
        await nextFrames();

        expect(stageTransform().a).toBeLessThan(initialScale);
        expect(stageTransform().a).toBeCloseTo(0.5, 1);
    });

    it('keeps auto-fit active after zero-delta pointermove events', async () => {
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 7, exportConfig: null });
        await nextFrames();

        const root = document.querySelector<HTMLElement>('.er-fullscreen')!;
        const viewport = document.querySelector<HTMLElement>('.er-fullscreen__viewport')!;
        const viewportRect = viewport.getBoundingClientRect();
        const initialScale = stageTransform().a;
        const point = {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: viewportRect.left + 100,
            clientY: viewportRect.top + 100,
        };

        viewport.dispatchEvent(new PointerEvent('pointerdown', point));
        viewport.dispatchEvent(new PointerEvent('pointermove', point));
        viewport.dispatchEvent(new PointerEvent('pointerup', point));

        root.style.width = '232px';
        await nextFrames();

        expect(stageTransform().a).toBeLessThan(initialScale);
        expect(stageTransform().a).toBeCloseTo(0.5, 1);
    });

    it('keeps auto-fit active after clamped no-op zoom events', async () => {
        await import('./panZoom');
        const wideSvg =
            '<svg xmlns="http://www.w3.org/2000/svg" class="pele" viewBox="0 0 20000 200" width="20000" height="200" style="max-width:100%;height:auto"><rect width="20000" height="200"/></svg>';
        document.body.innerHTML = renderFullscreenDialogHtml({
            svg: wideSvg,
            dark: false,
            openId: 8,
            exportConfig: null,
        });
        await nextFrames();

        const root = document.querySelector<HTMLElement>('.er-fullscreen')!;
        const initialScale = stageTransform().a;
        expect(initialScale).toBeLessThan(0.1);

        await userEvent.click(document.querySelector<HTMLElement>('[data-action="zoom-out"]')!);
        expect(stageTransform().a).toBeCloseTo(initialScale, 5);

        root.style.width = '232px';
        await nextFrames();

        expect(stageTransform().a).toBeLessThan(initialScale);
        expect(stageTransform().a).toBeCloseTo(0.01, 3);
    });

    it('clears pointer state when pointer capture is lost', async () => {
        await import('./panZoom');
        document.body.innerHTML = renderFullscreenDialogHtml({ svg: SVG, dark: false, openId: 6, exportConfig: null });
        await nextFrames();

        const viewport = document.querySelector<HTMLElement>('.er-fullscreen__viewport')!;
        const viewportRect = viewport.getBoundingClientRect();
        const x = viewportRect.left + 100;
        const y = viewportRect.top + 100;

        viewport.dispatchEvent(
            new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
        );
        expect(viewport.classList.contains('er-fullscreen__viewport--panning')).toBe(true);

        viewport.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
        expect(viewport.classList.contains('er-fullscreen__viewport--panning')).toBe(false);

        const before = stageTransform();
        const nextPointer = { pointerId: 2, pointerType: 'mouse', button: 0 };
        viewport.dispatchEvent(new PointerEvent('pointerdown', { ...nextPointer, clientX: x + 20, clientY: y }));
        viewport.dispatchEvent(new PointerEvent('pointermove', { ...nextPointer, clientX: x + 50, clientY: y }));
        viewport.dispatchEvent(new PointerEvent('pointerup', { ...nextPointer, clientX: x + 50, clientY: y }));

        expect(stageTransform().a).toBeCloseTo(before.a);
        expect(stageTransform().e - before.e).toBeCloseTo(30);
    });
});
