/**
 * Pele CSS custom properties mapped to Joplin's theme variables, with CodeMirror light/dark
 * fallbacks for hosts that don't define a variable. Shared by the editor theme, the full-screen
 * diagram dialog, and diagram export so all of them color diagrams the same way.
 */

type PeleVariableName = `--pele-${string}`;
type PeleThemeVariables = Record<PeleVariableName, string>;

interface PeleColor {
    /** Joplin theme variable the color follows inside Joplin. */
    joplin: `--joplin-${string}`;
    light: string;
    dark: string;
}

const PELE_COLORS: Record<PeleVariableName, PeleColor> = {
    '--pele-bg': { joplin: '--joplin-background-color', light: '#ffffff', dark: '#1d2024' },
    '--pele-fg': { joplin: '--joplin-color', light: '#1f1f1f', dark: '#dddddd' },
    '--pele-muted': { joplin: '--joplin-color-faded', light: '#6e6e6e', dark: '#9ca3af' },
    '--pele-line': { joplin: '--joplin-color', light: '#1f1f1f', dark: '#dddddd' },
    '--pele-surface': { joplin: '--joplin-background-color3', light: '#f3f3f3', dark: '#2b2f36' },
    '--pele-surface-alt': { joplin: '--joplin-background-color-hover3', light: '#e6e6e6', dark: '#363b44' },
    '--pele-border': { joplin: '--joplin-divider-color', light: '#8a8a8a', dark: '#555b66' },
    '--pele-accent': { joplin: '--joplin-url-color', light: '#205ea6', dark: '#6ea8fe' },
};

/** Returns the Pele custom properties for a light or dark editor theme. */
export function peleThemeVariables(dark: boolean): PeleThemeVariables {
    const variables: PeleThemeVariables = {};
    for (const [name, color] of Object.entries(PELE_COLORS) as [PeleVariableName, PeleColor][]) {
        variables[name] = `var(${color.joplin}, ${dark ? color.dark : color.light})`;
    }
    variables['--pele-font'] = 'inherit';
    variables['--pele-radius'] = '4px';
    return variables;
}

/**
 * Returns the fixed light or dark Pele colors, independent of the Joplin theme. Used for diagram
 * export, where the result must look the same outside Joplin.
 */
export function peleThemeColors(dark: boolean): PeleThemeVariables {
    const colors: PeleThemeVariables = {};
    for (const [name, color] of Object.entries(PELE_COLORS) as [PeleVariableName, PeleColor][]) {
        colors[name] = dark ? color.dark : color.light;
    }
    return colors;
}
