import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import {
    GFM,
    type BlockContext,
    type InlineContext,
    type LeafBlock,
    type Line,
    type MarkdownConfig,
    type MarkdownExtension,
} from '@lezer/markdown';

const DOLLAR_CODE = 36;
const BACKSLASH_CODE = 92;

// Matches Joplin's BlockMath start/end regexes in packages/editor/CodeMirror/extensions/markdownMathExtension.ts:
// - `$$`, `  $$`, `> $$` start a block math region
// - `$$` followed by optional trailing whitespace closes a block math region
const MATH_BLOCK_START_PATTERN = /^(?:\s*>\s*)?\$\$/;
const MATH_BLOCK_END_PATTERN = /\$\$\s*$/;

const inlineMathConfig: MarkdownConfig = {
    defineNodes: [{ name: 'InlineMath' }],
    parseInline: [
        {
            name: 'InlineMath',
            after: 'InlineCode',
            parse(cx: InlineContext, current: number, pos: number): number {
                const prevCode = pos - 1 >= 0 ? cx.char(pos - 1) : -1;
                const nextCode = cx.char(pos + 1);
                if (current !== DOLLAR_CODE || prevCode === DOLLAR_CODE || nextCode === DOLLAR_CODE) {
                    return -1;
                }
                if (/\s/.test(String.fromCharCode(nextCode))) {
                    return -1;
                }

                const start = pos;
                let escaped = false;
                pos++;

                for (; pos < cx.end && (escaped || cx.char(pos) !== DOLLAR_CODE); pos++) {
                    escaped = !escaped && cx.char(pos) === BACKSLASH_CODE;
                }

                if (pos === cx.end || /\s/.test(String.fromCharCode(cx.char(pos - 1)))) {
                    return -1;
                }

                pos++;
                cx.addElement(cx.elt('InlineMath', start, pos));
                return pos;
            },
        },
    ],
};

const blockMathConfig: MarkdownConfig = {
    defineNodes: [{ name: 'BlockMath' }],
    parseBlock: [
        {
            name: 'BlockMath',
            before: 'Blockquote',
            parse(cx: BlockContext, line: Line): boolean {
                const startMatch = MATH_BLOCK_START_PATTERN.exec(line.text);
                if (!startMatch) {
                    return false;
                }

                const delimLen = 2;
                const start = cx.lineStart + startMatch[0].length;
                let stop: number;

                let endMatch = MATH_BLOCK_END_PATTERN.exec(line.text.slice(startMatch[0].length));
                if (endMatch) {
                    stop = cx.lineStart + line.text.length - endMatch[0].length;
                } else {
                    let hadNextLine = false;
                    do {
                        hadNextLine = cx.nextLine();
                        endMatch = hadNextLine ? MATH_BLOCK_END_PATTERN.exec(line.text) : null;
                    } while (hadNextLine && endMatch === null);

                    stop =
                        hadNextLine && endMatch ? cx.lineStart + line.text.length - endMatch[0].length : cx.lineStart;
                }

                const lineEnd = cx.lineStart + line.text.length;
                cx.addElement(cx.elt('BlockMath', start - delimLen, Math.min(lineEnd, stop + delimLen)));
                cx.nextLine();
                return true;
            },
            endLeaf(_cx: BlockContext, line: Line, _leaf: LeafBlock): boolean {
                return MATH_BLOCK_START_PATTERN.test(line.text);
            },
        },
    ],
};

/**
 * Test-only Lezer Markdown extension reproducing Joplin's `InlineMath` and `BlockMath` syntax nodes.
 */
export const joplinMathMarkdownExtension: MarkdownExtension = [inlineMathConfig, blockMathConfig];

/**
 * Creates a CodeMirror Markdown language extension matching Joplin's GFM + Math syntax tree.
 */
export function createJoplinMarkdownExtension(includeMath = true): Extension {
    return markdown({
        base: markdownLanguage,
        extensions: includeMath ? [GFM, joplinMathMarkdownExtension] : [GFM],
    });
}
