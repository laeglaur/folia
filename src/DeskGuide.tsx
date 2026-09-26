import { useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { marked } from 'marked';
import guideMarkdown from '../docs/USER_GUIDE.md?raw';

const guideHtml = marked.parse(guideMarkdown, { async: false });

export function DeskGuide() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="desk-guide desk-settings-section">
      <button className="secondary-button" type="button" onClick={() => dialog.current?.showModal()}><BookOpen size={15} aria-hidden="true" />使用说明 · 快捷键与操作</button>
      <dialog ref={dialog} className="desk-guide-dialog" aria-label="完整使用说明" onKeyDown={event => event.stopPropagation()}>
        <header><strong>使用说明</strong><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>关闭</button></header>
        <article dangerouslySetInnerHTML={{ __html: guideHtml }} />
      </dialog>
    </div>
  );
}
