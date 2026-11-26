import { Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface MermaidFullscreenRequest {
    svg: string;
    dark: boolean;
}

export type MermaidFullscreenHandler = (request: MermaidFullscreenRequest) => void;

/**
 * Receives full-screen requests from Mermaid widgets. Diagrams show no full-screen button when
 * no handler is provided (e.g. in tests or hosts without the plugin's dialog).
 */
export const mermaidFullscreenHandler = Facet.define<MermaidFullscreenHandler, MermaidFullscreenHandler | null>({
    combine: (handlers) => handlers[0] ?? null,
});

const BUTTON_LABEL = 'Open diagram full screen';

// Four outward corner brackets ("expand"), drawn with the button's text color.
const EXPAND_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';

const TAP_MOVE_THRESHOLD_PX = 10;

/**
 * Runs `onTap` for a single-finger tap on `element` and cancels the tap's `touchend`.
 *
 * Mobile browsers show the virtual keyboard from the tap gesture itself when it lands inside the
 * focused (or focusable) contenteditable editor, before `mousedown` can prevent focus. Cancelling
 * `touchend` suppresses the synthesized mouse events, the click, and the keyboard, so the editor's
 * scroll position doesn't shift as the keyboard opens and closes again behind the dialog. Touches
 * that move past a small threshold are left alone so scrolling over the element still works.
 */
function attachTapHandler(element: HTMLElement, onTap: () => void): void {
    let start: { id: number; x: number; y: number } | null = null;

    element.addEventListener(
        'touchstart',
        (event) => {
            const touch = event.touches.length === 1 ? event.changedTouches[0] : undefined;
            start = touch ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
        },
        { passive: true }
    );
    element.addEventListener('touchcancel', () => {
        start = null;
    });
    element.addEventListener('touchend', (event) => {
        const tapStart = start;
        start = null;
        const touch = Array.from(event.changedTouches).find((t) => t.identifier === tapStart?.id);
        if (!tapStart || !touch || !event.cancelable) {
            return;
        }

        const moved = Math.max(Math.abs(touch.clientX - tapStart.x), Math.abs(touch.clientY - tapStart.y));
        if (moved > TAP_MOVE_THRESHOLD_PX) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onTap();
    });
}

/**
 * Creates the full-screen button for a rendered Mermaid diagram, or returns `null` when the editor
 * has no {@link mermaidFullscreenHandler}.
 *
 * The button swallows its own pointer events so pressing it never triggers the widget's
 * click-to-edit behavior, and taps on touch devices don't open the virtual keyboard. `renderSvg` is
 * called on activation, so the unconstrained full-screen render only happens when the user asks for
 * it.
 */
export function createFullscreenButton(view: EditorView, renderSvg: () => string | null): HTMLButtonElement | null {
    const handler = view.state.facet(mermaidFullscreenHandler);
    if (!handler) {
        return null;
    }

    const button = view.dom.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'cm-enhanced-rendering-fullscreen-button';
    button.title = BUTTON_LABEL;
    button.setAttribute('aria-label', BUTTON_LABEL);
    button.innerHTML = EXPAND_ICON;

    const open = (): void => {
        const svg = renderSvg();
        if (svg !== null) {
            handler({ svg, dark: view.state.facet(EditorView.darkTheme) });
        }
    };

    button.addEventListener('mousedown', (event) => {
        // Keep focus in the editor and stop the widget's click-to-edit handler from arming.
        event.preventDefault();
        event.stopPropagation();
    });
    attachTapHandler(button, open);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
    });

    return button;
}
