import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { importAttachmentFile } from './editor';
import { isTauri } from '@tauri-apps/api/core';

const decorationLayout = { leafX: -48, leafY: 93, leafSize: 50, leafRotation: -8, captionX: -35, captionY: 39, captionWidth: 48, captionSize: 13 };
const defaults = {
  footerScale: 1, captionScale: 1, captionIncludesSignature: false, footerX: 0, footerY: 0, footerRotation: 0, captionX: 0, captionY: 0, captionRotation: 0,
  brandText: 'folia', customDesk: false, background: '#e5e3da', image: '', opacity: 0.65, paper: '#faf7ef', autoPaper: true,
  footerImage: '', footerText: 'Little by little, a lot.', cardImage: '', cardText: '把想法，停在更安静的地方。',
  rightText: '', leaves: true, shadow: 0.18, leftAngle: 0.6, pageAngle: 1.5, rightAngle: -3
};
type Settings = typeof defaults;
function load(shell: string): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(`folia.paperShell.${shell}`) || '{}');
    if (shell === 'typora-tilted' && !saved.captionIncludesSignature) { saved.cardText = `${typeof saved.cardText === 'string' ? saved.cardText : defaults.cardText}\n\n— folia`; saved.captionIncludesSignature = true; }
    if (typeof saved.autoPaper !== 'boolean') saved.autoPaper = !saved.paper || saved.paper === defaults.paper;
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key,
      typeof saved[key] === typeof value ? saved[key] : value])) as Settings;
  } catch { return { ...defaults }; }
}
const backgroundImage = (url: string) => url.trim() ? `url(${JSON.stringify(url.trim())})` : 'none';
export function usePaperShell(shell: string) {
  const [all, setAll] = useState<Record<string, Settings>>(() => ({
    'native-garden': load('native-garden'), 'typora-garden': load('typora-garden'), 'typora-tilted': load('typora-tilted'), 'typora-collage': load('typora-collage')
  }));
  const settings = { ...defaults, ...all[shell] };
  const update = (patch: Partial<Settings>) => setAll(current => {
    const next = { ...defaults, ...current[shell], ...patch };
    localStorage.setItem(`folia.paperShell.${shell}`, JSON.stringify(next));
    return { ...current, [shell]: next };
  });
  const style = {
    '--paper-desk': settings.background, '--paper-image': backgroundImage(settings.image),
    '--paper-image-opacity': settings.opacity,
    '--paper-color': settings.autoPaper ? 'color-mix(in srgb, var(--typora-shell-panel) 94%, var(--typora-shell-bg) 6%)' : settings.paper,
    '--paper-shadow-alpha': settings.shadow, '--paper-left-angle': `${settings.leftAngle}deg`,
    '--leaf-x': `${decorationLayout.leafX}px`, '--leaf-y': `${decorationLayout.leafY}px`, '--leaf-scale': decorationLayout.leafSize / 100, '--leaf-rotation': `${decorationLayout.leafRotation}deg`,
    '--caption-x': `${decorationLayout.captionX}px`, '--caption-y': `${decorationLayout.captionY}px`, '--caption-width': decorationLayout.captionWidth / 100, '--caption-size': `${decorationLayout.captionSize}px`,
    '--paper-page-angle': `${settings.pageAngle}deg`, '--paper-right-angle': `${settings.rightAngle}deg`
  } as CSSProperties;
  const gardenStyle = {
    '--garden-desk-color': settings.customDesk ? settings.background : 'transparent',
    '--garden-desk-image': backgroundImage(settings.image), '--garden-desk-opacity': settings.opacity
  } as CSSProperties;
  return { settings, update, style, gardenStyle };
}
function AppearanceImage({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const local = /^(data:|asset:|https?:\/\/asset\.localhost)/.test(value);
  return <div className="appearance-image-field">
    <label>{label}<input aria-label={`${label} URL`} value={local ? '' : value} placeholder={local ? '已选择本地图片，可输入 URL 替换' : '粘贴图片 URL'} onChange={event => onChange(event.target.value)} /></label>
    <input ref={input} hidden type="file" accept="image/*" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      setError(''); setBusy(true);
      try {
        let imageFile = file;
        if (!isTauri()) {
          const bitmap = await createImageBitmap(file);
          const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error()), 'image/webp', .85));
          imageFile = new File([blob], 'background.webp', { type: blob.type });
        }
        const imported = await importAttachmentFile(imageFile);
        // Check capacity before applying a browser-stored image.
        if (!isTauri()) { localStorage.setItem('folia.imageImportCheck', imported.src); localStorage.removeItem('folia.imageImportCheck'); }
        onChange(imported.src);
      } catch { setError('图片未能保存，请尝试较小的图片或使用图片 URL。'); }
      finally { setBusy(false); }
    }} />
    <div className="appearance-image-actions"><button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在导入…' : '选择本地图片'}</button>{value && <button type="button" onClick={() => onChange('')}>清除图片</button>}</div>
    {error && <span role="alert">{error}</span>}
  </div>;
}

