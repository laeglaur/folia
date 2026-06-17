import { useState } from 'react';
import { Link, Upload, X } from 'lucide-react';
import { importIconFiles, importIconUrl } from './icon-packs';
import type { Notebook, NotebookIconAsset, NotebookIconPack, Page } from './types';

type IconPackDialogTarget =
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'page'; pageId: string };

export type IconPackDialogRequest = {
  target: IconPackDialogTarget;
};

export function IconPackDialog({
  request,
  notebooks,
  pages,
  onClose,
  onImportPack,
  onAddIcon,
  onChooseIcon,
  onClearIcon
}: {
  request: IconPackDialogRequest | null;
  notebooks: Notebook[];
  pages: Page[];
  onClose: () => void;
  onImportPack: (pack: NotebookIconPack) => void;
  onAddIcon: (icon: NotebookIconAsset) => void;
  onChooseIcon: (target: IconPackDialogTarget, iconId: string) => void;
  onClearIcon: (target: IconPackDialogTarget) => void;
}) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  if (!request) return null;
  const target = request.target;

  let targetNotebook: Notebook | null = null;
  if (target.kind === 'notebook') {
    targetNotebook = notebooks.find((notebook) => notebook.id === target.notebookId) ?? null;
  } else {
    const targetPage = pages.find((page) => page.id === target.pageId) ?? null;
    targetNotebook = targetPage ? notebooks.find((notebook) => notebook.id === targetPage.notebookId) ?? null : null;
  }
  const pack = targetNotebook?.metadata.iconPack ?? null;
  let targetLabel = 'Notebook';
  if (target.kind === 'notebook') {
    targetLabel = targetNotebook?.name ?? 'Notebook';
  } else {
    targetLabel = pages.find((page) => page.id === target.pageId)?.title ?? 'Page';
  }

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setStatus('Importing icons...');
    const imported = await importIconFiles(files, targetNotebook?.name ?? 'Imported icons');
    if (imported) {
      onImportPack(imported);
      setStatus(`Imported ${imported.icons.length} icons.`);
    } else {
      setStatus('No image icons found in that selection.');
    }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setStatus('Fetching icon...');
    try {
      const icon = await importIconUrl(url);
      if (icon) {
        onAddIcon(icon);
        setUrl('');
        setStatus('Icon added to this notebook pack.');
      }
    } catch (error) {
      console.warn('Could not import icon URL.', error);
      setStatus('Could not fetch that icon URL.');
    }
  };

  return (
    <div className="icon-pack-backdrop" role="dialog" aria-modal="true" aria-label="Notebook icon pack">
      <div className="icon-pack-dialog">
        <header className="icon-pack-head">
          <div>
            <strong>Notebook icons</strong>
            <span>{targetLabel}</span>
          </div>
          <button className="mini-button" type="button" onClick={onClose} aria-label="Close icon picker"><X size={15} /></button>
        </header>

        <section className="icon-pack-imports">
          <label className="secondary-button icon-pack-file-button">
            <Upload size={15} /> Import files
            <input
              hidden
              multiple
              accept="image/*,.svg,.png,.jpg,.jpeg,.webp,.gif"
              type="file"
              onChange={(event) => {
                void importFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <div className="icon-url-import">
            <Link size={15} />
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste image URL" />
            <button className="secondary-button" type="button" onClick={() => void importUrl()}>Add</button>
          </div>
        </section>

        {status ? <p className="icon-pack-status">{status}</p> : null}

        <section className="icon-pack-grid" aria-label="Icons in current notebook pack">
          {pack?.icons.length ? pack.icons.map((icon) => (
            <button key={icon.id} type="button" className="icon-choice" onClick={() => onChooseIcon(target, icon.id)} title={icon.name}>
              <img src={icon.src} alt="" aria-hidden="true" />
              <span>{icon.name}</span>
            </button>
          )) : <p className="icon-pack-empty">Import a Flaticon pack or paste one image URL to start.</p>}
        </section>

        <footer className="icon-pack-foot">
          <button className="secondary-button" type="button" onClick={() => onClearIcon(target)}>Clear icon</button>
        </footer>
      </div>
    </div>
  );
}
