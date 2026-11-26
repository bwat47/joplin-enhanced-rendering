import { DEFAULT_EXPORT_OPTIONS, parseExportOptions } from './exportOptions';

describe('parseExportOptions', () => {
    it('accepts valid appearances and scales, including scales stored as strings', () => {
        expect(parseExportOptions('dark', 3)).toEqual({ appearance: 'dark', pngScale: 3 });
        expect(parseExportOptions('current', '4')).toEqual({ appearance: 'current', pngScale: 4 });
    });

    it('falls back to the defaults for missing or invalid values', () => {
        expect(parseExportOptions(undefined, undefined)).toEqual(DEFAULT_EXPORT_OPTIONS);
        expect(parseExportOptions('toString', 2.5)).toEqual(DEFAULT_EXPORT_OPTIONS);
        expect(parseExportOptions('sepia', 0)).toEqual(DEFAULT_EXPORT_OPTIONS);
    });
});
