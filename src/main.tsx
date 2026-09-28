import { initializePortableStorage, relocatePortableAppearance } from './portable';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { WidgetPicker } from './WidgetPicker';
import './styles.css';
import './styles/typora-shell.css';
import './styles/typora-content.css';
import './styles/typora-editor-chrome.css';

async function start() {
await initializePortableStorage();
relocatePortableAppearance();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('widgetPicker') === '1' ? <WidgetPicker /> : <App />}
  </React.StrictMode>
);

}
void start().catch(error => { const root = document.getElementById('root'); if (root) root.textContent = `无法打开便携数据目录 / Cannot open portable data: ${String(error)}`; });
