'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/lib/app-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmOpts {
  title?: string;
  message: string;
  okLabel?: string;
  danger?: boolean;
}
interface PromptOpts {
  title: string;
  placeholder?: string;
  initial?: string;
  okLabel?: string;
}

interface Dialogs {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  notify: (opts: { message: string }) => void;
}

const Ctx = createContext<Dialogs | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }) {
  const { t } = useApp();
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve }));
  }, []);

  const prompt = useCallback((opts: PromptOpts) => {
    setPromptValue(opts.initial ?? '');
    return new Promise<string | null>((resolve) => setPromptState({ ...opts, resolve }));
  }, []);

  const notify = useCallback((opts: { message: string }) => {
    toast(opts.message);
  }, []);

  return (
    <Ctx.Provider value={{ confirm, prompt, notify }}>
      {children}
      <AlertDialog open={!!confirmState} onOpenChange={(o) => !o && confirmState?.resolve(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title ?? t('dialog.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { confirmState?.resolve(false); setConfirmState(null); }}>
              {t('dialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={confirmState?.danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={() => { confirmState?.resolve(true); setConfirmState(null); }}
            >
              {confirmState?.okLabel ?? t('dialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!promptState} onOpenChange={(o) => { if (!o) { promptState?.resolve(null); setPromptState(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{promptState?.title}</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            value={promptValue}
            placeholder={promptState?.placeholder}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                promptState?.resolve(promptValue.trim() || null);
                setPromptState(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { promptState?.resolve(null); setPromptState(null); }}>
              {t('dialog.cancel')}
            </Button>
            <Button
              onClick={() => {
                promptState?.resolve(promptValue.trim() || null);
                setPromptState(null);
              }}
            >
              {promptState?.okLabel ?? t('dialog.ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogs must be used within DialogsProvider');
  return ctx;
}
