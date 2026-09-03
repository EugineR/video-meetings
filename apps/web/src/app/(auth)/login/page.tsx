'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Form, Link } from '@heroui/react';
import { loginUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import { useResetQueryCache } from '@/lib/queries/session';
import { validateEmail } from '@/lib/validation';
import { EnvelopeIcon, LockClosedIcon, LogInIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
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

  const switchPrompt = (
    <p>
      New to Video Meetings?{' '}
      <Link className="font-semibold text-foreground" href="/register">
        Create account
      </Link>
    </p>
  );

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-between gap-8 lg:gap-10">
      <div className="hidden w-full justify-end text-xs text-muted lg:flex">
        {switchPrompt}
      </div>

      <div className="flex w-full max-w-[430px] flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <h2 className="font-head text-3xl font-semibold text-foreground lg:text-4xl">
            Welcome back
          </h2>
          <p className="text-[13px] leading-[1.4] text-muted">
            Sign in to continue to your meeting workspace.
          </p>
        </div>

        <Form
          onSubmit={(event) => void onSubmit(event)}
          validationErrors={errors.fieldErrors}
        >
          <div className="flex flex-col gap-3.5">
            <TextInputField
              autoComplete="email"
              icon={<EnvelopeIcon className="size-4" />}
              isRequired
              label="Email address"
              name="email"
              onChange={(value) => {
                setEmail(value);
                clearErrors();
              }}
              placeholder="you@company.com"
              type="email"
              validate={validateEmail}
              value={email}
            />

            <PasswordField
              autoComplete="current-password"
              icon={<LockClosedIcon className="size-4" />}
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

            <Button className="w-full" isPending={isPending} type="submit">
              {isPending ? (
                'Signing in…'
              ) : (
                <>
                  <LogInIcon className="size-4" />
                  Sign in
                </>
              )}
            </Button>
          </div>
        </Form>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="text-xs text-muted lg:hidden">{switchPrompt}</div>
        <p className="font-mono text-9 tracking-[0.04em] text-muted">
          © {new Date().getFullYear()} Video Meetings · Privacy · Terms
        </p>
      </div>
    </div>
  );
}
