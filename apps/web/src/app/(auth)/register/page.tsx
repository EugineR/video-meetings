'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Checkbox, Form, Link } from '@heroui/react';
import { registerUser } from '@/lib/api';
import { storeAccessToken } from '@/lib/auth';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import { useResetQueryCache } from '@/lib/queries/session';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_HINT,
  validateEmail,
  validatePasswordLength,
} from '@/lib/validation';
import {
  ArrowRightIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextInputField } from '@/components/ui/TextInputField';

function validateName(value: string): string | null {
  return value.trim() ? null : 'Full name is required';
}

export default function RegisterPage() {
  const router = useRouter();
  const resetQueryCache = useResetQueryCache();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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
      const { accessToken } = await registerUser(name, email, password);
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

  const switchPrompt = (
    <p>
      Already have an account?{' '}
      <Link className="font-semibold text-foreground" href="/login">
        Sign in
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
          <h2 className="font-head text-28 font-semibold text-foreground lg:text-4xl">
            Create your account
          </h2>
          <p className="text-[13px] leading-[1.4] text-muted">
            Start organizing every meeting in one focused workspace.
          </p>
        </div>

        <Form
          onSubmit={(event) => void onSubmit(event)}
          validationErrors={errors.fieldErrors}
        >
          <div className="flex flex-col gap-3.5">
            <TextInputField
              autoComplete="name"
              icon={<UserIcon className="size-4" />}
              isRequired
              label="Full name"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              name="name"
              onChange={(value) => {
                setName(value);
                clearErrors();
              }}
              placeholder="Eugene Morgan"
              validate={validateName}
              value={name}
            />

            <TextInputField
              autoComplete="email"
              icon={<EnvelopeIcon className="size-4" />}
              isRequired
              label="Work email"
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
              autoComplete="new-password"
              description={PASSWORD_LENGTH_HINT}
              icon={<LockClosedIcon className="size-4" />}
              isRequired
              label="Password"
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              onChange={(value) => {
                setPassword(value);
                clearErrors();
              }}
              placeholder="At least 8 characters"
              validate={validatePasswordLength}
              value={password}
            />

            <PasswordField
              autoComplete="new-password"
              icon={<LockClosedIcon className="size-4" />}
              isRequired
              label="Confirm password"
              name="confirmPassword"
              onChange={(value) => {
                setConfirmPassword(value);
                clearErrors();
              }}
              placeholder="Repeat your password"
              validate={(value) =>
                value === password ? null : 'Passwords do not match'
              }
              value={confirmPassword}
            />

            <Checkbox isSelected={agreedToTerms} onChange={setAgreedToTerms}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="text-[11px] font-normal text-foreground">
                  I agree to the Terms of Service and Privacy Policy.
                </span>
              </Checkbox.Content>
            </Checkbox>

            {errors.formError ? (
              <ErrorText>{errors.formError}</ErrorText>
            ) : null}

            <Button
              className="w-full"
              isDisabled={!agreedToTerms}
              isPending={isPending}
              type="submit"
            >
              {isPending ? (
                'Creating account…'
              ) : (
                <>
                  <ArrowRightIcon className="size-4" />
                  Create account
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted">
              <ShieldCheckIcon className="size-3.5" />
              <span>Your workspace is private and encrypted.</span>
            </div>
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