export function PaperSettings({ shell, settings, update }: { shell: string; settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const collage = shell === 'typora-collage';
  return <details className="paper-settings"><summary>{collage ? '拼贴纸张与装饰' : '倾斜纸张与装饰'}</summary><div className="paper-settings-fields">
    <label>纸色跟随正文主题<input type="checkbox" checked={settings.autoPaper} onChange={e => update({ autoPaper: e.target.checked })} /></label>
    {([['background', '桌面颜色'], ['paper', '纸张颜色']] as const).map(([key, label]) =>
      <label key={key}>{label}<input type="color" value={settings[key]} onChange={e => update({ [key]: e.target.value, ...(key === 'paper' ? { autoPaper: false } : {}) })} /></label>)}
    {([['image', '桌面背景图片'], ['footerImage', '左下背景图片'], ['cardImage', '右侧挂画图片'], ['cardText', '右栏下方文字'], ['rightText', '左栏顶部文字']] as const).filter(([key]) => collage ? key !== 'cardText' && key !== 'rightText' : key !== 'cardImage').map(([key, label]) =>
      key.includes('Image') || key === 'image' ? <AppearanceImage key={key} label={label} value={settings[key]} onChange={value => update({ [key]: value })} /> : <label key={key}>{label}<input value={settings[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}
    {([['opacity', '背景透明度', 0, 1, 0.05], ['shadow', '阴影强度', 0, 0.4, 0.02], ['leftAngle', '左框上沿倾斜', -4, 4, 0.1], ['pageAngle', '正文外框角度', -3, 3, 0.1], ['rightAngle', '右框上沿倾斜', -5, 5, 0.1]] as const).filter(([key]) => !collage || (key !== 'leftAngle' && key !== 'rightAngle')).map(([key, label, min, max, step]) =>
      <label key={key}>{label} · {settings[key]}<input type="range" min={min} max={max} step={step} value={settings[key]} onChange={e => update({ [key]: Number(e.target.value) })} /></label>)}
    {collage && <label>树叶装饰<input type="checkbox" checked={settings.leaves} onChange={e => update({ leaves: e.target.checked })} /></label>}
    <p>{collage ? '双击文字可编辑；左下文字和右侧题字还可拖动、旋转，顶部品牌位置固定。' : '左栏顶部文字、左下文字和背景题字均可双击修改。'}</p>
    <button type="button" onClick={() => update({ background: defaults.background, image: '', opacity: defaults.opacity, paper: defaults.paper, autoPaper: true, footerImage: '', leaves: true, shadow: defaults.shadow, ...(collage ? { cardImage: '', pageAngle: defaults.pageAngle } : { leftAngle: defaults.leftAngle, pageAngle: defaults.pageAngle, rightAngle: defaults.rightAngle }) })}>恢复默认外观</button>
  </div></details>;
}
export function GardenAppearance({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return <details className="paper-settings"><summary>背景外观</summary><div className="paper-settings-fields">
    <label>自定义背景颜色<input type="checkbox" checked={settings.customDesk} onChange={e => update({ customDesk: e.target.checked })} /></label>
    <label>背景颜色<input type="color" value={settings.background} onChange={e => update({ background: e.target.value, customDesk: true })} /></label>
    <AppearanceImage label="背景图片" value={settings.image} onChange={image => update({ image })} />
    <label>背景图片透明度<input type="range" min="0" max="1" step="0.05" value={settings.opacity} onChange={e => update({ opacity: Number(e.target.value) })} /></label>
    <button type="button" onClick={() => update({ customDesk: false, image: '', opacity: defaults.opacity })}>恢复默认背景</button>
  </div></details>;
}
// Sprite windows preserve the supplied pixels and alpha without resampling the source.
const spriteRegions = {
  newSprig: [200, 0, 345, 590],
  newFlowers: [410, 432, 310, 590],
  newBranch: [823, 42, 660, 943],
  linen: [32, 26, 492, 469],
  landscape: [37, 795, 397, 186],
  lake: [750, 781, 174, 201],
  mountains: [990, 805, 306, 173],
  leaves: [962, 512, 164, 267],
  broadLeaf: [1270, 538, 96, 232],
  branch: [575, 636, 202, 356],
  brownTape: [265, 531, 190, 70],
  tape: [26, 527, 214, 73],
  clip: [899, 561, 55, 158]
} as const;
export function PaperSprite({ name, className = '' }: { name: keyof typeof spriteRegions; className?: string }) {
  const [x, y, width, height] = spriteRegions[name];
  return <span aria-hidden="true" className={`paper-sprite ${className}`}>
    <svg viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio={name.startsWith('new') ? 'xMidYMid meet' : ['leaves', 'branch', 'broadLeaf'].includes(name) ? 'none' : 'xMidYMid slice'} focusable="false">
      <image href={name.startsWith('new') ? '/app-assets/paper/flower.png' : name === 'branch' ? '/app-assets/paper/material-sheet-2.png' : '/app-assets/paper/material-sheet.png'} width="1536" height="1024" />
    </svg>
  </span>;
}
export function PaperBackdrop({ collage, custom }: { collage: boolean; custom: boolean }) {
  if (custom) return null;
  if (!collage) return <img className="paper-scenery" src="/app-assets/paper/background2.png" alt="" aria-hidden="true" />;
  return <svg className="paper-fabric" aria-hidden="true" width="100%" height="100%">
    <defs><pattern id="paper-linen-tile" width="460" height="460" patternUnits="userSpaceOnUse"><svg width="460" height="460" viewBox="12 12 586 586" overflow="hidden"><image href="/app-assets/paper/bg.png" width="610" height="610" /></svg></pattern></defs>
    <rect width="100%" height="100%" fill="url(#paper-linen-tile)" />
  </svg>;
}
export function PaperBrand({ value, onChange }: EditableTextProps) {
  return <div className="paper-brand"><PaperSprite name="newSprig" /><PaperEditableText value={value} onChange={onChange} label="左栏品牌文字" /></div>;
}
export function PaperCard({ settings, pinned = false, onFooterChange, footerLayout, onFooterLayoutChange }: { settings: Settings; pinned?: boolean; onFooterChange?: (text: string) => void; footerLayout?: TextLayout; onFooterLayoutChange?: (layout: TextLayout) => void }) {
  const customImage = (pinned ? settings.cardImage : settings.footerImage).trim();
  return <div className={pinned ? 'paper-pinned-card' : `paper-sidebar-footer ${customImage ? 'has-custom-image' : ''}`}>
    <div className="paper-card-image" style={{ backgroundImage: customImage ? backgroundImage(customImage) : undefined }}>
      {!customImage ? <PaperSprite name={pinned ? 'mountains' : 'landscape'} /> : null}
    </div>
    {!pinned ? <p>{onFooterChange ? <PaperEditableText value={settings.footerText} onChange={onFooterChange} label="左栏下方文字" layout={footerLayout} onLayoutChange={onFooterLayoutChange} /> : settings.footerText}</p> : null}
    {pinned ? <><PaperSprite name="brownTape" className="paper-photo-under-tape" /><PaperSprite name="clip" className="paper-real-clip" /></> : settings.leaves ? <PaperSprite name="newFlowers" className="paper-footer-leaf" /> : null}
  </div>;
}
export function PaperLeaves() {
  return <PaperSprite name="newBranch" className="paper-leaves" />;
}

export function PaperSidebarNote({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="paper-sidebar-note"><PaperEditableText value={value} onChange={text => onChange(text.replace(/[\r\n]+/g, ' ').slice(0, 160))} label="左栏顶部文字" /></div>;
}

type TextLayout = { x: number; y: number; rotation: number; scale?: number };
type EditableTextProps = { value: string; onChange: (text: string) => void; label?: string; layout?: TextLayout; onLayoutChange?: (layout: TextLayout) => void };

export function PaperEditableText({ value, onChange, label = '文字', layout, onLayoutChange }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const original = useRef(value);
  const gesture = useRef<{ kind: string; x: number; y: number; cx: number; cy: number; distance: number; angle: number; layout: TextLayout } | null>(null);
  useLayoutEffect(() => { if (!editing && textRef.current) textRef.current.textContent = value; }, [value, editing]);
  const begin = () => { original.current = value; setEditing(true); };
  useLayoutEffect(() => { if (editing) textRef.current?.focus(); }, [editing]);
  const save = () => { onChange(textRef.current?.innerText.replace(/\r/g, '') ?? value); setEditing(false); };
  return <span ref={frameRef} className={`paper-text-placement ${editing ? 'is-editing' : ''}`} style={layout ? { transform: `translate(${layout.x}px, ${layout.y}px) rotate(${layout.rotation}deg) scale(${layout.scale ?? 1})` } : undefined}
    onBlur={event => { if (editing && !event.currentTarget.contains(event.relatedTarget as Node | null)) save(); }}
    onKeyDown={event => {
      if (!editing) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (textRef.current) textRef.current.textContent = original.current; setEditing(false); }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save(); }
    }}>
    <span ref={textRef} className="paper-editable-text" contentEditable={editing ? 'plaintext-only' : false} suppressContentEditableWarning role={editing ? 'textbox' : 'button'} aria-multiline={editing || undefined} tabIndex={0} aria-label={editing ? label : `编辑${label}`} data-placeholder="双击写点什么…" title="双击编辑；Enter 保存，Shift+Enter 换行" onDoubleClick={begin} onKeyDown={event => { if (!editing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); begin(); } }} />
    {editing && layout && onLayoutChange ? <span className="paper-text-handles" aria-label={`${label}位置调整`}>
      {['move', 'scale', 'rotate'].map(kind => <button key={kind} type="button" className={`paper-text-handle handle-${kind}`} aria-label={`${kind === 'move' ? '移动' : kind === 'scale' ? '缩放' : '旋转'}${label}`} title={kind === 'move' ? '拖动边框移动' : kind === 'scale' ? '拖动缩放' : '拖动旋转'} onPointerDown={event => {
        event.preventDefault();
        const rect = frameRef.current!.getBoundingClientRect();
        const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
        gesture.current = { kind, x: event.clientX, y: event.clientY, cx, cy, distance: Math.max(1, Math.hypot(event.clientX - cx, event.clientY - cy)), angle: Math.atan2(event.clientY - cy, event.clientX - cx), layout: { ...layout } };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const g = gesture.current;
        if (!g) return;
        if (g.kind === 'move') onLayoutChange({ ...g.layout, x: g.layout.x + event.clientX - g.x, y: g.layout.y + event.clientY - g.y });
        if (g.kind === 'scale') onLayoutChange({ ...g.layout, scale: Math.max(.4, Math.min(3, (g.layout.scale ?? 1) * Math.hypot(event.clientX - g.cx, event.clientY - g.cy) / g.distance)) });
        if (g.kind === 'rotate') onLayoutChange({ ...g.layout, rotation: Math.round(g.layout.rotation + (Math.atan2(event.clientY - g.cy, event.clientX - g.cx) - g.angle) * 180 / Math.PI) });
      }} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} />)}
    </span> : null}
  </span>;
}
