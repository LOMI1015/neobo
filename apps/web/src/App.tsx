import { useRef, useState } from 'react';
import { ScenePlayer } from '@neobo/player';
import type { SceneDocument } from '@neobo/scene';
import { Button } from '@/components/ui/button';
import { DevelopmentStatus } from './DevelopmentStatus';
import { Editor } from './editor/Editor';

export function App() {
  const [view, setView] = useState<'editor' | 'services' | 'preview'>('editor');
  const [previewSnapshot, setPreviewSnapshot] = useState<SceneDocument | null>(null);
  const editorEntry = useRef<HTMLButtonElement>(null);

  function changeView(nextView: 'editor' | 'services') {
    setPreviewSnapshot(null);
    setView(nextView);
  }

  function preview(document: SceneDocument) {
    setPreviewSnapshot(document);
    setView('preview');
  }

  function returnToEditor() {
    changeView('editor');
    editorEntry.current?.focus();
  }

  return (
    <div
      className={
        view === 'preview' ? 'application-shell application-shell--preview' : 'application-shell'
      }
    >
      <header className="application-header">
        <div className="application-brand">
          <span className="wordmark">neobo</span>
          <span className="environment-label">本地工作区</span>
        </div>
        <nav className="workspace-views" aria-label="工作区视图">
          <Button
            ref={editorEntry}
            type="button"
            variant={view === 'editor' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'editor'}
            onClick={() => changeView('editor')}
          >
            画布编辑
          </Button>
          <Button
            type="button"
            variant={view === 'services' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'services'}
            onClick={() => changeView('services')}
          >
            服务检查
          </Button>
        </nav>
      </header>
      <div hidden={view !== 'editor'}>
        <Editor active={view === 'editor'} onPreview={preview} />
      </div>
      {view === 'services' && <DevelopmentStatus />}
      {view === 'preview' && previewSnapshot && (
        <main className="scene-preview" aria-label="场景预览">
          <div className="scene-preview-toolbar">
            <h1>预览</h1>
            <Button type="button" variant="outline" autoFocus onClick={returnToEditor}>
              返回编辑
            </Button>
          </div>
          <div className="scene-preview-stage">
            <div
              className="scene-preview-canvas"
              style={{
                width: `min(100cqw, calc(100cqh * ${previewSnapshot.canvas.width / previewSnapshot.canvas.height}))`,
              }}
            >
              <ScenePlayer document={previewSnapshot} label="场景预览画布" />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
