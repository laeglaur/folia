import { useState, type CSSProperties } from 'react';

const decorationLayout = { leafX: -48, leafY: 93, leafSize: 50, leafRotation: -8, captionX: -35, captionY: 39, captionWidth: 48, captionSize: 13 };
const defaults = {
  customDesk: false, background: '#e5e3da', image: '', opacity: 0.65, paper: '#faf7ef', autoPaper: true,
  footerImage: '', footerText: 'Little by little, a lot.', cardImage: '', cardText: '把想法，停在更安静的地方。',
  rightText: '', leaves: true, shadow: 0.18, leftAngle: 0.6, pageAngle: 1.5, rightAngle: -3
};
type Settings = typeof defaults;
function load(shell: string): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(`folia.paperShell.${shell}`) || '{}');
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
export function PaperSettings({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return <details className="paper-settings"><summary>纸张外观</summary><div className="paper-settings-fields">
    <label>纸色跟随正文主题<input type="checkbox" checked={settings.autoPaper} onChange={e => update({ autoPaper: e.target.checked })} /></label>
    {([['background', '桌面颜色'], ['paper', '纸张颜色']] as const).map(([key, label]) =>
      <label key={key}>{label}<input type="color" value={settings[key]} onChange={e => update({ [key]: e.target.value, ...(key === 'paper' ? { autoPaper: false } : {}) })} /></label>)}
    {([['image', '桌面背景图片'], ['footerImage', '左下背景图片'], ['footerText', '左下文字'], ['cardImage', '右上卡片图片'], ['cardText', '右侧题字'], ['rightText', '左栏顶部文字']] as const).map(([key, label]) =>
      <label key={key}>{label}<input value={settings[key]} placeholder={key.includes('Image') || key === 'image' ? '图片 URL / 应用资源路径' : ''} onChange={e => update({ [key]: e.target.value })} /></label>)}
    {([['opacity', '背景透明度', 0, 1, 0.05], ['shadow', '阴影强度', 0, 0.4, 0.02], ['leftAngle', '左框角度', -4, 4, 0.1], ['pageAngle', '正文外框角度', -3, 3, 0.1], ['rightAngle', '右框角度', -5, 5, 0.1]] as const).map(([key, label, min, max, step]) =>
      <label key={key}>{label} · {settings[key]}<input type="range" min={min} max={max} step={step} value={settings[key]} onChange={e => update({ [key]: Number(e.target.value) })} /></label>)}
    <label>树叶装饰<input type="checkbox" checked={settings.leaves} onChange={e => update({ leaves: e.target.checked })} /></label>
    <button type="button" onClick={() => update(defaults)}>恢复默认</button>
  </div></details>;
}
export function GardenAppearance({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return <details className="paper-settings"><summary>背景外观</summary><div className="paper-settings-fields">
    <label>自定义背景颜色<input type="checkbox" checked={settings.customDesk} onChange={e => update({ customDesk: e.target.checked })} /></label>
    <label>背景颜色<input type="color" value={settings.background} onChange={e => update({ background: e.target.value, customDesk: true })} /></label>
    <label>背景图片<input value={settings.image} placeholder="图片 URL / 应用资源路径" onChange={e => update({ image: e.target.value })} /></label>
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
export function PaperBrand() {
  return <div className="paper-brand"><PaperSprite name="newSprig" /><span>folia</span></div>;
}
export function PaperCard({ settings, pinned = false }: { settings: Settings; pinned?: boolean }) {
  const customImage = (pinned ? settings.cardImage : settings.footerImage).trim();
  return <div className={pinned ? 'paper-pinned-card' : `paper-sidebar-footer ${customImage ? 'has-custom-image' : ''}`}>
    <div className="paper-card-image" style={{ backgroundImage: customImage ? backgroundImage(customImage) : undefined }}>
      {!customImage ? <PaperSprite name={pinned ? 'mountains' : 'landscape'} /> : null}
    </div>
    {!pinned ? <p>{settings.footerText}</p> : null}
    {pinned ? <><PaperSprite name="brownTape" className="paper-photo-under-tape" /><PaperSprite name="clip" className="paper-real-clip" /></> : settings.leaves ? <PaperSprite name="newFlowers" className="paper-footer-leaf" /> : null}
  </div>;
}
export function PaperLeaves() {
  return <PaperSprite name="newBranch" className="paper-leaves" />;
}

export function PaperSidebarNote({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <textarea className="paper-sidebar-note" aria-label="左栏顶部文字" placeholder="写一句话…" rows={1} maxLength={160} value={value} onChange={event => onChange(event.target.value)} />;
}
