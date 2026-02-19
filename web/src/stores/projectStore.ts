import { create } from 'zustand';
import type { ProjectDetail, ProjectVersion } from '@/types/api';
import type { ExtractedFile, FileTreeNode, ChatMessage } from '@/types/project';

interface ProjectState {
  project: ProjectDetail | null;
  extractedFiles: ExtractedFile[];
  fileTree: FileTreeNode[];
  activeFilePath: string | null;
  openFiles: string[];
  bundle: string | null;
  previewUrl: string | null;
  isDirty: boolean;
  chatMessages: ChatMessage[];
  versions: ProjectVersion[];
  activeVersionSha: string | null;
  isReverting: boolean;
  isLoadingProject: boolean;

  setProject: (project: ProjectDetail) => void;
  setExtractedFiles: (files: ExtractedFile[], tree: FileTreeNode[]) => void;
  setActiveFile: (path: string | null) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setBundle: (bundle: string) => void;
  setPreviewUrl: (url: string | null) => void;
  setDirty: (dirty: boolean) => void;
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  setVersions: (versions: ProjectVersion[]) => void;
  setActiveVersion: (sha: string | null) => void;
  setReverting: (reverting: boolean) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  project: null as ProjectDetail | null,
  extractedFiles: [] as ExtractedFile[],
  fileTree: [] as FileTreeNode[],
  activeFilePath: null as string | null,
  openFiles: [] as string[],
  bundle: null as string | null,
  previewUrl: null as string | null,
  isDirty: false,
  chatMessages: [] as ChatMessage[],
  versions: [] as ProjectVersion[],
  activeVersionSha: null as string | null,
  isReverting: false,
  isLoadingProject: false,
};

export const useProjectStore = create<ProjectState>((set) => ({
  ...initialState,

  setProject: (project) => set({ project }),

  setExtractedFiles: (files, tree) =>
    set({
      extractedFiles: files,
      fileTree: tree,
      activeFilePath: files.find((f) => f.path === 'index.html')?.path ?? files[0]?.path ?? null,
      openFiles: files.find((f) => f.path === 'index.html')
        ? ['index.html']
        : files.length > 0
          ? [files[0].path]
          : [],
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  openFile: (path) =>
    set((state) => ({
      activeFilePath: path,
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
    })),

  closeFile: (path) =>
    set((state) => {
      const newOpen = state.openFiles.filter((f) => f !== path);
      return {
        openFiles: newOpen,
        activeFilePath:
          state.activeFilePath === path
            ? newOpen[newOpen.length - 1] ?? null
            : state.activeFilePath,
      };
    }),

  setBundle: (bundle) => set({ bundle }),
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setDirty: (dirty) => set({ isDirty: dirty }),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),

  setChatMessages: (messages) => set({ chatMessages: messages }),
  setVersions: (versions) => set({ versions }),
  setActiveVersion: (sha) => set({ activeVersionSha: sha }),
  setReverting: (reverting) => set({ isReverting: reverting }),
  setLoading: (loading) => set({ isLoadingProject: loading }),
  reset: () => set(initialState),
}));
