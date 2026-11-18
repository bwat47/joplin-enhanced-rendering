import { EditorSelection } from '@codemirror/state';

import { dedentLines, LruCache, rangeIntersectsSelection } from './renderUtils';

describe('LruCache', () => {
    it('stores and retrieves values and evicts the least recently used entry', () => {
        const cache = new LruCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);

        // Refresh 'a' so 'b' becomes least recently used.
        expect(cache.get('a')).toBe(1);

        cache.set('c', 3);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);

        cache.clear();
        expect(cache.get('a')).toBeUndefined();
    });

    it('updates existing keys without exceeding capacity', () => {
        const cache = new LruCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10);

        expect(cache.get('a')).toBe(10);
        expect(cache.get('b')).toBe(2);
    });
});

describe('rangeIntersectsSelection', () => {
    it('detects inclusive boundary and interior cursor overlap', () => {
        expect(rangeIntersectsSelection(EditorSelection.single(10), 10, 20)).toBe(true);
        expect(rangeIntersectsSelection(EditorSelection.single(20), 10, 20)).toBe(true);
        expect(rangeIntersectsSelection(EditorSelection.single(15), 10, 20)).toBe(true);
        expect(rangeIntersectsSelection(EditorSelection.single(9), 10, 20)).toBe(false);
        expect(rangeIntersectsSelection(EditorSelection.single(21), 10, 20)).toBe(false);
    });

    it('detects overlap across multi-range selections', () => {
        const selection = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(18, 25)]);
        expect(rangeIntersectsSelection(selection, 10, 20)).toBe(true);
    });
});

describe('dedentLines', () => {
    it('strips a matching leading prefix from each line', () => {
        expect(dedentLines('  A --> B\n  B --> C\nC --> D', '  ')).toBe('A --> B\nB --> C\nC --> D');
        expect(dedentLines('A --> B', '')).toBe('A --> B');
    });
});
