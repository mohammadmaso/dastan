'use client';

import { Copy, Download, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Branch } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { Button } from '@/components/ui/button';

interface Props {
  storyId: string;
  branches: Branch[];
  activeBranchId: string;
  onSwitch: (branch: Branch) => void;
  onChanged: () => Promise<void>;
}

export function BranchSelect({ storyId, branches, activeBranchId, onSwitch, onChanged }: Props) {
  const { t } = useApp();
  const dialogs = useDialogs();
  const active = branches.find((b) => b.id === activeBranchId) ?? null;

  async function reload() {
    await onChanged();
  }

  async function newBranch() {
    const name = await dialogs.prompt({
      title: t('ws.newBranch'),
      initial: t('bm.whatIf'),
      okLabel: t('bm.new'),
    });
    if (!name) return;
    const created = await api.createBranch(storyId, {
      name,
      parentBranchId: active?.id,
    });
    await reload();
    const list = await api.listBranches(storyId);
    const fresh = list.find((b) => b.id === created.id);
    if (fresh) onSwitch(fresh);
  }

  async function rename() {
    if (!active) return;
    const name = await dialogs.prompt({
      title: t('bm.rename'),
      initial: active.name,
      okLabel: t('bm.rename'),
    });
    if (!name || name === active.name) return;
    await api.updateBranch(active.id, { name });
    await reload();
  }

  async function duplicate() {
    if (!active) return;
    await api.duplicateBranch(active.id);
    await reload();
  }

  async function remove() {
    if (!active) return;
    if (branches.length <= 1) {
      await dialogs.notify({ message: t('bm.switchFirst') });
      return;
    }
    const ok = await dialogs.confirm({
      title: t('bm.delete'),
      message: t('bm.confirm.delete', { name: active.name }),
      okLabel: t('bm.delete'),
      danger: true,
    });
    if (!ok) return;
    await api.deleteBranch(active.id);
    await reload();
  }

  return (
    <div className="flex items-center gap-1">
      <GitBranch className="h-4 w-4 text-muted-foreground" />
      <select
        className="h-8 max-w-[180px] rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none"
        value={activeBranchId}
        onChange={(e) => {
          const b = branches.find((x) => x.id === e.target.value);
          if (b) onSwitch(b);
        }}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('bm.new')} onClick={newBranch}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('bm.rename')} onClick={rename}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('bm.duplicate')} onClick={duplicate}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" title={t('bm.delete')} onClick={remove}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
      {active ? (
        <a href={api.exportBranch(active.id)} target="_blank" rel="noreferrer">
          <Button size="icon" variant="ghost" className="h-7 w-7" title={t('bm.export')}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </a>
      ) : null}
    </div>
  );
}
