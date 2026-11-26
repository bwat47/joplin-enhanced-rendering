import { renderFullscreenDialogHtml } from './dialogHtml';

function mount(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
}

describe('renderFullscreenDialogHtml', () => {
    it('places the SVG on a stage themed with Pele variables', () => {
        const root = mount(
            renderFullscreenDialogHtml({ svg: '<svg class="pele"></svg>', dark: false, openId: 1, exportConfig: null })
        );
        const stage = root.querySelector<HTMLElement>('.er-fullscreen__viewport > .er-fullscreen__stage');

        expect(stage?.querySelector('svg.pele')).not.toBeNull();
        expect(stage?.style.getPropertyValue('--pele-bg')).toBe('var(--joplin-background-color, #ffffff)');
    });

    it('uses dark fallbacks for dark themes', () => {
        const stage = mount(
            renderFullscreenDialogHtml({ svg: '<svg></svg>', dark: true, openId: 1, exportConfig: null })
        ).querySelector<HTMLElement>('.er-fullscreen__stage');

        expect(stage?.style.getPropertyValue('--pele-bg')).toBe('var(--joplin-background-color, #1d2024)');
    });

    it('renders zoom controls and a unique root per opening', () => {
        const root = mount(
            renderFullscreenDialogHtml({ svg: '<svg></svg>', dark: false, openId: 7, exportConfig: null })
        );
        const actions = [...root.querySelectorAll<HTMLElement>('[data-action]')].map((el) => el.dataset.action);

        expect(actions).toEqual(['zoom-out', 'zoom-in', 'fit']);
        expect(root.querySelector<HTMLElement>('.er-fullscreen')?.dataset.openId).toBe('7');
        expect(renderFullscreenDialogHtml({ svg: '<svg></svg>', dark: false, openId: 8, exportConfig: null })).not.toBe(
            renderFullscreenDialogHtml({ svg: '<svg></svg>', dark: false, openId: 7, exportConfig: null })
        );
    });

    it('omits the Export menu without an export config', () => {
        const root = mount(
            renderFullscreenDialogHtml({ svg: '<svg></svg>', dark: false, openId: 1, exportConfig: null })
        );

        expect(root.querySelector('[popover]')).toBeNull();
        expect(root.querySelector<HTMLElement>('.er-fullscreen')?.dataset.exportAppearance).toBeUndefined();
    });

    it('renders the Export menu with its options as data attributes', () => {
        const html = renderFullscreenDialogHtml({
            svg: '<svg></svg>',
            dark: false,
            openId: 1,
            exportConfig: { options: { appearance: 'dark', pngScale: 3 }, fileName: 'A "quoted" <title> & more' },
        });
        const root = mount(html).querySelector<HTMLElement>('.er-fullscreen')!;
        const menu = root.querySelector<HTMLElement>('[popover]')!;
        const items = [...menu.querySelectorAll<HTMLElement>('[data-export]')];

        expect(root.dataset).toMatchObject({
            exportAppearance: 'dark',
            exportPngScale: '3',
            exportFileName: 'A "quoted" <title> & more',
        });
        expect(root.querySelector(`[popovertarget="${menu.id}"]:not([data-export])`)?.textContent).toBe('Export');
        expect(items.map((item) => [item.dataset.export, item.textContent])).toEqual([
            ['save-svg', 'Save as SVG…'],
            ['save-png', 'Save as PNG…'],
            ['copy-html-svg', 'Copy as HTML (SVG)'],
            ['copy-html-png', 'Copy as HTML (PNG)'],
        ]);
    });
});
