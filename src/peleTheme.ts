/**
 * Pele CSS custom properties mapped to Joplin's theme variables, with CodeMirror light/dark
 * fallbacks for hosts that don't define a variable. Shared by the editor theme and the
 * full-screen diagram dialog so both color diagrams the same way.
 */

type PeleThemeVariables = Record<`--pele-${string}`, string>;

const LIGHT_THEME: PeleThemeVariables = {
    '--pele-bg': 'var(--joplin-background-color, #ffffff)',
    '--pele-fg': 'var(--joplin-color, #1f1f1f)',
    '--pele-muted': 'var(--joplin-color-faded, #6e6e6e)',
    '--pele-line': 'var(--joplin-color, #1f1f1f)',
    '--pele-surface': 'var(--joplin-background-color3, #f3f3f3)',
    '--pele-surface-alt': 'var(--joplin-background-color-hover3, #e6e6e6)',
    '--pele-border': 'var(--joplin-divider-color, #8a8a8a)',
    '--pele-accent': 'var(--joplin-url-color, #205ea6)',
    '--pele-font': 'inherit',
    '--pele-radius': '4px',
};

const DARK_THEME: PeleThemeVariables = {
    '--pele-bg': 'var(--joplin-background-color, #1d2024)',
    '--pele-fg': 'var(--joplin-color, #dddddd)',
    '--pele-muted': 'var(--joplin-color-faded, #9ca3af)',
    '--pele-line': 'var(--joplin-color, #dddddd)',
    '--pele-surface': 'var(--joplin-background-color3, #2b2f36)',
    '--pele-surface-alt': 'var(--joplin-background-color-hover3, #363b44)',
    '--pele-border': 'var(--joplin-divider-color, #555b66)',
    '--pele-accent': 'var(--joplin-url-color, #6ea8fe)',
    '--pele-font': 'inherit',
    '--pele-radius': '4px',
};

/** Returns the Pele custom properties for a light or dark editor theme. */
export function peleThemeVariables(dark: boolean): PeleThemeVariables {
    return dark ? DARK_THEME : LIGHT_THEME;
}
