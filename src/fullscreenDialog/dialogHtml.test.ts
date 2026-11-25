import { renderFullscreenDialogHtml } from './dialogHtml';

function mount(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
}

describe('renderFullscreenDialogHtml', () => {
    it('places the SVG on a stage themed with Pele variables', () => {
        const root = mount(renderFullscreenDialogHtml('<svg class="pele"></svg>', false, 1));
        const stage = root.querySelector<HTMLElement>('.er-fullscreen__viewport > .er-fullscreen__stage');

        expect(stage?.querySelector('svg.pele')).not.toBeNull();
        expect(stage?.style.getPropertyValue('--pele-bg')).toBe('var(--joplin-background-color, #ffffff)');
    });

    it('uses dark fallbacks for dark themes', () => {
        const stage = mount(renderFullscreenDialogHtml('<svg></svg>', true, 1)).querySelector<HTMLElement>(
            '.er-fullscreen__stage'
        );

        expect(stage?.style.getPropertyValue('--pele-bg')).toBe('var(--joplin-background-color, #1d2024)');
    });

    it('renders zoom controls and a unique root per opening', () => {
        const root = mount(renderFullscreenDialogHtml('<svg></svg>', false, 7));
        const actions = [...root.querySelectorAll<HTMLElement>('[data-action]')].map((el) => el.dataset.action);

        expect(actions).toEqual(['zoom-out', 'zoom-in', 'fit']);
        expect(root.querySelector<HTMLElement>('.er-fullscreen')?.dataset.openId).toBe('7');
        expect(renderFullscreenDialogHtml('<svg></svg>', false, 8)).not.toBe(
            renderFullscreenDialogHtml('<svg></svg>', false, 7)
        );
    });
});
