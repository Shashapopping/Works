/**
 * Documents report store — Windows-style folder archive on disk + SQLite metadata.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DOCUMENTS_ROOT = path.join(process.cwd(), 'data', 'documents');

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function ensureDiskRoot() {
  fs.mkdirSync(DOCUMENTS_ROOT, { recursive: true });
}

function safeSegment(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled';
}

function monthFolderName(date = new Date()) {
  const m = date.getMonth();
  return `${String(m + 1).padStart(2, '0')}-${MONTH_NAMES[m]}`;
}

function publicFolder(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
  };
}

function publicFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    mime: row.mime || 'application/octet-stream',
    sizeBytes: row.size_bytes || 0,
    source: row.source || null,
    meta: row.meta_json ? safeJson(row.meta_json) : null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getFolderByPath(folderPath) {
  return getDb().prepare('SELECT * FROM document_folders WHERE path = ?').get(folderPath) || null;
}

function getFolderById(id) {
  if (!id) return null;
  return getDb().prepare('SELECT * FROM document_folders WHERE id = ?').get(id) || null;
}

function getFileById(id) {
  if (!id) return null;
  return getDb().prepare('SELECT * FROM document_files WHERE id = ?').get(id) || null;
}

/** Ensure folder exists under parent; path is Windows-style backslash path. */
function ensureFolder(name, parentId, parentPath) {
  const db = getDb();
  const safeName = safeSegment(name);
  const folderPath = parentPath ? `${parentPath}\\${safeName}` : safeName;
  const existing = getFolderByPath(folderPath);
  if (existing) return existing;

  const id = newId();
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO document_folders (id, parent_id, name, path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, parentId || null, safeName, folderPath, createdAt);

  const diskRel = folderPath.split('\\').join(path.sep);
  fs.mkdirSync(path.join(DOCUMENTS_ROOT, diskRel), { recursive: true });

  return getFolderByPath(folderPath);
}

/**
 * Filing chain: Reports\YYYY\MM-MonthName\Type
 * @returns {{ folder: object, relativeDir: string }}
 */
export function ensureFilingFolder({ type = 'Events', when = new Date() } = {}) {
  ensureDiskRoot();
  const date = when instanceof Date ? when : new Date(when);
  const reports = ensureFolder('Reports', null, null);
  const year = ensureFolder(String(date.getFullYear()), reports.id, reports.path);
  const month = ensureFolder(monthFolderName(date), year.id, year.path);
  const typed = ensureFolder(safeSegment(type), month.id, month.path);
  return { folder: typed, relativeDir: typed.path.split('\\').join(path.sep) };
}

function uniqueFileName(folderId, desiredName) {
  const db = getDb();
  const base = safeSegment(desiredName);
  let candidate = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM document_files WHERE folder_id = ? AND name = ?').get(folderId, candidate)) {
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    candidate = `${stem} (${n})${ext}`;
    n += 1;
    if (n > 200) {
      candidate = `${stem}-${Date.now()}${ext}`;
      break;
    }
  }
  return candidate;
}

/**
 * Archive a report buffer into the Documents store.
 * @returns {{ file: object, folder: object }}
 */
export function archiveDocument({
  filename,
  mime,
  buffer,
  type = 'Events',
  source = 'reports-download',
  meta = null,
  createdBy = null,
  when = new Date(),
}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('File content required');
    err.status = 400;
    throw err;
  }
  if (buffer.length > 40 * 1024 * 1024) {
    const err = new Error('File too large (max 40 MB)');
    err.status = 413;
    throw err;
  }

  const { folder, relativeDir } = ensureFilingFolder({ type, when });
  const name = uniqueFileName(folder.id, filename || `report-${Date.now()}.bin`);
  const storageRel = path.join(relativeDir, name);
  const absPath = path.join(DOCUMENTS_ROOT, storageRel);

  ensureDiskRoot();
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);

  const id = newId();
  const createdAt = nowIso();
  getDb().prepare(`
    INSERT INTO document_files
    (id, folder_id, name, mime, size_bytes, storage_path, source, meta_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    folder.id,
    name,
    mime || 'application/octet-stream',
    buffer.length,
    storageRel.split(path.sep).join('/'),
    source,
    meta ? JSON.stringify(meta) : null,
    createdBy || null,
    createdAt,
  );

  return {
    file: publicFile(getFileById(id)),
    folder: publicFolder(folder),
  };
}

export function listDocumentTree() {
  ensureDiskRoot();
  // Seed empty root so Explorer always has Reports
  ensureFolder('Reports', null, null);

  const rows = getDb().prepare(`
    SELECT * FROM document_folders ORDER BY path ASC
  `).all();

  const byParent = new Map();
  for (const row of rows) {
    const key = row.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(publicFolder(row));
  }

  function build(parentId) {
    const kids = byParent.get(parentId || '') || [];
    return kids.map(folder => ({
      ...folder,
      children: build(folder.id),
    }));
  }

  return build(null);
}

export function listFolderContents(folderId = null) {
  ensureDiskRoot();
  ensureFolder('Reports', null, null);

  const folder = folderId ? getFolderById(folderId) : null;
  if (folderId && !folder) {
    const err = new Error('Folder not found');
    err.status = 404;
    throw err;
  }

  const db = getDb();
  const folders = db.prepare(`
    SELECT * FROM document_folders
    WHERE ${folderId ? 'parent_id = ?' : 'parent_id IS NULL'}
    ORDER BY name COLLATE NOCASE ASC
  `).all(...(folderId ? [folderId] : [])).map(publicFolder);

  const files = folderId
    ? db.prepare(`
        SELECT * FROM document_files WHERE folder_id = ?
        ORDER BY created_at DESC, name COLLATE NOCASE ASC
      `).all(folderId).map(publicFile)
    : [];

  const breadcrumbs = [];
  let walk = folder;
  while (walk) {
    breadcrumbs.unshift(publicFolder(walk));
    walk = walk.parent_id ? getFolderById(walk.parent_id) : null;
  }

  return {
    folder: publicFolder(folder),
    breadcrumbs,
    folders,
    files,
  };
}

export function resolveDownload(fileId) {
  const row = getFileById(fileId);
  if (!row) {
    const err = new Error('File not found');
    err.status = 404;
    throw err;
  }
  const abs = path.join(DOCUMENTS_ROOT, row.storage_path.split('/').join(path.sep));
  if (!abs.startsWith(DOCUMENTS_ROOT) || !fs.existsSync(abs)) {
    const err = new Error('File missing on disk');
    err.status = 404;
    throw err;
  }
  return {
    file: publicFile(row),
    absolutePath: abs,
  };
}
