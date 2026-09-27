import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { WidgetPicker } from './WidgetPicker';
import './styles.css';
import './styles/typora-shell.css';
import './styles/typora-content.css';
import './styles/typora-editor-chrome.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('widgetPicker') === '1' ? <WidgetPicker /> : <App />}
  </React.StrictMode>
);
