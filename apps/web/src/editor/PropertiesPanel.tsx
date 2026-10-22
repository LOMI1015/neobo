import { useState, type FormEvent } from 'react';
import type { SceneNode, SceneOperation } from '@neobo/scene';
import { nodeTitle } from './selection';

export type NodeChanges = Extract<SceneOperation, { type: 'node.update' }>['changes'];

interface PropertiesPanelProps {
  readonly node: SceneNode;
  readonly disabled: boolean;
  readonly onApply: (changes: NodeChanges) => void;
}

const transformFields = [
  ['x', 'X 坐标'],
  ['y', 'Y 坐标'],
  ['width', '宽度'],
  ['height', '高度'],
  ['rotation', '旋转角度'],
] as const;

export function PropertiesPanel({ node, disabled, onApply }: PropertiesPanelProps) {
  const [values, setValues] = useState(() => ({
    x: String(node.transform.x),
    y: String(node.transform.y),
    width: String(node.transform.width),
    height: String(node.transform.height),
    rotation: String(node.transform.rotation),
  }));
  const [text, setText] = useState(node.type === 'text' ? node.text : '');
  const [visible, setVisible] = useState(node.visible);
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    for (const [field, label] of transformFields) {
      if (values[field].trim() === '' || !Number.isFinite(Number(values[field]))) {
        setError(`${label}需要填写有限数字。`);
        return;
      }
    }
    const transform = {
      x: Number(values.x),
      y: Number(values.y),
      width: Number(values.width),
      height: Number(values.height),
      rotation: Number(values.rotation),
    };
    if (transform.width <= 0 || transform.height <= 0) {
      setError('宽度和高度必须大于 0。');
      return;
    }
    const changed = transformFields.some(([field]) => transform[field] !== node.transform[field]);
    const textChanged = node.type === 'text' && text !== node.text;
    setError('');
    if (!changed && !textChanged && visible === node.visible) return;
    onApply({
      ...(changed ? { transform } : {}),
      ...(textChanged ? { text } : {}),
      ...(visible !== node.visible ? { visible } : {}),
    });
  }

  return (
    <form className="editor-properties" onSubmit={submit}>
      <div className="editor-node-heading">
        <strong>{nodeTitle(node)}</strong>
        <span>{node.id}</span>
      </div>
      <fieldset disabled={disabled}>
        <legend>元素属性</legend>
        <div className="editor-field-grid">
          {transformFields.map(([field, label]) => (
            <label key={field} className={field === 'rotation' ? 'editor-field-wide' : ''}>
              <span>
                {label}
                {field === 'rotation' ? '（°）' : ''}
              </span>
              <input
                name={field}
                inputMode="decimal"
                value={values[field]}
                onChange={(event) => {
                  setValues({ ...values, [field]: event.target.value });
                }}
              />
            </label>
          ))}
        </div>
        {node.type === 'text' && (
          <label className="editor-text-field">
            <span>文字内容</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} />
          </label>
        )}
        <label className="editor-checkbox">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          <span>显示元素</span>
        </label>
        <p className="editor-help">坐标相对于父级。修改后点击应用，一次提交可整体撤销。</p>
        {node.type === 'group' && (
          <p className="editor-help">组合宽高定义边界和旋转中心，不缩放子元素。</p>
        )}
        {error && (
          <p className="editor-field-error" role="alert">
            {error}
          </p>
        )}
        <button className="editor-apply" type="submit">
          应用属性
        </button>
      </fieldset>
    </form>
  );
}
