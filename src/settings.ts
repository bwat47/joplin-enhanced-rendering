/**
 * Plugin settings. Only the diagram export options exist so far, and they are registered on
 * desktop only, where export is available.
 */

import joplin from 'api';
import { SettingItemType } from 'api/types';
import {
    DEFAULT_EXPORT_OPTIONS,
    EXPORT_APPEARANCE_LABELS,
    PNG_SCALES,
    parseExportOptions,
    type ExportOptions,
} from './exportOptions';

const SECTION = 'enhancedRendering';
const APPEARANCE_KEY = 'exportAppearance';
const PNG_SCALE_KEY = 'exportPngScale';

/** Registers the settings section and the diagram export settings. */
export async function registerExportSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION, {
        label: 'Enhanced Rendering',
        iconName: 'fas fa-project-diagram',
    });

    await joplin.settings.registerSettings({
        [APPEARANCE_KEY]: {
            section: SECTION,
            public: true,
            type: SettingItemType.String,
            isEnum: true,
            value: DEFAULT_EXPORT_OPTIONS.appearance,
            options: EXPORT_APPEARANCE_LABELS,
            label: 'Diagram export appearance',
            description:
                'Colors used when saving or copying Mermaid diagrams from the full-screen dialog. Light pastes best into most other apps.',
        },
        [PNG_SCALE_KEY]: {
            section: SECTION,
            public: true,
            type: SettingItemType.Int,
            isEnum: true,
            value: DEFAULT_EXPORT_OPTIONS.pngScale,
            options: Object.fromEntries(PNG_SCALES.map((scale) => [scale, `${scale}×`])),
            label: 'Diagram PNG scale',
            description: 'Resolution of exported PNG images, relative to the diagram size.',
        },
    });
}

/** Reads the current export settings, falling back to defaults for invalid values. */
export async function readExportSettings(): Promise<ExportOptions> {
    const values = await joplin.settings.values([APPEARANCE_KEY, PNG_SCALE_KEY]);
    return parseExportOptions(values[APPEARANCE_KEY], values[PNG_SCALE_KEY]);
}
