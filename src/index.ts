import joplin from 'api';
import { ContentScriptType } from 'api/types';

void joplin.plugins.register({
    onStart: async function () {
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            'enhancedRendering',
            './contentScript/enhancedRendering.js'
        );
    },
});
