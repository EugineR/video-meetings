'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Form, Link } from '@heroui/react';
import { registerUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import { useResetQueryCache } from '@/lib/queries/session';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_HINT,
  validateEmail,
  validatePasswordLength,
} from '@/lib/validation';
import { ErrorText } from '@/components/ui/ErrorText';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextInputField } from '@/components/ui/TextInputField';

export default function RegisterPage() {
  const router = useRouter();
  const resetQueryCache = useResetQueryCache();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errors, setErrors] = useState(NO_FORM_ERRORS);

  // Every form on the convention drops its API errors on the next keystroke. On a field-level
  // one it is not cosmetic: HeroUI's `Form` validates natively, so a message sitting on the
  // email field also sets that input's `customError` and blocks resubmission until it clears.
  const clearErrors = () => setErrors(NO_FORM_ERRORS);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors(NO_FORM_ERRORS);
    setIsPending(true);
    try {
      const { accessToken } = await registerUser(email, password);
      storeAccessToken(accessToken);
      // A new session starts here: drop anything the previous one left cached,
      // including the "no valid token" answer that would bounce us back to /login.
      resetQueryCache();
      router.push('/');
    } catch (err) {
      // A duplicate email comes back as a 409, which is unambiguously about the email field.
      setErrors(
        toFormErrorState(err, 'Something went wrong. Please try again.', {
          409: 'email',
        }),
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
              autoComplete="new-password"
              description={PASSWORD_LENGTH_HINT}
              isRequired
              label="Password"
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              onChange={(value) => {
                setPassword(value);
                clearErrors();
              }}
              validate={validatePasswordLength}
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
