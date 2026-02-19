'use client';

import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { cn } from '@/lib/utils';

function getLanguageExtension(filepath: string) {
  const ext = filepath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': return html();
    case 'css': return css();
    case 'js': case 'jsx': case 'ts': case 'tsx':
      return javascript({ jsx: true, typescript: ext === 'ts' || ext === 'tsx' });
    default: return [];
  }
}

export function CodeEditor() {
  const { extractedFiles, activeFilePath, openFiles, setActiveFile, closeFile } =
    useProjectStore();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const activeFile = extractedFiles.find((f) => f.path === activeFilePath);

  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: activeFile.content,
      extensions: [
        basicSetup,
        oneDark,
        EditorState.readOnly.of(true),
        getLanguageExtension(activeFile.path),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { fontFamily: 'var(--font-geist-mono), monospace' },
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [activeFile]);

  if (!activeFile) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        Select a file to view
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center border-b border-border bg-card overflow-x-auto">
        {openFiles.map((path) => (
          <div
            key={path}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border cursor-pointer shrink-0',
              path === activeFilePath
                ? 'bg-background text-foreground'
                : 'text-muted hover:text-foreground'
            )}
          >
            <button onClick={() => setActiveFile(path)} className="truncate max-w-[120px]">
              {path.split('/').pop()}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(path); }}
              className="text-subtle hover:text-foreground ml-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
