import {
    StateEffect,
    StateField,
    type EditorSelection,
    type EditorState,
    type Extension,
    type Transaction,
} from '@codemirror/state';
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view';

const setFrozenSelectionEffect = StateEffect.define<EditorSelection | null>();

/**
 * Returns a StateEffect that clears any active pointer-drag reveal freeze immediately.
 */
export function clearFrozenSelectionEffect(): StateEffect<EditorSelection | null> {
    return setFrozenSelectionEffect.of(null);
}

/**
 * Returns true when `transaction` is explicitly releasing an active pointer-drag reveal freeze.
 */
export function isReleasingFrozenSelection(transaction: Transaction): boolean {
    return (
        transaction.startState.field(frozenSelectionField, false) !== null &&
        transaction.effects.some((effect) => effect.is(setFrozenSelectionEffect) && effect.value === null)
    );
}

function updateFrozenSelection(value: EditorSelection | null, transaction: Transaction): EditorSelection | null {
    for (const effect of transaction.effects) {
        if (effect.is(setFrozenSelectionEffect)) {
            return effect.value;
        }
    }

    if (value === null) {
        return null;
    }

    if (transaction.docChanged) {
        return null;
    }

    if (transaction.selection && !transaction.isUserEvent('select.pointer')) {
        return null;
    }

    return value;
}

const frozenSelectionField = StateField.define<EditorSelection | null>({
    create: (): EditorSelection | null => null,
    update: updateFrozenSelection,
});

/**
 * Returns the selection that renderers should use when deciding whether to reveal raw Markdown:
 * the pre-gesture selection while a left-button mouse drag is active, or the live selection otherwise.
 */
export function getRevealSelection(state: EditorState): EditorSelection {
    return state.field(frozenSelectionField, false) ?? state.selection;
}

/**
 * Returns true if the effective reveal selection changed between `startState` and `nextState`.
 */
export function hasRevealSelectionChanged(startState: EditorState, nextState: EditorState): boolean {
    return !getRevealSelection(startState).eq(getRevealSelection(nextState));
}

class PointerRevealFreezePlugin implements PluginValue {
    private destroyed = false;

    private gestureActive = false;

    private pendingReleaseFrame: number | null = null;

    private readonly doc: Document;

    private readonly win: Window | null;

    public constructor(private readonly view: EditorView) {
        this.doc = view.dom.ownerDocument;
        this.win = this.doc.defaultView;

        view.dom.addEventListener('mousedown', this.onMouseDown, true);
        this.doc.addEventListener('mouseup', this.onMouseUp);
        this.doc.addEventListener('dragend', this.scheduleRelease);
        this.doc.addEventListener('mousemove', this.onMouseMove);
        this.win?.addEventListener('blur', this.scheduleRelease);
    }

    public update(update: ViewUpdate): void {
        if (this.gestureActive && update.state.field(frozenSelectionField, false) === null) {
            this.cancelRelease();
            this.gestureActive = false;
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.cancelRelease();
        this.gestureActive = false;

        this.view.dom.removeEventListener('mousedown', this.onMouseDown, true);
        this.doc.removeEventListener('mouseup', this.onMouseUp);
        this.doc.removeEventListener('dragend', this.scheduleRelease);
        this.doc.removeEventListener('mousemove', this.onMouseMove);
        this.win?.removeEventListener('blur', this.scheduleRelease);
    }

    private cancelRelease(): void {
        if (this.pendingReleaseFrame !== null) {
            this.win?.cancelAnimationFrame(this.pendingReleaseFrame);
            this.pendingReleaseFrame = null;
        }
    }

    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) {
            return;
        }

        this.cancelRelease();
        this.gestureActive = true;

        // Preserve an existing frozen selection during rapid multi-click gestures.
        if (this.view.state.field(frozenSelectionField, false) === null) {
            this.view.dispatch({
                effects: setFrozenSelectionEffect.of(this.view.state.selection),
            });
        }
    };

    private readonly onMouseUp = (event: MouseEvent): void => {
        if (event.button === 0) {
            this.scheduleRelease();
        }
    };

    private readonly onMouseMove = (event: MouseEvent): void => {
        if (this.gestureActive && event.buttons === 0) {
            this.scheduleRelease();
        }
    };

    private readonly scheduleRelease = (): void => {
        if (!this.gestureActive || this.pendingReleaseFrame !== null) {
            return;
        }

        const release = (): void => {
            this.pendingReleaseFrame = null;
            this.gestureActive = false;
            if (this.destroyed || this.view.state.field(frozenSelectionField, false) === null) {
                return;
            }

            this.view.dispatch({
                effects: clearFrozenSelectionEffect(),
            });
        };

        if (this.win) {
            // Wait one frame so CodeMirror finishes committing the pointer selection first.
            this.pendingReleaseFrame = this.win.requestAnimationFrame(release);
        } else {
            release();
        }
    };
}

const pointerRevealFreezePlugin = ViewPlugin.fromClass(PointerRevealFreezePlugin);

/**
 * Freezes widget reveal state during left-button mouse gestures so dragging a selection
 * across rendered Mermaid or math blocks never shifts layout mid-drag.
 */
export const pointerRevealFreezeExtension: Extension = [frozenSelectionField, pointerRevealFreezePlugin];
