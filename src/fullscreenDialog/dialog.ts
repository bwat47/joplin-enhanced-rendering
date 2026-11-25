/**
 * Joplin-facing half of the full-screen diagram viewer: owns the dialog view and shows diagrams
 * sent by the CodeMirror content script.
 */

import joplin from 'api';
import type { ViewHandle } from 'api/types';
import type { OpenMermaidFullscreenMessage } from '../fullscreenMessage';
import { logger } from '../logger';
import { renderFullscreenDialogHtml } from './dialogHtml';

const DIALOG_ID = 'enhancedRenderingMermaidFullscreen';

let dialogHandle: ViewHandle | null = null;
let openCount = 0;
let isDialogOpen = false;

/** Creates the (initially hidden) dialog view. Called once at plugin start. */
export async function registerFullscreenDialog(): Promise<void> {
    try {
        const handle = await joplin.views.dialogs.create(DIALOG_ID);
        await joplin.views.dialogs.addScript(handle, './fullscreenDialog/styles.css');
        await joplin.views.dialogs.addScript(handle, './fullscreenDialog/panZoom.js');
        // "cancel" is one of Joplin's dismiss button IDs, so Escape closes the dialog.
        await joplin.views.dialogs.setButtons(handle, [{ id: 'cancel', title: 'Close' }]);
        // Fit-to-content would size the dialog to the diagram instead of giving it the most room.
        await joplin.views.dialogs.setFitToContent(handle, false);
        dialogHandle = handle;
    } catch (error) {
        logger.error('Could not create the full-screen diagram dialog.', error);
    }
}

/** Shows a diagram in the full-screen dialog and resolves once the user closes it. */
export async function openFullscreenDialog({ svg, dark }: OpenMermaidFullscreenMessage): Promise<void> {
    if (!dialogHandle) {
        logger.warn('Full-screen diagram dialog is not available.');
        return;
    }

    if (isDialogOpen) {
        return;
    }

    isDialogOpen = true;
    try {
        await joplin.views.dialogs.setHtml(dialogHandle, renderFullscreenDialogHtml(svg, dark, ++openCount));
        await joplin.views.dialogs.open(dialogHandle);
    } catch (error) {
        logger.error('Could not open the full-screen diagram dialog.', error);
    } finally {
        isDialogOpen = false;
    }
}
