import { vi } from 'vitest';

import type { CodeMirrorControl } from 'api/types';
import createContentScript, { enhancedRenderingExtension } from './enhancedRendering';

describe('enhancedRendering content script', () => {
    it('registers the CM6 extension when cm6 is available', () => {
        const addExtension = vi.fn();
        const control = {
            cm6: {},
            addExtension,
        } as unknown as CodeMirrorControl;

        const module = createContentScript();
        module.plugin(control);

        expect(addExtension).toHaveBeenCalledTimes(1);
        expect(addExtension).toHaveBeenCalledWith(enhancedRenderingExtension);
    });

    it('skips registration when cm6 is not available', () => {
        const addExtension = vi.fn();
        const control = {
            cm6: undefined,
            addExtension,
        } as unknown as CodeMirrorControl;

        const module = createContentScript();
        module.plugin(control);

        expect(addExtension).not.toHaveBeenCalled();
    });

    it('exports the bundled stylesheet asset', () => {
        const module = createContentScript();

        expect(module.assets?.()).toEqual([{ name: './enhancedRendering.css' }]);
    });
});
