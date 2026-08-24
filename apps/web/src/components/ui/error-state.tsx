'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <Alert variant="destructive" className="max-w-md">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        {message ? <AlertDescription>{message}</AlertDescription> : null}
        {onRetry ? (
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </Alert>
    </div>
  );
}

export function LlmBanner({ href = '/settings' }: { href?: string }) {
  return (
    <Alert className="mx-4 mt-2">
      <AlertTitle>LLM not configured</AlertTitle>
      <AlertDescription>
        Set a Base URL, model and API key in{' '}
        <a className="underline" href={href}>
          Settings
        </a>{' '}
        before generating.
      </AlertDescription>
    </Alert>
  );
}
