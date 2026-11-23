import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type * as Katex from 'katex';
import { renderToString } from 'katex';
import { vi } from 'vitest';

import { blockRenderingExtension } from './blockRenderingField';
import * as mathRenderer from './mathRenderer';
import * as mermaidRenderer from './mermaidRenderer';
import {
    getMermaidMaxWidth,
    mermaidWidthExtension,
    quantizeMermaidWidth,
    resetLastKnownMermaidWidth,
} from './mermaidWidth';
import { pointerRevealFreezeExtension } from './pointerRevealFreeze';
import { createJoplinMarkdownExtension } from './testing/joplinMarkdownMath';

// Count real KaTeX work: `MathWidget` calls `renderMath` from inside its own module, where a
// namespace spy cannot observe it.
vi.mock('katex', async (importOriginal) => {
    const katex = await importOriginal<typeof Katex>();
    return { ...katex, renderToString: vi.fn(katex.renderToString) };
});

class MockResizeObserver {
    public static instances: MockResizeObserver[] = [];

    public readonly observed = new Set<Element>();

    public disconnected = false;

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observed.add(target);
    }

    public unobserve(target: Element): void {
        this.observed.delete(target);
    }

    public disconnect(): void {
        this.disconnected = true;
        this.observed.clear();
    }

    public trigger(): void {
        if (!this.disconnected) {
            const entries = Array.from(this.observed, (target) => ({
                target,
                contentRect: { width: target.clientWidth },
            })) as unknown as ResizeObserverEntry[];
            this.callback(entries, this);
        }
    }
}

function setElementClientWidth(element: HTMLElement, width: number): void {
    Object.defineProperty(element, 'clientWidth', {
        configurable: true,
        get: () => width,
    });
}

function createView(doc: string, initialWidth: number): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);

    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            selection: { anchor: 0 },
            extensions: [
                createJoplinMarkdownExtension(),
                pointerRevealFreezeExtension,
                mermaidWidthExtension,
                blockRenderingExtension,
            ],
        }),
    });
    setElementClientWidth(view.contentDOM, initialWidth);
    return view;
}

