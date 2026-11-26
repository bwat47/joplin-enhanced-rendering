const FALLBACK_FILE_NAME = 'mermaid-diagram';
const MAX_FILE_NAME_LENGTH = 100;

// Characters that Windows, macOS, or Linux reject in file names, e.g. `/` and `?` in `A/B?`,
// plus ASCII control characters.
// oxlint-disable-next-line no-control-regex -- control characters are exactly what this strips.
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Suggests a base file name (without extension) for an exported diagram from its note's title.
 * Falls back to `mermaid-diagram` when the title is empty or only contains invalid characters.
 */
export function diagramFileName(noteTitle: string | undefined): string {
    const name = (noteTitle ?? '')
        .replace(INVALID_FILE_NAME_CHARACTERS, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_FILE_NAME_LENGTH)
        .trim()
        // Windows drops trailing dots, and a name made only of dots is not a real file name.
        .replace(/\.+$/, '')
        .trim();
    return name || FALLBACK_FILE_NAME;
}
