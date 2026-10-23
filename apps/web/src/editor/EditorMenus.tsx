import { EllipsisIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { SCENE_THEMES, type SceneThemeReference } from '@neobo/theme';
import { Button } from '../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

export interface EditorMenuActions {
  readonly selectionCount: number;
  readonly theme: SceneThemeReference;
  readonly onThemeChange: (theme: SceneThemeReference) => void;
  readonly canGroup: boolean;
  readonly canUngroup: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly singleVisible: boolean | undefined;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onDelete: () => void;
  readonly onToggleVisible: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

function EditorMenuItems({
  actions,
  context,
}: {
  readonly actions: EditorMenuActions;
  readonly context: boolean;
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Label = context ? ContextMenuLabel : DropdownMenuLabel;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  const Sub = context ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = context ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = context ? ContextMenuSubContent : DropdownMenuSubContent;
  const RadioGroup = context ? ContextMenuRadioGroup : DropdownMenuRadioGroup;
  const RadioItem = context ? ContextMenuRadioItem : DropdownMenuRadioItem;

  return (
    <>
      <Label>当前已选 {actions.selectionCount} 项</Label>
      <Item disabled={!actions.canGroup} onSelect={actions.onGroup}>
        组合
      </Item>
      <Item disabled={!actions.canUngroup} onSelect={actions.onUngroup}>
        拆组
      </Item>
      <Item disabled={actions.singleVisible === undefined} onSelect={actions.onToggleVisible}>
        {actions.singleVisible === undefined
          ? '隐藏 / 显示'
          : actions.singleVisible
            ? '隐藏'
            : '显示'}
      </Item>
      <Item
        variant="destructive"
        disabled={actions.selectionCount === 0}
        onSelect={actions.onDelete}
      >
        删除
      </Item>
      <Separator />
      <Sub>
        <SubTrigger>场景主题</SubTrigger>
        <SubContent aria-label="场景主题">
          <RadioGroup
            value={actions.theme.id}
            onValueChange={(value) => {
              const theme = SCENE_THEMES.find((entry) => entry.id === value);
              if (theme) actions.onThemeChange({ id: theme.id, version: theme.version });
            }}
          >
            {SCENE_THEMES.map((theme) => (
              <RadioItem key={theme.id} value={theme.id}>
                {theme.label}
              </RadioItem>
            ))}
          </RadioGroup>
        </SubContent>
      </Sub>
      <Separator />
      <Item disabled={!actions.canUndo} onSelect={actions.onUndo}>
        撤销
      </Item>
      <Item disabled={!actions.canRedo} onSelect={actions.onRedo}>
        重做
      </Item>
    </>
  );
}

interface EditorContextMenuProps {
  readonly label: string;
  readonly children: ReactElement;
  readonly actions: EditorMenuActions;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function EditorContextMenu({
  label,
  children,
  actions,
  disabled,
  open,
  onOpenChange,
}: EditorContextMenuProps) {
  return (
    <ContextMenu open={open} onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={label} collisionPadding={8}>
        <EditorMenuItems actions={actions} context />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function EditorActionsMenu({
  actions,
  disabled,
  open,
  onOpenChange,
}: Omit<EditorContextMenuProps, 'children' | 'label'>) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label="更多操作"
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent collisionPadding={8}>
        <EditorMenuItems actions={actions} context={false} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
