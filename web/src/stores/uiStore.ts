import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  versionHistoryOpen: boolean;
  previewDevice: 'desktop' | 'tablet' | 'mobile';

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleVersionHistory: () => void;
  setPreviewDevice: (device: 'desktop' | 'tablet' | 'mobile') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  versionHistoryOpen: false,
  previewDevice: 'desktop',

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleVersionHistory: () => set((s) => ({ versionHistoryOpen: !s.versionHistoryOpen })),
  setPreviewDevice: (device) => set({ previewDevice: device }),
}));
