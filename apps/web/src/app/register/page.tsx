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
  InputGroup,
  Label,
  Link,
  TextField,
} from '@heroui/react';
import { ApiError, registerUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function EyeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M2.25 12s3.75-7.5 9.75-7.5 9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2.25 2.25 0 0 0 3.164 3.163" />
      <path d="M6.53 6.573C4.243 8.02 2.25 12 2.25 12s3.75 7.5 9.75 7.5c1.876 0 3.487-.542 4.847-1.31M9.88 4.663A9.7 9.7 0 0 1 12 4.5c6 0 9.75 7.5 9.75 7.5-.55 1.09-1.334 2.31-2.325 3.44" />
    </svg>
  );
}

export default function RegisterPage() {
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
                <InputGroup className="h-11 md:h-10" variant="secondary">
                  <InputGroup.Input
                    autoComplete="new-password"
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
            <Button
              className="w-full"
              isPending={isPending}
              size="lg"
              type="submit"
            >
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
