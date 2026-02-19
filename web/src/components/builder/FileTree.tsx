'use client';

import { useProjectStore } from '@/stores/projectStore';
import { getFileIcon } from '@/lib/zip';
import type { FileTreeNode } from '@/types/project';
import { cn } from '@/lib/utils';
import { useState } from 'react';

function TreeItem({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) {
  const { activeFilePath, openFile } = useProjectStore();
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface transition rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
          <span>📁</span>
          <span className="truncate">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => openFile(node.path)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1 text-xs transition rounded',
        activeFilePath === node.path
          ? 'bg-accent/10 text-accent'
          : 'text-muted hover:text-foreground hover:bg-surface'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="text-[10px]">{getFileIcon(node.name)}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree() {
  const { fileTree } = useProjectStore();

  if (fileTree.length === 0) {
    return (
      <div className="p-4 text-xs text-subtle text-center">No files</div>
    );
  }

  return (
    <div className="py-2 overflow-auto h-full">
      <div className="px-3 py-1 text-[10px] font-semibold text-subtle uppercase tracking-wider mb-1">
        Files
      </div>
      {fileTree.map((node) => (
        <TreeItem key={node.path} node={node} />
      ))}
    </div>
  );
}
