import { diagramFileName } from './exportFileName';

describe('diagramFileName', () => {
    it('uses the note title', () => {
        expect(diagramFileName('Release plan')).toBe('Release plan');
    });

    it('replaces characters that are invalid in file names', () => {
        expect(diagramFileName('Q1/Q2: plan?\t"draft"')).toBe('Q1 Q2 plan draft');
    });

    it('drops trailing dots and caps the length', () => {
        expect(diagramFileName('Notes...')).toBe('Notes');
        expect(diagramFileName('a'.repeat(150))).toHaveLength(100);
    });

    it('falls back when the title gives no usable name', () => {
        expect(diagramFileName(undefined)).toBe('mermaid-diagram');
        expect(diagramFileName('  ')).toBe('mermaid-diagram');
        expect(diagramFileName('...')).toBe('mermaid-diagram');
        expect(diagramFileName('???')).toBe('mermaid-diagram');
    });
});
