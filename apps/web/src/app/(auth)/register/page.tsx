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
import { EMAIL_PATTERN } from '@/lib/validation';
import { EyeIcon, EyeOffIcon } from '@/components/icons';
import { ErrorText } from '@/components/ui/ErrorText';

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
    <Card className="w-full">
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

            {error ? <ErrorText>{error}</ErrorText> : null}
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
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </Card.Footer>
      </Form>
    </Card>
  );
}
