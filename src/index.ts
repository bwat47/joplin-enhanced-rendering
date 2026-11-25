import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { openFullscreenDialog, registerFullscreenDialog } from './fullscreenDialog/dialog';
import { CONTENT_SCRIPT_ID, isOpenMermaidFullscreenMessage } from './fullscreenMessage';

void joplin.plugins.register({
    onStart: async function () {
        await registerFullscreenDialog();

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
