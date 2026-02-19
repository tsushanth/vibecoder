export interface ExtractedFile {
  path: string;
  content: string;
  size: number;
  isText: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  versionSha?: string;
  versionNumber?: number;
}
