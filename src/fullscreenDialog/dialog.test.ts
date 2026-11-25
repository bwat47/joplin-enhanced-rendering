import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogs = {
    create: vi.fn(),
    addScript: vi.fn(),
    setButtons: vi.fn(),
    setFitToContent: vi.fn(),
    setHtml: vi.fn(),
    open: vi.fn(),
};

vi.mock('api', () => ({
    default: {
        views: {
            dialogs,
        },
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
        await registerFullscreenDialog();

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
});
