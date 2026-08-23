'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useApp } from './app-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PromptOptions {
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface NotifyOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

export interface Dialogs {
  prompt: (opts: PromptOptions) => Promise<string | null>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (opts: NotifyOptions) => Promise<void>;
}

type Pending =
  | ({ kind: 'prompt' } & PromptOptions)
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'notify' } & NotifyOptions);

const Ctx = createContext<Dialogs | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState('');
  const resolver = useRef<((v: any) => void) | null>(null);

  const settle = useCallback((value: unknown) => {
    resolver.current?.(value);
    resolver.current = null;
    setPending(null);
  }, []);

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setInput(opts.initial ?? '');
        setPending({ kind: 'prompt', ...opts });
      }),
    [],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPending({ kind: 'confirm', ...opts });
      }),
    [],
  );

  const notify = useCallback(
    (opts: NotifyOptions) =>
      new Promise<void>((resolve) => {
        resolver.current = resolve;
        setPending({ kind: 'notify', ...opts });
      }),
    [],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        settle(pending.kind === 'confirm' ? false : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  const submitPrompt = () => {
    const val = input.trim();
    settle(pending?.kind === 'prompt' && val ? val : null);
  };

  const value: Dialogs = { prompt, confirm, notify };

  return (
    <Ctx.Provider value={value}>
      {children}
      {pending &&
        pending.kind === 'prompt' &&
        createPortal(
          <DialogShell dismissible onDismiss={() => settle(null)}>
            <h3 className="font-serif text-lg font-semibold">{pending.title}</h3>
            {pending.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{pending.description}</p>
            ) : null}
            <div className="my-4">
              <Input
                autoFocus
                value={input}
                placeholder={pending.placeholder}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitPrompt();
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(null)}>
                {pending.cancelLabel ?? t('dialog.cancel')}
              </Button>
              <Button onClick={submitPrompt} disabled={pending.busy || !input.trim()}>
                {pending.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {pending.okLabel ?? t('dialog.ok')}
              </Button>
            </div>
          </DialogShell>,
          document.body,
        )}
      {pending &&
        pending.kind === 'confirm' &&
        createPortal(
          <DialogShell dismissible onDismiss={() => settle(false)}>
            <h3 className="font-serif text-lg font-semibold">{pending.title ?? t('dialog.confirmTitle')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{pending.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.cancelLabel ?? t('dialog.cancel')}
              </Button>
              <Button
                variant={pending.danger ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {pending.okLabel ?? t('dialog.confirm')}
              </Button>
            </div>
          </DialogShell>,
          document.body,
        )}
      {pending &&
        pending.kind === 'notify' &&
        createPortal(
          <DialogShell dismissible onDismiss={() => settle(undefined)}>
            <h3 className="font-serif text-lg font-semibold">{pending.title ?? t('dialog.notifyTitle')}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{pending.message}</p>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => settle(undefined)}>{pending.okLabel ?? t('dialog.ok')}</Button>
            </div>
          </DialogShell>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

function DialogShell({
  children,
  dismissible,
  onDismiss,
}: {
  children: React.ReactNode;
  dismissible?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border bg-card p-5 text-card-foreground shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogs must be used within DialogsProvider');
  return ctx;
}
