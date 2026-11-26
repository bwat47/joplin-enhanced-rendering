/**
 * Diagram export options, shared by the plugin settings (main process) and the full-screen
 * dialog's export menu (webview), which receives them through the dialog markup.
 */

/** `current` follows the Joplin theme the diagram is shown in. */
export type ExportAppearance = 'light' | 'dark' | 'current';

export interface ExportOptions {
    appearance: ExportAppearance;
    /** PNG pixels per diagram pixel. */
    pngScale: number;
}

export const EXPORT_APPEARANCE_LABELS: Record<ExportAppearance, string> = {
    light: 'Light',
    dark: 'Dark',
    current: 'As shown in Joplin',
};

export const PNG_SCALES = [1, 2, 3, 4] as const;

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { appearance: 'light', pngScale: 2 };

function isExportAppearance(value: unknown): value is ExportAppearance {
    return typeof value === 'string' && Object.keys(EXPORT_APPEARANCE_LABELS).includes(value);
}

/**
 * Validates raw option values (from settings storage or data attributes), falling back to the
 * defaults for anything missing or out of range.
 */
export function parseExportOptions(appearance: unknown, pngScale: unknown): ExportOptions {
    const scale = Number(pngScale);
    return {
        appearance: isExportAppearance(appearance) ? appearance : DEFAULT_EXPORT_OPTIONS.appearance,
        pngScale: (PNG_SCALES as readonly number[]).includes(scale) ? scale : DEFAULT_EXPORT_OPTIONS.pngScale,
    };
}
