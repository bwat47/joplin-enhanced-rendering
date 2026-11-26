/**
 * Joplin-facing half of the full-screen diagram viewer: owns the dialog view, shows diagrams sent
 * by the CodeMirror content script, and (on desktop) serves the export menu's clipboard requests.
 */

import joplin from 'api';
import type { ViewHandle } from 'api/types';
import type { OpenMermaidFullscreenMessage } from '../fullscreenMessage';
import { logger } from '../logger';
import { readExportSettings } from '../settings';
import { renderFullscreenDialogHtml, type DialogExportConfig } from './dialogHtml';
import { diagramFileName } from './exportFileName';
import { isCopyDiagramHtmlMessage, type CopyDiagramHtmlResult } from './exportMessage';

const DIALOG_ID = 'enhancedRenderingMermaidFullscreen';

export interface FullscreenDialogOptions {
    /** Adds the Export menu. Only desktop has the clipboard and download support it needs. */
    exportEnabled: boolean;
}

let dialogHandle: ViewHandle | null = null;
let exportEnabled = false;
let openCount = 0;
let isDialogOpen = false;

async function onDialogMessage(message: unknown): Promise<CopyDiagramHtmlResult | undefined> {
    if (!isCopyDiagramHtmlMessage(message)) {
        return undefined;
    }

    try {
        await joplin.clipboard.writeHtml(message.html);
        return { ok: true };
    } catch (error) {
        logger.error('Could not copy the diagram to the clipboard.', error);
        return { ok: false };
    }
}

/** Creates the (initially hidden) dialog view. Called once at plugin start. */
export async function registerFullscreenDialog(options: FullscreenDialogOptions): Promise<void> {
    try {
        const handle = await joplin.views.dialogs.create(DIALOG_ID);
        await joplin.views.dialogs.addScript(handle, './fullscreenDialog/styles.css');
        await joplin.views.dialogs.addScript(handle, './fullscreenDialog/panZoom.js');
        if (options.exportEnabled) {
            await joplin.views.dialogs.addScript(handle, './fullscreenDialog/exportMenu.js');
            await joplin.views.panels.onMessage(handle, onDialogMessage);
        }
        // "cancel" is one of Joplin's dismiss button IDs, so Escape closes the dialog.
        await joplin.views.dialogs.setButtons(handle, [{ id: 'cancel', title: 'Close' }]);
        // Fit-to-content would size the dialog to the diagram instead of giving it the most room.
        await joplin.views.dialogs.setFitToContent(handle, false);
        dialogHandle = handle;
        exportEnabled = options.exportEnabled;
    } catch (error) {
        logger.error('Could not create the full-screen diagram dialog.', error);
    }
}

async function selectedNoteTitle(): Promise<string | undefined> {
    // Typed as unknown: the generated API declares `NoteEntity` in a module the plugin doesn't ship.
    const note: unknown = await joplin.workspace.selectedNote();
    if (typeof note === 'object' && note !== null && 'title' in note && typeof note.title === 'string') {
        return note.title;
    }
    return undefined;
}

async function loadExportConfig(): Promise<DialogExportConfig> {
    const options = await readExportSettings();
    return { options, fileName: diagramFileName(await selectedNoteTitle()) };
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
        // Read on every opening so changed settings and the current note's title apply.
        const exportConfig = exportEnabled ? await loadExportConfig() : null;
        const html = renderFullscreenDialogHtml({ svg, dark, openId: ++openCount, exportConfig });
        await joplin.views.dialogs.setHtml(dialogHandle, html);
        await joplin.views.dialogs.open(dialogHandle);
    } catch (error) {
        logger.error('Could not open the full-screen diagram dialog.', error);
    } finally {
        isDialogOpen = false;
    }
}
