import JSZip from 'jszip';
import type { ExtractedFile, FileTreeNode } from '@/types/project';

const TEXT_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.json',
  '.svg', '.md', '.txt', '.xml', '.yaml', '.yml', '.toml',
  '.env', '.gitignore', '.map',
]);

function isTextFile(path: string): boolean {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Normalize paths from GitHub zipball (strips single top-level directory).
 * Works with JSZip's files object (plain object, not Map).
 */
function normalizePaths(
  files: Record<string, JSZip.JSZipObject>
): Array<[string, JSZip.JSZipObject]> {
  const entries = Object.entries(files).filter(([, f]) => !f.dir);
  if (entries.length === 0) return entries;

  // Check if all files share a common top-level directory
  const firstSlash = entries[0][0].indexOf('/');
  if (firstSlash === -1) return entries;

  const prefix = entries[0][0].substring(0, firstSlash + 1);
  const allSharePrefix = entries.every(([path]) => path.startsWith(prefix));

  if (!allSharePrefix) return entries;

  // Check if the prefix directory contains index.html
  const hasIndex = entries.some(([path]) => {
    const relative = path.substring(prefix.length);
    return relative === 'index.html';
  });

  if (!hasIndex) return entries;

  // Strip the prefix
  const normalized: Array<[string, JSZip.JSZipObject]> = [];
  for (const [path, entry] of entries) {
    const relative = path.substring(prefix.length);
    if (relative) {
      normalized.push([relative, entry]);
    }
  }
  return normalized;
}

export async function extractBundle(base64: string): Promise<ExtractedFile[]> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const zip = await JSZip.loadAsync(bytes);
  const entries = normalizePaths(zip.files);
  const files: ExtractedFile[] = [];

  for (const [path, entry] of entries) {
    if (entry.dir) continue;
    const isText = isTextFile(path);
    const content = await entry.async(isText ? 'string' : 'base64');
    files.push({
      path,
      content,
      size: content.length,
      isText,
    });
  }

  return files;
}

export function buildFileTree(files: ExtractedFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.push({
          name: part,
          path: file.path,
          isDirectory: false,
          size: file.size,
        });
      } else {
        let dir = current.find((n) => n.name === part && n.isDirectory);
        if (!dir) {
          dir = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            isDirectory: true,
            children: [],
          };
          current.push(dir);
        }
        current = dir.children!;
      }
    }
  }

  // Sort: directories first, then alphabetical
  const sortTree = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortTree(node.children);
    }
  };

  sortTree(root);
  return root;
}

export function createPreviewUrl(files: ExtractedFile[]): string | null {
  const indexFile = files.find(
    (f) => f.path === 'index.html' || f.path.endsWith('/index.html')
  );
  if (!indexFile) return null;

  let html = indexFile.content;

  // For multi-file bundles, inline CSS and JS referenced by relative paths
  for (const file of files) {
    if (file.path === indexFile.path) continue;

    if (file.path.endsWith('.css') && file.isText) {
      // Replace <link href="css/style.css"> with inline <style>
      const cssPath = file.path.replace(/^\.\//, '');
      const linkRegex = new RegExp(
        `<link[^>]*href=["'](?:\\.\\/)?\\.?${escapeRegex(cssPath)}["'][^>]*>`,
        'gi'
      );
      if (linkRegex.test(html)) {
        html = html.replace(linkRegex, `<style>${file.content}</style>`);
      }
    }

    if (file.path.endsWith('.js') && file.isText) {
      // Replace <script src="js/app.js"> with inline <script>
      const jsPath = file.path.replace(/^\.\//, '');
      const scriptRegex = new RegExp(
        `<script[^>]*src=["'](?:\\.\\/)?\\.?${escapeRegex(jsPath)}["'][^>]*>\\s*</script>`,
        'gi'
      );
      if (scriptRegex.test(html)) {
        html = html.replace(scriptRegex, `<script>${file.content}</script>`);
      }
    }
  }

  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': return '🌐';
    case 'css': return '🎨';
    case 'js': case 'jsx': case 'ts': case 'tsx': return '⚡';
    case 'json': return '📋';
    case 'svg': return '🖼️';
    case 'md': return '📝';
    default: return '📄';
  }
}
