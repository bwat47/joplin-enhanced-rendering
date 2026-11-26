import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { openFullscreenDialog, registerFullscreenDialog } from './fullscreenDialog/dialog';
import { CONTENT_SCRIPT_ID, isOpenMermaidFullscreenMessage } from './fullscreenMessage';
import { logger } from './logger';
import { registerExportSettings } from './settings';

/**
 * Registers the export settings on desktop, the only platform with the clipboard and file save
 * support diagram export needs. Returns whether export is available.
 */
async function setUpExport(): Promise<boolean> {
    try {
        const { platform } = await joplin.versionInfo();
        if (platform !== 'desktop') {
            return false;
        }
        await registerExportSettings();
        return true;
    } catch (error) {
        logger.error('Could not register the diagram export settings.', error);
        return false;
    }
}

void joplin.plugins.register({
    onStart: async function () {
        await registerFullscreenDialog({ exportEnabled: await setUpExport() });

        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/enhancedRendering.js'
        );

        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: unknown) => {
            if (isOpenMermaidFullscreenMessage(message)) {
                // Not awaited: the content script's postMessage resolves now, not when the dialog closes.
                void openFullscreenDialog(message);
            }
        });
    },
});