describe('quantizeMermaidWidth', () => {
    it('returns null for non-positive or non-finite widths', () => {
        expect(quantizeMermaidWidth(0)).toBeNull();
        expect(quantizeMermaidWidth(-100)).toBeNull();
        expect(quantizeMermaidWidth(Number.NaN)).toBeNull();
        expect(quantizeMermaidWidth(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('quantizes available content widths down to 64px buckets with a 256px floor', () => {
        expect(quantizeMermaidWidth(100)).toBe(256);
        expect(quantizeMermaidWidth(300)).toBe(256);
        expect(quantizeMermaidWidth(360)).toBe(320);
        expect(quantizeMermaidWidth(400)).toBe(320);
        expect(quantizeMermaidWidth(700)).toBe(640);
        expect(quantizeMermaidWidth(721)).toBe(640);
        expect(quantizeMermaidWidth(722)).toBe(704);
    });

    it('requires headroom before growing into a larger bucket but shrinks immediately', () => {
        // Inner width = content width - 18px of block chrome.
        expect(quantizeMermaidWidth(722, 640)).toBe(640); // 704 inner: 0px above 704
        expect(quantizeMermaidWidth(745, 640)).toBe(640); // 727 inner: 23px above 704
        expect(quantizeMermaidWidth(746, 640)).toBe(704); // 728 inner: 24px above 704
        expect(quantizeMermaidWidth(745, 320)).toBe(640); // Multi-step growth stops one step short.
        expect(quantizeMermaidWidth(721, 704)).toBe(640); // Shrinking ignores hysteresis.
        expect(quantizeMermaidWidth(722, 704)).toBe(704);
        expect(quantizeMermaidWidth(745, null)).toBe(704); // No active bucket: plain quantization.
    });
});

describe('mermaidWidthExtension', () => {
    let views: EditorView[] = [];
    let rafCallbacks: FrameRequestCallback[] = [];
    let nextFrameId = 1;

    const track = (view: EditorView): EditorView => {
        views.push(view);
        return view;
    };

    const flushMeasureCycle = async (): Promise<void> => {
        while (rafCallbacks.length > 0) {
            const callback = rafCallbacks.shift()!;
            callback(0);
        }
        await Promise.resolve();
    };

    beforeEach(() => {
        vi.useFakeTimers();
        resetLastKnownMermaidWidth();
        mermaidRenderer.clearMermaidRenderCache();
        mathRenderer.clearMathRenderCache();
        MockResizeObserver.instances = [];
        rafCallbacks = [];
        nextFrameId = 1;

        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            rafCallbacks.push(callback);
            return nextFrameId++;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        for (const view of views) {
            view.destroy();
            view.dom.parentElement?.remove();
        }
        views = [];
        resetLastKnownMermaidWidth();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('applies the initial measured width immediately and seeds subsequent editors without re-rendering', async () => {
        const doc =
            'Intro\n\n```mermaid\nflowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Finish]\n```\n\n$$\nx^2 + y^2\n$$';
        const widgetSpy = vi.spyOn(mermaidRenderer, 'MermaidWidget');
        const mathSpy = vi.mocked(renderToString);
        mathSpy.mockClear();

        const firstView = track(createView(doc, 380));
        expect(getMermaidMaxWidth(firstView.state)).toBeNull();
        expect(widgetSpy).toHaveBeenCalledTimes(1);
        expect(mathSpy).toHaveBeenCalledTimes(1);

        await flushMeasureCycle();

        expect(getMermaidMaxWidth(firstView.state)).toBe(320);
        expect(widgetSpy).toHaveBeenCalledTimes(2);
        expect(widgetSpy).toHaveBeenLastCalledWith(
            'flowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Finish]',
            expect.any(Number),
            320
        );
        // Math blocks must not re-render when Mermaid width changes.
        expect(mathSpy).toHaveBeenCalledTimes(1);

        // Opening a second editor at the same pane width starts directly in the seeded 320px bucket.
        widgetSpy.mockClear();
        const secondView = track(createView(doc, 380));
        expect(getMermaidMaxWidth(secondView.state)).toBe(320);
        expect(widgetSpy).toHaveBeenCalledTimes(1);
        expect(widgetSpy).toHaveBeenCalledWith(
            'flowchart LR\n  A[Start Process] --> B[Validate Input] --> C[Transform Data] --> D[Finish]',
            expect.any(Number),
            320
        );

        await flushMeasureCycle();
        expect(widgetSpy).toHaveBeenCalledTimes(1);
    });

    it('debounces resize updates across buckets and cancels pending updates if width returns to the active bucket', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four]\n```';
        const view = track(createView(doc, 700));
        await flushMeasureCycle();
        expect(getMermaidMaxWidth(view.state)).toBe(640);

        const contentObserver = MockResizeObserver.instances.find((observer) => observer.observed.has(view.contentDOM));
        expect(contentObserver).toBeDefined();

        const widgetSpy = vi.spyOn(mermaidRenderer, 'MermaidWidget');

        // Drag through 500px (448) -> 380px (320) within the debounce window.
        setElementClientWidth(view.contentDOM, 500);
        contentObserver!.trigger();
        await flushMeasureCycle();
        vi.advanceTimersByTime(100);
        expect(getMermaidMaxWidth(view.state)).toBe(640);
        expect(widgetSpy).not.toHaveBeenCalled();

        setElementClientWidth(view.contentDOM, 380);
        contentObserver!.trigger();
        await flushMeasureCycle();
        vi.advanceTimersByTime(100);
        expect(getMermaidMaxWidth(view.state)).toBe(640);
        expect(widgetSpy).not.toHaveBeenCalled();

        // After debounce settles, only the final bucket (320) is applied once.
        vi.advanceTimersByTime(60);
        expect(getMermaidMaxWidth(view.state)).toBe(320);
        expect(widgetSpy).toHaveBeenCalledTimes(1);
        expect(widgetSpy).toHaveBeenCalledWith(
            'flowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four]',
            expect.any(Number),
            320
        );

        // Start resizing back to 700px, then return to 380px before debounce fires -> zero renders.
        widgetSpy.mockClear();
        setElementClientWidth(view.contentDOM, 700);
        contentObserver!.trigger();
        await flushMeasureCycle();
        vi.advanceTimersByTime(80);

        setElementClientWidth(view.contentDOM, 380);
        contentObserver!.trigger();
        await flushMeasureCycle();
        vi.advanceTimersByTime(200);

        expect(getMermaidMaxWidth(view.state)).toBe(320);
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('does not flip buckets when a re-render toggles the vertical scrollbar', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four]\n```';
        const view = track(createView(doc, 721));
        await flushMeasureCycle();
        expect(getMermaidMaxWidth(view.state)).toBe(640);

        const contentObserver = MockResizeObserver.instances.find((observer) => observer.observed.has(view.contentDOM));
        const widgetSpy = vi.spyOn(mermaidRenderer, 'MermaidWidget');

        // The vertical scrollbar disappears, widening the pane by 17px (703 -> 720 inner): not enough to grow.
        setElementClientWidth(view.contentDOM, 738);
        contentObserver!.trigger();
        await flushMeasureCycle();
        vi.advanceTimersByTime(200);

        expect(getMermaidMaxWidth(view.state)).toBe(640);
        expect(widgetSpy).not.toHaveBeenCalled();
    });

    it('uses the narrower scroll viewport width and still subtracts contentDOM horizontal padding on overflow', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four]\n```';
        const view = track(createView(doc, 870));
        setElementClientWidth(view.scrollDOM, 420);
        view.contentDOM.style.paddingLeft = '32px';
        view.contentDOM.style.paddingRight = '32px';
        await flushMeasureCycle();

        // 420 viewport - 64 content padding = 356 available -> 320px bucket (without padding subtraction it would be 384).
        expect(getMermaidMaxWidth(view.state)).toBe(320);
    });

    it('ignores height-only ResizeObserver callbacks without re-measuring', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createView(doc, 700));
        await flushMeasureCycle();

        const contentObserver = MockResizeObserver.instances.find((observer) => observer.observed.has(view.contentDOM));
        expect(contentObserver).toBeDefined();

        // First trigger establishes the baseline observed widths.
        contentObserver!.trigger();
        await flushMeasureCycle();

        const requestMeasureSpy = vi.spyOn(view, 'requestMeasure');

        // Repeated triggers with unchanged widths (e.g. height changes while typing) skip measurement.
        contentObserver!.trigger();
        contentObserver!.trigger();
        expect(requestMeasureSpy).not.toHaveBeenCalled();

        // Changing width schedules a measurement again.
        setElementClientWidth(view.contentDOM, 400);
        contentObserver!.trigger();
        expect(requestMeasureSpy).toHaveBeenCalledTimes(1);
    });

    it('disconnects its ResizeObserver and cancels pending timers when destroyed', async () => {
        const doc = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```';
        const view = track(createView(doc, 700));
        await flushMeasureCycle();

        const contentObserver = MockResizeObserver.instances.find((observer) => observer.observed.has(view.contentDOM));
        expect(contentObserver).toBeDefined();

        setElementClientWidth(view.contentDOM, 380);
        contentObserver!.trigger();
        await flushMeasureCycle();

        view.destroy();
        expect(contentObserver!.disconnected).toBe(true);

        // Advancing timers after destroy should not throw or dispatch.
        expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    });
});
