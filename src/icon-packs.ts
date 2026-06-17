import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { importAttachmentFile } from './editor';
import { createId } from './state';
import type { NotebookIconAsset, NotebookIconPack } from './types';

const iconFilePattern = /\.(svg|png|jpe?g|webp|gif)$/i;

export const isIconFile = (file: File) => {
  if (file.type.startsWith('image/')) return true;
  return iconFilePattern.test(file.name);
};

const iconNameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || file.name;

const iconNameFromUrl = (url: string) => {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'online-icon');
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'online icon';
  } catch {
    return 'online icon';
  }
};

export const importIconFiles = async (files: FileList | File[], packName = 'Imported icons'): Promise<NotebookIconPack | null> => {
  const iconFiles = Array.from(files).filter(isIconFile).slice(0, 160);
  if (!iconFiles.length) return null;
  const icons = await Promise.all(iconFiles.map(async (file): Promise<NotebookIconAsset | null> => {
    try {
      const imported = await importAttachmentFile(file);
      return {
        id: createId('icon'),
        name: iconNameFromFile(file),
        src: imported.src,
        assetId: imported.assetId
      };
    } catch (error) {
      console.warn('Could not import icon file.', file.name, error);
      return null;
    }
  }));
  const usableIcons = icons.filter(Boolean) as NotebookIconAsset[];
  if (!usableIcons.length) return null;
  return {
    id: createId('icon_pack'),
    name: packName,
    icons: usableIcons
  };
};

export const importIconUrl = async (url: string): Promise<NotebookIconAsset | null> => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (isTauri()) {
    const imported = await invoke<{ id: string; storedPath: string }>('import_remote_asset', { url: trimmed });
    return {
      id: createId('icon'),
      name: iconNameFromUrl(trimmed),
      src: convertFileSrc(imported.storedPath),
      assetId: imported.id,
      sourceUrl: trimmed
    };
  }
  const response = await fetch(trimmed);
  if (!response.ok) throw new Error(`Could not fetch icon: ${response.status}`);
  const blob = await response.blob();
  const filename = decodeURIComponent(new URL(trimmed).pathname.split('/').pop() || 'online-icon.png');
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  const imported = await importAttachmentFile(file);
  return {
    id: createId('icon'),
    name: iconNameFromFile(file),
    src: imported.src,
    assetId: imported.assetId,
    sourceUrl: trimmed
  };
};

export const iconFromPack = (pack: NotebookIconPack | null | undefined, iconId?: string | null) => {
  if (!pack || !iconId) return null;
  return pack.icons.find((icon) => icon.id === iconId) ?? null;
};
