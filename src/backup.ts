import * as db from './db';
import { boot, emit, store } from './state';
import { syncSchedule } from './schedule';

const FORMAT = '147-backup-v1';

export interface Backup {
  format: string;
  exportedAt: string;
  subjects: unknown[];
  chapters: unknown[];
  topics: unknown[];
  logs: unknown[];
  blurts: unknown[];
  days: unknown[];
  deletes: unknown[];
}

export function buildBackup(): Backup {
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    subjects: store.subjects,
    chapters: store.chapters,
    topics: store.topics,
    logs: store.logs,
    blurts: store.blurts,
    days: store.days,
    deletes: store.deletes,
  };
}

interface FilesystemPlugin {
  writeFile(opts: {
    path: string;
    data: string;
    directory: string;
    encoding: string;
    recursive?: boolean;
  }): Promise<{ uri: string }>;
}

interface SharePlugin {
  share(opts: { title?: string; text?: string; url?: string }): Promise<unknown>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { Filesystem?: FilesystemPlugin; Share?: SharePlugin };
}

/**
 * An <a download> never reaches the disk inside the Android WebView, so on the
 * phone the file is written to Documents and handed to the share sheet instead.
 */
export async function saveFile(name: string, mime: string, text: string): Promise<void> {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.Filesystem) {
    const res = await cap.Plugins.Filesystem.writeFile({
      path: name,
      data: text,
      directory: 'DOCUMENTS',
      encoding: 'utf8',
      recursive: true,
    });
    await cap.Plugins.Share?.share({ title: name, url: res.uri });
    return;
  }

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function restoreBackup(text: string): Promise<{ ok: boolean; message: string }> {
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' };
  }
  if (data.format !== FORMAT || !Array.isArray(data.subjects)) {
    return { ok: false, message: 'That file is not a 147 backup.' };
  }

  await db.clearAll();
  await Promise.all([
    db.putMany('subjects', data.subjects, false),
    db.putMany('chapters', data.chapters ?? [], false),
    db.putMany('topics', data.topics ?? [], false),
    db.putMany('logs', data.logs ?? [], false),
    db.putMany('blurts', data.blurts ?? [], false),
    db.putMany('days', data.days ?? [], false),
    db.putMany('deletes', data.deletes ?? [], false),
  ]);
  await boot();
  await syncSchedule();
  emit();
  return {
    ok: true,
    message: `Restored ${data.subjects.length} subject(s) and ${(data.logs ?? []).length} class log(s).`,
  };
}
