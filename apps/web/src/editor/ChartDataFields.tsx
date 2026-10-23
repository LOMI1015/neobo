import { useRef, useState } from 'react';
import { SCENE_LIMITS } from '@neobo/scene';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChartDataDraftRow } from './chart-data';

interface ChartDataFieldsProps {
  readonly rows: readonly ChartDataDraftRow[];
  readonly disabled: boolean;
  readonly onChange: (rows: ChartDataDraftRow[]) => void;
}

export function ChartDataFields({ rows, disabled, onChange }: ChartDataFieldsProps) {
  const [focusRowKey, setFocusRowKey] = useState<number | null>(null);
  const categories = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement | null>(null);

  function update(key: number, changes: Partial<Pick<ChartDataDraftRow, 'category' | 'value'>>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addRow() {
    if (disabled || rows.length >= SCENE_LIMITS.maxChartDataPoints) return;
    const key = rows.reduce((maximum, row) => Math.max(maximum, row.key), -1) + 1;
    setFocusRowKey(key);
    onChange([...rows, { key, category: '', value: '' }]);
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (disabled || !row) return;
    const target = rows[index + 1] ?? rows[index - 1];
    onChange(rows.filter((entry) => entry.key !== row.key));
    if (target) categories.current.get(target.key)?.focus();
    else addButton.current?.focus();
  }

  return (
    <div className="editor-chart-data">
      <div className="editor-chart-data-heading">
        <span>图表数据</span>
        <span>
          {rows.length} / {SCENE_LIMITS.maxChartDataPoints}
        </span>
      </div>
      {rows.length === 0 && <p className="editor-chart-data-empty">暂无数据</p>}
      <ol className="editor-chart-data-rows">
        {rows.map((row, index) => (
          <li key={row.key} className="editor-chart-data-row">
            <label>
              <span>分类 {index + 1}</span>
              <Input
                ref={(element) => {
                  if (element) categories.current.set(row.key, element);
                  else categories.current.delete(row.key);
                }}
                value={row.category}
                disabled={disabled}
                autoFocus={row.key === focusRowKey}
                onChange={(event) => update(row.key, { category: event.target.value })}
              />
            </label>
            <label>
              <span>数值 {index + 1}</span>
              <Input
                value={row.value}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => update(row.key, { value: event.target.value })}
              />
            </label>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled}
              aria-label={`删除数据行 ${index + 1}`}
              onClick={() => removeRow(index)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        ref={addButton}
        type="button"
        variant="outline"
        disabled={disabled || rows.length >= SCENE_LIMITS.maxChartDataPoints}
        onClick={addRow}
      >
        添加数据
      </Button>
    </div>
  );
}
