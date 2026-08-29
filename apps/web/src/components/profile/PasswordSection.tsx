'use client';

import { useState, type FormEvent } from 'react';
import { Card, Form } from '@heroui/react';
import { changePassword } from '@/lib/api';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import type { ProfileSaved } from '@/lib/queries/profile';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_HINT,
  validatePasswordLength,
} from '@/lib/validation';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { PasswordField } from '@/components/ui/PasswordField';
import { SuccessText } from '@/components/ui/SuccessText';

interface PasswordSectionProps {
  /**
   * The shared "saved, here is the result" callback (see `ProfileSaved`): the token the
   * API reissued, for the caller to keep the session alive without a re-login. This
   * section changes no profile field, so it never fills the `profile` half.
   */
  onSaved: (saved: ProfileSaved) => void;
}

/**
 * Submitted independently of the display-name section on /profile/edit. Every rule the API
 * enforces is checked client-side first — the minimum length, the confirmation match, and
 * "the new password must differ from the current one" (`isDifferentFromCurrent` in
 * `apps/api/src/auth/password-rules.ts`) — which is what lets the one remaining case be
 * attributed by status alone: with those ruled out, `PUT /users/me/password` answers 400 only
 * for a current password that does not match, so 400 maps to the `currentPassword` field
 * without anyone reading the message text.
 *
 * "Must differ" is checked against the two values the user typed, which the client cannot tell
 * apart from the stored one: type the same wrong string into both fields and it blames the new
 * password where the API would have said the current one is incorrect. That is deliberate —
 * letting the case through would put the API's "New password must be different…" on the
 * `currentPassword` field, since both answers share the 400 the map above pins to it.
 */
export function PasswordSection({ onSaved }: PasswordSectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errors, setErrors] = useState(NO_FORM_ERRORS);
  const [isSaved, setIsSaved] = useState(false);

  const clearFeedback = () => {
    setErrors(NO_FORM_ERRORS);
    setIsSaved(false);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    setIsPending(true);
    try {
      const { accessToken } = await changePassword(
        currentPassword,
        newPassword,
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsSaved(true);
      onSaved({ accessToken });
    } catch (err) {
      setErrors(
        toFormErrorState(err, 'Something went wrong. Please try again.', {
          400: 'currentPassword',
        }),
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>Password</Card.Title>
        <Card.Description>
          Change the password used to sign in.
        </Card.Description>
      </Card.Header>

      <Form
        onSubmit={(event) => void onSubmit(event)}
        validationErrors={errors.fieldErrors}
      >
        <Card.Content>
          <div className="flex flex-col gap-4">
            <PasswordField
              autoComplete="current-password"
              isRequired
              label="Current password"
              name="currentPassword"
              onChange={(value) => {
                setCurrentPassword(value);
                clearFeedback();
              }}
              validate={(value) =>
                value ? null : 'Current password is required'
              }
              value={currentPassword}
            />

            <PasswordField
              autoComplete="new-password"
              description={PASSWORD_LENGTH_HINT}
              isRequired
              label="New password"
              minLength={MIN_PASSWORD_LENGTH}
              name="newPassword"
              onChange={(value) => {
                setNewPassword(value);
                clearFeedback();
              }}
              validate={(value) => {
                const lengthError = validatePasswordLength(value);
                if (lengthError) return lengthError;
                return value === currentPassword
                  ? 'New password must be different from the current password'
                  : null;
              }}
              value={newPassword}
            />

            <PasswordField
              autoComplete="new-password"
              isRequired
              label="Confirm new password"
              name="confirmPassword"
              onChange={(value) => {
                setConfirmPassword(value);
                clearFeedback();
              }}
              validate={(value) =>
                value === newPassword ? null : 'Passwords do not match'
              }
              value={confirmPassword}
            />

            {errors.formError ? (
              <ErrorText>{errors.formError}</ErrorText>
            ) : isSaved ? (
              <SuccessText>Password changed.</SuccessText>
            ) : null}
          </div>
        </Card.Content>

        <Card.Footer className="mt-2 justify-end">
          <Button isPending={isPending} type="submit">
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </Card.Footer>
      </Form>
    </Card>
  );
}
