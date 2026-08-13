'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Link,
  TextField,
} from '@heroui/react';
import { ApiError, registerUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export default function RegisterPage() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setIsPending(true);
    try {
      const { accessToken } = await registerUser(email, password);
      storeAccessToken(accessToken);
      router.push('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-accent/10 via-background to-background px-4 py-12">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Create your account</Card.Title>
          <Card.Description>
            Enter your email and a password to get started.
          </Card.Description>
        </Card.Header>

        <Form onSubmit={(event) => void onSubmit(event)}>
          <Card.Content>
            <div className="flex flex-col gap-4">
              <TextField
                isRequired
                name="email"
                type="email"
                validate={(value) =>
                  EMAIL_PATTERN.test(value)
                    ? null
                    : 'Please enter a valid email address'
                }
              >
                <Label>Email</Label>
                <Input
                  autoComplete="email"
                  placeholder="you@example.com"
                  variant="secondary"
                />
                <FieldError />
              </TextField>

              <TextField
                isRequired
                minLength={8}
                name="password"
                type="password"
                validate={(value) =>
                  value.length >= 8
                    ? null
                    : 'Password must be at least 8 characters'
                }
              >
                <Label>Password</Label>
                <Input
                  autoComplete="new-password"
                  placeholder="••••••••"
                  variant="secondary"
                />
                <Description>Must be at least 8 characters.</Description>
                <FieldError />
              </TextField>

              {error ? (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </Card.Content>

          <Card.Footer className="mt-2 flex flex-col gap-3">
            <Button className="w-full" isPending={isPending} type="submit">
              {isPending ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-sm text-muted">
              Already have an account? <Link href="/">Back to home</Link>
            </p>
          </Card.Footer>
        </Form>
      </Card>
    </div>
  );
}
