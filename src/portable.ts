import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
let portableRoot: string | null = null;
export async function initializePortableStorage() {
  if (isTauri()) portableRoot = await invoke<string | null>('portable_storage_root');
}
export function portableAssetUrl(value: string): string {
  if (!portableRoot || !/^(asset:|file:|https?:\/\/asset\.localhost\/|[A-Za-z]:[\\/])/.test(value)) return value;
  let decoded = value;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return value; }
  const match = decoded.replace(/\\/g, '/').match(/\/attachments\/([a-f0-9]{2})\/([a-f0-9]{64}(?:\.[a-z0-9]+)?)$/i);
  return match ? convertFileSrc(`${portableRoot}/attachments/${match[1]}/${match[2]}`) : value;
}
export function relocatePortableAppearance() {
  if (!portableRoot) return;
  for (const key of Object.keys(localStorage).filter(key => key.startsWith('folia.paperShell.'))) {
    try {
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      for (const field of ['image', 'footerImage', 'cardImage']) if (typeof settings[field] === 'string') settings[field] = portableAssetUrl(settings[field]);
      localStorage.setItem(key, JSON.stringify(settings));
    } catch { /* Leave unrelated or invalid preferences intact. */ }
  }
}
