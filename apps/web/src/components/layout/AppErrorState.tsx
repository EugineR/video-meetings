'use client';

import { useEffect } from 'react';
import { Card } from '@heroui/react';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';

interface AppErrorStateProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Shared body of every `error.tsx` under `(app)`: an unhandled render error inside a
 * page shows a recoverable state (inside whichever shell wraps it, so the header/sidebar
 * stays usable) rather than the dev overlay or a blank production page. `reset()`
 * re-renders the segment, which retries whatever failed.
 *
 * Both `(dashboard)` and `(workspace)` render this from their own `error.tsx` — a route
 * group's `error.tsx` only catches errors in its *children*, not in its own `layout.tsx`,
 * so each shell needs the boundary one level below itself to keep its chrome mounted
 * during the error the same way a single `(app)/error.tsx` did before the shells split.
 */
export function AppErrorState({ error, reset }: AppErrorStateProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <Card.Header>
        <Card.Title render={(props) => <h2 {...props} />}>
          Something went wrong
        </Card.Title>
        <Card.Description>
          This page could not be displayed. You can try again.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <ErrorText>{error.message || 'Unexpected error.'}</ErrorText>
      </Card.Content>
      <Card.Footer>
        <Button onPress={reset}>Try again</Button>
      </Card.Footer>
    </Card>
  );
}
