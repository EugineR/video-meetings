'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Form, Link } from '@heroui/react';
import { loginUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import { useResetQueryCache } from '@/lib/queries/session';
import { validateEmail } from '@/lib/validation';
import { ErrorText } from '@/components/ui/ErrorText';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextInputField } from '@/components/ui/TextInputField';

export default function LoginPage() {
  const router = useRouter();
  const resetQueryCache = useResetQueryCache();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errors, setErrors] = useState(NO_FORM_ERRORS);

  // Same as everywhere else on the convention: editing a field drops the previous attempt's
  // API error rather than leaving a stale "Invalid credentials" under a corrected password.
  const clearErrors = () => setErrors(NO_FORM_ERRORS);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors(NO_FORM_ERRORS);
    setIsPending(true);
    try {
      const { accessToken } = await loginUser(email, password);
      storeAccessToken(accessToken);
      // A new session starts here: drop anything the previous one left cached,
      // including the "no valid token" answer that would bounce us back to /login.
      resetQueryCache();
      router.push('/');
    } catch (err) {
      // No field mapping: the API answers wrong credentials with one 401 and one message
      // regardless of which of the two was wrong, and guessing a field here would be a lie.
      setErrors(
        toFormErrorState(err, 'Something went wrong. Please try again.'),
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="w-full">
      <Card.Header>
        <Card.Title>Welcome back</Card.Title>
        <Card.Description>
          Enter your email and password to sign in.
        </Card.Description>
      </Card.Header>

      <Form
        onSubmit={(event) => void onSubmit(event)}
        validationErrors={errors.fieldErrors}
      >
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextInputField
              autoComplete="email"
              isRequired
              label="Email"
              name="email"
              onChange={(value) => {
                setEmail(value);
                clearErrors();
              }}
              placeholder="you@example.com"
              type="email"
              validate={validateEmail}
              value={email}
            />

            <PasswordField
              autoComplete="current-password"
              isRequired
              label="Password"
              name="password"
              onChange={(value) => {
                setPassword(value);
                clearErrors();
              }}
              validate={(value) => (value ? null : 'Password is required')}
              value={password}
            />

            {errors.formError ? (
              <ErrorText>{errors.formError}</ErrorText>
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
            Don&apos;t have an account? <Link href="/register">Create one</Link>
          </p>
        </Card.Footer>
      </Form>
    </Card>
  );
}
