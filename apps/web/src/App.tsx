import { useState } from 'react';
import { DevelopmentStatus } from './DevelopmentStatus';
import { Editor } from './editor/Editor';

export function App() {
  const [view, setView] = useState<'editor' | 'services'>('editor');

  return (
    <div className="application-shell">
      <header className="application-header">
        <div className="application-brand">
          <span className="wordmark">neobo</span>
          <span className="environment-label">本地工作区</span>
        </div>
        <nav className="workspace-views" aria-label="工作区视图">
          <button type="button" aria-pressed={view === 'editor'} onClick={() => setView('editor')}>
            画布编辑
          </button>
          <button
            type="button"
            aria-pressed={view === 'services'}
            onClick={() => setView('services')}
          >
            服务检查
          </button>
        </nav>
      </header>
      <div hidden={view !== 'editor'}>
        <Editor active={view === 'editor'} />
      </div>
      {view === 'services' && <DevelopmentStatus />}
    </div>
  );
}
