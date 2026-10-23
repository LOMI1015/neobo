import { useId, useState, type FormEvent } from 'react';
import type { SceneNode, SceneOperation } from '@neobo/scene';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { nodeTitle } from './selection';
import { ChartDataFields } from './ChartDataFields';
import { chartDataEqual, createChartDataDraft, parseChartDataDraft } from './chart-data';

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

function samePropertiesSource(current: SceneNode, next: SceneNode): boolean {
  if (current === next) return true;
  if (
    current.id !== next.id ||
    current.type !== next.type ||
    current.visible !== next.visible ||
    transformFields.some(([field]) => current.transform[field] !== next.transform[field])
  ) {
    return false;
  }
  if (current.type === 'text' && next.type === 'text') return current.text === next.text;
  if (current.type === 'bar-chart' && next.type === 'bar-chart') {
    return chartDataEqual(current.data, next.data);
  }
  if (current.type === 'group' && next.type === 'group') {
    return (
      current.children.length === next.children.length &&
      current.children.every((id, index) => id === next.children[index])
    );
  }
  return current.type === 'rectangle' && next.type === 'rectangle';
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const [source, setSource] = useState(() => ({ node: props.node, generation: 0 }));
  // 历史会复制节点；主题变更保留草稿，已提交节点值改变时才整体重置表单。
  if (!samePropertiesSource(source.node, props.node)) {
    setSource({ node: props.node, generation: source.generation + 1 });
  }
  return <PropertiesForm key={source.generation} {...props} />;
}

function PropertiesForm({ node, disabled, onApply }: PropertiesPanelProps) {
  const visibleId = useId();
  const [values, setValues] = useState(() => ({
    x: String(node.transform.x),
    y: String(node.transform.y),
    width: String(node.transform.width),
    height: String(node.transform.height),
    rotation: String(node.transform.rotation),
  }));
  const [text, setText] = useState(node.type === 'text' ? node.text : '');
  const [visible, setVisible] = useState(node.visible);
  const [dataRows, setDataRows] = useState(() =>
    createChartDataDraft(node.type === 'bar-chart' ? node.data : []),
  );
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
    const dataResult =
      node.type === 'bar-chart' ? parseChartDataDraft(dataRows, node.id) : undefined;
    if (dataResult && !dataResult.success) {
      setError(dataResult.message);
      return;
    }
    const data = dataResult?.data;
    const dataChanged =
      node.type === 'bar-chart' && data !== undefined && !chartDataEqual(data, node.data);
    setError('');
    if (!changed && !textChanged && !dataChanged && visible === node.visible) return;
    onApply({
      ...(changed ? { transform } : {}),
      ...(textChanged ? { text } : {}),
      ...(dataChanged && data ? { data } : {}),
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
              <Input
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
            <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} />
          </label>
        )}
        {node.type === 'bar-chart' && (
          <ChartDataFields rows={dataRows} disabled={disabled} onChange={setDataRows} />
        )}
        <div className="editor-checkbox">
          <Checkbox
            id={visibleId}
            checked={visible}
            disabled={disabled}
            onCheckedChange={(checked) => setVisible(checked === true)}
          />
          <label htmlFor={visibleId}>显示元素</label>
        </div>
        {error && (
          <p className="editor-field-error" role="alert">
            {error}
          </p>
        )}
        <Button className="editor-apply" type="submit">
          应用属性
        </Button>
      </fieldset>
    </form>
  );
}
