import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { reloadTimelines, setItems } from 'tauri-plugin-widgets-api';
import { foliaWidgetSnapshot, widgetImageData } from './App';
import type { Block, Page } from './types';

type Result = { block: Block; pageTitle: string };
export function WidgetPicker() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void invoke<Result[]>('search_widget_blocks', { query }).then(rows => { if (!cancelled) setResults(rows); }).catch(error => { if (!cancelled) setNotice(String(error)); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);
  const select = async ({ block, pageTitle }: Result) => {
    setBusy(true); setNotice('正在更新小组件…');
    try {
      const snapshot = foliaWidgetSnapshot(block, { id: block.pageId, title: pageTitle } as Page);
      for (const line of snapshot.lines) if (line.imageSource) {
        line.imageData = await widgetImageData(line.imageSource); delete line.imageSource;
      }
      await setItems('foliaWidgetBlocks', JSON.stringify({ version: 1, selectedBlockId: block.id, blocks: [snapshot] }), 'group.com.laeglaur.notebook');
      window.localStorage.setItem('folia:desktop-widget-block', block.id);
      await emit('folia:widget-selected', block.id);
      await reloadTimelines('FoliaBlockWidgetV3');
      setNotice('已选择。小组件若固定了其他 Block，请在其设置中清除固定选择。');
    } catch (error) { setNotice(String(error)); }
    finally { setBusy(false); }
  };
  return <main className="widget-picker" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); input.current?.focus(); input.current?.select(); }
  }}>
    <h1>选择小组件内容</h1>
    <p>搜索正文或页面名称。可替换小组件内容，也可打开 block 的完整窗口。</p>
    <input ref={input} autoFocus aria-label="搜索 block" placeholder="搜索 block · ⌘F" value={query} onChange={event => setQuery(event.target.value)} />
    <p role="status">{notice}</p>
    <section aria-label="搜索结果">{results.map(result => <article key={result.block.id}>
      <small>{result.pageTitle}</small>
      <p>{result.block.content.plainText.replace(/\s+/g, ' ').trim().slice(0, 240) || '图片或富文本内容'}</p>
      <div><button disabled={busy} onClick={() => void select(result)}>显示到小组件</button><button onClick={() => void invoke('open_widget_block', { blockId: result.block.id }).catch(error => setNotice(String(error)))}>打开完整窗口</button></div>
    </article>)}{!results.length && <p>没有匹配的 block</p>}</section>
  </main>;
}
