import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import FeatureGate from '../components/FeatureGate';
import { authFetchInit, fetchAuthJsonCached, peekAuthJson } from '../lib/authApi';
import { SkelTable } from '../components/data/DataBusy';

const DOCUMENTS_TREE_URL = '/api/documents/tree';

interface DocFolder {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: string;
  children?: DocFolder[];
}

interface DocFile {
  id: string;
  folderId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  source: string | null;
  createdAt: string;
}

function fmtSize(bytes: number) {
  if (!bytes || bytes < 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fileKind(name: string, mime: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || mime.includes('sheet')) return 'Excel Worksheet';
  if (lower.endsWith('.csv') || mime.includes('csv')) return 'CSV File';
  if (lower.endsWith('.pdf') || mime.includes('pdf')) return 'PDF Document';
  return 'File';
}

function FileIcon({ name, mime }: { name: string; mime: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return <FileSpreadsheet size={16} color="#16a34a" />;
  }
  if (lower.endsWith('.pdf') || mime.includes('pdf')) {
    return <FileText size={16} color="#CC0000" />;
  }
  return <FileText size={16} color="var(--cd-text-muted)" />;
}

function TreeNode({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  node: DocFolder;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasKids = (node.children?.length || 0) > 0;
  const selected = selectedId === node.id;

  return (
    <div className="bpl-docs-tree-branch">
      <button
        type="button"
        className={`bpl-docs-tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.id)}
      >
        <span
          className={`bpl-docs-tree-chevron${hasKids ? '' : ' empty'}`}
          onClick={e => {
            if (!hasKids) return;
            e.stopPropagation();
            onToggle(node.id);
          }}
          role={hasKids ? 'button' : undefined}
        >
          {hasKids ? <ChevronRight size={12} className={isOpen ? 'rotated' : ''} /> : null}
        </span>
        {isOpen || selected
          ? <FolderOpen size={14} color="#0078D4" />
          : <Folder size={14} color="#ca8a04" />}
        <span className="bpl-docs-tree-name">{node.name}</span>
      </button>
      {isOpen && hasKids && node.children!.map(child => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function DocumentsExplorer({ showHeader = true }: { showHeader?: boolean } = {}) {
  const [tree, setTree] = useState<DocFolder[]>(() =>
    peekAuthJson<{ tree?: DocFolder[] }>(DOCUMENTS_TREE_URL)?.tree ?? [],
  );
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<DocFolder[]>([]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(() => !peekAuthJson(DOCUMENTS_TREE_URL));
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    const url = DOCUMENTS_TREE_URL;
    const data = await fetchAuthJsonCached<{ tree?: DocFolder[] }>(url)
      ?? peekAuthJson<{ tree?: DocFolder[] }>(url);
    if (!data) throw new Error('Could not load folder tree');
    const nextTree = (data.tree || []) as DocFolder[];
    setTree(nextTree);
    setExpanded(prev => {
      const n = new Set(prev);
      for (const root of nextTree) n.add(root.id);
      return n;
    });
    return nextTree;
  }, []);

  const loadFolder = useCallback(async (id: string | null) => {
    const qs = id ? `?folderId=${encodeURIComponent(id)}` : '';
    const url = `/api/documents${qs}`;
    const data = await fetchAuthJsonCached<{
      folder?: DocFolder;
      breadcrumbs?: DocFolder[];
      folders?: DocFolder[];
      files?: DocFile[];
    }>(url) ?? peekAuthJson(url);
    if (!data) throw new Error('Could not open folder');
    setFolderId(data.folder?.id || null);
    setBreadcrumbs(data.breadcrumbs || []);
    setFolders(data.folders || []);
    setFiles(data.files || []);
    if (data.folder?.id) {
      setExpanded(prev => {
        const n = new Set(prev);
        for (const crumb of data.breadcrumbs || []) n.add(crumb.id);
        return n;
      });
    }
  }, []);

  const refresh = useCallback(async (preferFolderId?: string | null) => {
    const hasTree = !!peekAuthJson(DOCUMENTS_TREE_URL);
    if (!hasTree) setLoading(true);
    setError(null);
    try {
      const nextTree = await loadTree();
      const target = preferFolderId ?? folderId ?? nextTree[0]?.id ?? null;
      await loadFolder(target);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [folderId, loadFolder, loadTree]);

  useEffect(() => {
    void refresh(null);
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const openFolder = async (id: string | null) => {
    setLoading(true);
    setError(null);
    try {
      await loadFolder(id);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to open folder');
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (file: DocFile) => {
    setDownloadingId(file.id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(file.id)}/download`, authFetchInit());
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error)?.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  const currentPath = breadcrumbs.length
    ? `This PC \\ Documents \\ ${breadcrumbs.map(b => b.name).join(' \\ ')}`
    : 'This PC \\ Documents';

  return (
    <div>
      {showHeader && (
        <div className="bpl-page-header bpl-page-header-row">
          <div>
            <h1 className="bpl-page-title">
              <Folder size={18} color="#0078D4" style={{ display: 'inline', marginRight: 8, verticalAlign: -3 }} />
              Documents
            </h1>
            <p className="bpl-page-subtitle">
              Report library — downloads from Reports are filed here automatically
            </p>
          </div>
          <button
            type="button"
            className="bpl-docs-refresh"
            onClick={() => void refresh(folderId)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      )}

        <div className="bpl-docs-explorer">
          <aside className="bpl-docs-sidebar">
            <div className="bpl-docs-sidebar-head">
              <HardDrive size={14} />
              This PC
            </div>
            <div className="bpl-docs-tree">
              <button
                type="button"
                className={`bpl-docs-tree-row${folderId === null ? ' selected' : ''}`}
                onClick={() => void openFolder(null)}
              >
                <span className="bpl-docs-tree-chevron empty" />
                <FolderOpen size={14} color="#0078D4" />
                <span className="bpl-docs-tree-name">Documents</span>
              </button>
              {tree.map(node => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={1}
                  selectedId={folderId}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  onSelect={id => void openFolder(id)}
                />
              ))}
            </div>
          </aside>

          <section className="bpl-docs-main">
            <div className="bpl-docs-address">
              <span className="bpl-docs-address-label">Address</span>
              <div className="bpl-docs-breadcrumbs">
                <button type="button" onClick={() => void openFolder(null)}>Documents</button>
                {breadcrumbs.map(crumb => (
                  <span key={crumb.id} className="bpl-docs-crumb">
                    <ChevronRight size={12} />
                    <button type="button" onClick={() => void openFolder(crumb.id)}>{crumb.name}</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="bpl-docs-path-hint">{currentPath}</div>

            {error && <div className="bpl-docs-error">{error}</div>}

            <div className="bpl-docs-list-wrap">
              {loading && folders.length === 0 && files.length === 0 ? (
                <div style={{ padding: 16 }}><SkelTable rows={6} /></div>
              ) : folders.length === 0 && files.length === 0 ? (
                <div className="bpl-docs-empty">
                  <Folder size={28} style={{ opacity: 0.35 }} />
                  <span>This folder is empty</span>
                  <span className="bpl-docs-empty-sub">
                    Download a report from Reports — it will appear under Reports → Year → Month → Events.
                  </span>
                </div>
              ) : (
                <table className="bpl-docs-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Date modified</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {folders.map(folder => (
                      <tr
                        key={folder.id}
                        className="bpl-docs-row"
                        onDoubleClick={() => void openFolder(folder.id)}
                      >
                        <td>
                          <button type="button" className="bpl-docs-name-btn" onClick={() => void openFolder(folder.id)}>
                            <Folder size={16} color="#ca8a04" />
                            {folder.name}
                          </button>
                        </td>
                        <td>{fmtDate(folder.createdAt)}</td>
                        <td>File folder</td>
                        <td>—</td>
                        <td />
                      </tr>
                    ))}
                    {files.map(file => (
                      <tr
                        key={file.id}
                        className="bpl-docs-row"
                        onDoubleClick={() => void downloadFile(file)}
                      >
                        <td>
                          <span className="bpl-docs-file-name">
                            <FileIcon name={file.name} mime={file.mime} />
                            {file.name}
                          </span>
                        </td>
                        <td>{fmtDate(file.createdAt)}</td>
                        <td>{fileKind(file.name, file.mime)}</td>
                        <td>{fmtSize(file.sizeBytes)}</td>
                        <td>
                          <button
                            type="button"
                            className="bpl-docs-dl"
                            title="Download"
                            disabled={downloadingId === file.id}
                            onClick={() => void downloadFile(file)}
                          >
                            {downloadingId === file.id
                              ? <Loader2 size={14} className="spin" />
                              : <Download size={14} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
  );
}

export default function DocumentsPage() {
  return (
    <FeatureGate featureId="reports">
      <DocumentsExplorer />
    </FeatureGate>
  );
}
