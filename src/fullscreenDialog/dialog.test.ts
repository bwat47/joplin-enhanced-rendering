import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogs = {
    create: vi.fn(),
    addScript: vi.fn(),
    setButtons: vi.fn(),
    setFitToContent: vi.fn(),
    setHtml: vi.fn(),
    open: vi.fn(),
};

const panels = { onMessage: vi.fn() };
const clipboard = { writeHtml: vi.fn() };
const settings = { values: vi.fn() };
const workspace = { selectedNote: vi.fn() };

vi.mock('api', () => ({
    default: {
        views: {
            dialogs,
            panels,
        },
        clipboard,
        settings,
        workspace,
    },
}));

describe('fullscreenDialog', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        dialogs.create.mockResolvedValue('dialog-handle');
        dialogs.addScript.mockResolvedValue(undefined);
        dialogs.setButtons.mockResolvedValue(undefined);
        dialogs.setFitToContent.mockResolvedValue(undefined);
        dialogs.setHtml.mockResolvedValue(undefined);
        dialogs.open.mockResolvedValue({ id: 'cancel' });
        panels.onMessage.mockResolvedValue(undefined);
        clipboard.writeHtml.mockResolvedValue(undefined);
        settings.values.mockResolvedValue({ exportAppearance: 'dark', exportPngScale: 4 });
        workspace.selectedNote.mockResolvedValue({ title: 'Plan: Q3' });
    });

    it('ignores concurrent open requests while the dialog is already opening or open', async () => {
        let resolveOpen!: () => void;
        dialogs.open.mockImplementationOnce(
            () =>
                new Promise<{ id: string }>((resolve) => {
                    resolveOpen = () => resolve({ id: 'cancel' });
                })
        );

        const { openFullscreenDialog, registerFullscreenDialog } = await import('./dialog');
        await registerFullscreenDialog({ exportEnabled: false });

        const first = openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg>1</svg>', dark: false });
        const second = openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg>2</svg>', dark: false });

        await second;
        expect(dialogs.setHtml).toHaveBeenCalledTimes(1);
        expect(dialogs.open).toHaveBeenCalledTimes(1);

        resolveOpen();
        await first;

        // Once closed, subsequent opens are accepted again.
        await openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg>3</svg>', dark: true });
        expect(dialogs.setHtml).toHaveBeenCalledTimes(2);
        expect(dialogs.open).toHaveBeenCalledTimes(2);
    });

    it('leaves out the Export menu when export is disabled', async () => {
        const { openFullscreenDialog, registerFullscreenDialog } = await import('./dialog');
        await registerFullscreenDialog({ exportEnabled: false });
        await openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg></svg>', dark: false });

        expect(dialogs.addScript).not.toHaveBeenCalledWith('dialog-handle', './fullscreenDialog/exportMenu.js');
        expect(panels.onMessage).not.toHaveBeenCalled();
        expect(dialogs.setHtml.mock.calls[0]?.[1]).not.toContain('data-export');
    });

    it('passes the export settings and note title to the Export menu', async () => {
        const { openFullscreenDialog, registerFullscreenDialog } = await import('./dialog');
        await registerFullscreenDialog({ exportEnabled: true });
        await openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg></svg>', dark: false });

        expect(dialogs.addScript).toHaveBeenCalledWith('dialog-handle', './fullscreenDialog/exportMenu.js');
        const html = String(dialogs.setHtml.mock.calls[0]?.[1]);
        expect(html).toContain('data-export-appearance="dark"');
        expect(html).toContain('data-export-png-scale="4"');
        expect(html).toContain('data-export-file-name="Plan Q3"');
    });

    it('still opens the dialog with fallback export config if settings or note lookup fails', async () => {
        settings.values.mockRejectedValueOnce(new Error('settings unavailable'));
        workspace.selectedNote.mockRejectedValueOnce(new Error('no note'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { openFullscreenDialog, registerFullscreenDialog } = await import('./dialog');
        await registerFullscreenDialog({ exportEnabled: true });
        await openFullscreenDialog({ type: 'openMermaidFullscreen', svg: '<svg></svg>', dark: false });

        expect(dialogs.open).toHaveBeenCalledTimes(1);
        const html = String(dialogs.setHtml.mock.calls[0]?.[1]);
        expect(html).toContain('data-export-appearance="light"');
        expect(html).toContain('data-export-png-scale="2"');
        expect(html).toContain('data-export-file-name="mermaid-diagram"');
    });

    it('copies HTML from the Export menu to the clipboard', async () => {
        const { registerFullscreenDialog } = await import('./dialog');
        await registerFullscreenDialog({ exportEnabled: true });
        const onMessage = panels.onMessage.mock.calls[0]?.[1] as (message: unknown) => Promise<unknown>;

        await expect(onMessage({ type: 'copyDiagramHtml', html: '<img src="data:x">' })).resolves.toEqual({ ok: true });
        expect(clipboard.writeHtml).toHaveBeenCalledWith('<img src="data:x">');

        clipboard.writeHtml.mockRejectedValueOnce(new Error('denied'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(onMessage({ type: 'copyDiagramHtml', html: '<img>' })).resolves.toEqual({ ok: false });

        await expect(onMessage({ type: 'unknown' })).resolves.toBeUndefined();
    });
});
