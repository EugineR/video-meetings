'use client';

import { useEffect } from 'react';
import { Button, Card } from '@heroui/react';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the authenticated route group: an unhandled render error inside
 * a page shows a recoverable state (inside the shell, so the header stays usable)
 * rather than the dev overlay or a blank production page. `reset()` re-renders the
 * segment, which retries whatever failed.
 */
export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <Card.Header>
        <Card.Title>Something went wrong</Card.Title>
        <Card.Description>
          This page could not be displayed. You can try again.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <p className="text-sm text-danger" role="alert">
          {error.message || 'Unexpected error.'}
        </p>
      </Card.Content>
      <Card.Footer>
        <Button className="h-11 md:h-10" onPress={reset}>
          Try again
        </Button>
      </Card.Footer>
    </Card>
  );
}
