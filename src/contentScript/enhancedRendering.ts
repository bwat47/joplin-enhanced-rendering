import type { Extension } from '@codemirror/state';
import 'katex/dist/katex.min.css';

import type { CodeMirrorControl, MarkdownEditorContentScriptModule } from 'api/types';
import './styles.css';

export const enhancedRenderingExtension: Extension = [];

export default (): MarkdownEditorContentScriptModule => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorControl) => {
            if (!codeMirrorWrapper.cm6) {
                return;
            }

            codeMirrorWrapper.addExtension(enhancedRenderingExtension);
        },
        assets: () => [{ name: './enhancedRendering.css' }],
    };
};
