import type { ContentThemeId } from './types';

export const contentThemes: Array<{ id: ContentThemeId; label: string }> = [
  { id: 'notebook', label: 'Notebook' },
  { id: 'typora-base', label: 'Typora base' },
  { id: 'typora-proof', label: 'Typora proof' },
  { id: 'typora-konayuki', label: 'Konayuki' },
  { id: 'typora-swiss', label: 'Swiss' },
  { id: 'typora-folio', label: 'Folio' },
  { id: 'typora-zeus', label: 'Zeus' },
  { id: 'typora-bonne-nouvelle', label: 'Bonne nouvelle' },
  { id: 'typora-flexoki-light', label: 'Flexoki Light' },
  { id: 'typora-inkwell', label: 'Inkwell' },
  { id: 'typora-gruvbox-dark', label: 'Gruvbox Dark' },
  { id: 'typora-bit-clean-light', label: 'Bit Clean Light' },
  { id: 'typora-print', label: 'Print' },
  { id: 'typora-ravel-light', label: 'Ravel Light' }
];

export const contentThemeIds = new Set<ContentThemeId>(contentThemes.map((theme) => theme.id));
