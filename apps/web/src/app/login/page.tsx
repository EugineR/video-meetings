'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  InputGroup,
  Label,
  Link,
  TextField,
} from '@heroui/react';
import { ApiError, loginUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';
import { EyeIcon, EyeOffIcon } from '@/components/icons';
import { AppHeader } from '@/components/layout/AppHeader';

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export default function LoginPage() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setIsPending(true);
    try {
      const { accessToken } = await loginUser(email, password);
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
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      <AppHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <Card.Header>
            <Card.Title>Welcome back</Card.Title>
            <Card.Description>
              Enter your email and password to sign in.
            </Card.Description>
          </Card.Header>

          <Form onSubmit={(event) => void onSubmit(event)}>
            <Card.Content>
              <div className="flex flex-col gap-4">
                <TextField
                  isRequired
                  name="email"
                  type="email"
                  validate={(value) => {
                    if (!value) return 'Email is required';
                    return EMAIL_PATTERN.test(value)
                      ? null
                      : 'Please enter a valid email address';
                  }}
                >
                  <Label>Email</Label>
                  <Input
                    autoComplete="email"
                    className="h-11 md:h-10"
                    placeholder="you@example.com"
                    variant="secondary"
                  />
                  <FieldError />
                </TextField>

                <TextField
                  isRequired
                  name="password"
                  type="password"
                  validate={(value) => (value ? null : 'Password is required')}
                >
                  <Label>Password</Label>
                  <InputGroup className="h-11 md:h-10" variant="secondary">
                    <InputGroup.Input
                      autoComplete="current-password"
                      placeholder="••••••••"
                      type={isPasswordVisible ? 'text' : 'password'}
                    />
                    <InputGroup.Suffix className="px-1">
                      <Button
                        aria-label={
                          isPasswordVisible ? 'Hide password' : 'Show password'
                        }
                        isIconOnly
                        onPress={() => setIsPasswordVisible((v) => !v)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {isPasswordVisible ? (
                          <EyeOffIcon className="size-5" />
                        ) : (
                          <EyeIcon className="size-5" />
                        )}
                      </Button>
                    </InputGroup.Suffix>
                  </InputGroup>
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
              <Button
                className="w-full"
                isPending={isPending}
                size="lg"
                type="submit"
              >
                {isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-center text-sm text-muted">
                Don&apos;t have an account?{' '}
                <Link href="/register">Create one</Link>
              </p>
            </Card.Footer>
          </Form>
        </Card>
      </div>
    </div>
  );
}
