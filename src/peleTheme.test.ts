import { peleThemeColors, peleThemeVariables } from './peleTheme';

describe('peleTheme', () => {
    it('maps every color to a Joplin variable with the matching fixed fallback', () => {
        for (const dark of [false, true]) {
            const variables = peleThemeVariables(dark);
            for (const [name, color] of Object.entries(peleThemeColors(dark))) {
                expect(variables[name as `--pele-${string}`]).toMatch(
                    new RegExp(`^var\\(--joplin-[a-z0-9-]+, ${color}\\)$`)
                );
            }
        }
    });

    it('uses fixed colors for export, independent of Joplin', () => {
        expect(peleThemeColors(false)['--pele-bg']).toBe('#ffffff');
        expect(peleThemeColors(true)['--pele-bg']).toBe('#1d2024');
    });
});
