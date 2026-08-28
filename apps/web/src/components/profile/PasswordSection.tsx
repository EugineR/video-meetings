'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  Description,
  FieldError,
  Form,
  InputGroup,
  Label,
  TextField,
} from '@heroui/react';
import { ApiError, changePassword } from '@/lib/api';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

const MIN_PASSWORD_LENGTH = 8;

interface PasswordSectionProps {
  /** Called with the freshly issued token right after a successful change, so the caller can keep the session alive without a re-login. */
  onChanged: (accessToken: string) => void;
}

/**
 * Submitted independently of the display-name section on /profile/edit. Client-side
 * match and minimum-length checks block the request before it's sent; a wrong current
 * password comes back from the API as a field error rather than a form-level one.
 */
export function PasswordSection({ onChanged }: PasswordSectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCurrentVisible, setIsCurrentVisible] = useState(false);
  const [isNewVisible, setIsNewVisible] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [isSaved, setIsSaved] = useState(false);

  const clearFeedback = () => {
    setError(null);
    setCurrentPasswordError(null);
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
      onChanged(accessToken);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        /current password is incorrect/i.test(err.message)
      ) {
        setCurrentPasswordError(err.message);
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Something went wrong. Please try again.',
        );
      }
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
        validationErrors={
          currentPasswordError ? { currentPassword: currentPasswordError } : {}
        }
      >
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextField
              isRequired
              name="currentPassword"
              onChange={(value) => {
                setCurrentPassword(value);
                clearFeedback();
              }}
              type="password"
              validate={(value) =>
                value ? null : 'Current password is required'
              }
              value={currentPassword}
            >
              <Label>Current password</Label>
              <InputGroup className="h-11 md:h-10" variant="secondary">
                <InputGroup.Input
                  autoComplete="current-password"
                  placeholder="••••••••"
                  type={isCurrentVisible ? 'text' : 'password'}
                />
                <InputGroup.Suffix className="px-1">
                  <Button
                    aria-label={
                      isCurrentVisible
                        ? 'Hide current password'
                        : 'Show current password'
                    }
                    isIconOnly
                    onPress={() => setIsCurrentVisible((v) => !v)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isCurrentVisible ? (
                      <EyeOffIcon className="size-5" />
                    ) : (
                      <EyeIcon className="size-5" />
                    )}
                  </Button>
                </InputGroup.Suffix>
              </InputGroup>
              <FieldError />
            </TextField>

            <TextField
              isRequired
              minLength={MIN_PASSWORD_LENGTH}
              name="newPassword"
              onChange={(value) => {
                setNewPassword(value);
                clearFeedback();
              }}
              type="password"
              validate={(value) =>
                value.length >= MIN_PASSWORD_LENGTH
                  ? null
                  : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
              }
              value={newPassword}
            >
              <Label>New password</Label>
              <InputGroup className="h-11 md:h-10" variant="secondary">
                <InputGroup.Input
                  autoComplete="new-password"
                  placeholder="••••••••"
                  type={isNewVisible ? 'text' : 'password'}
                />
                <InputGroup.Suffix className="px-1">
                  <Button
                    aria-label={
                      isNewVisible ? 'Hide new password' : 'Show new password'
                    }
                    isIconOnly
                    onPress={() => setIsNewVisible((v) => !v)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isNewVisible ? (
                      <EyeOffIcon className="size-5" />
                    ) : (
                      <EyeIcon className="size-5" />
                    )}
                  </Button>
                </InputGroup.Suffix>
              </InputGroup>
              <Description>
                Must be at least {MIN_PASSWORD_LENGTH} characters.
              </Description>
              <FieldError />
            </TextField>

            <TextField
              isRequired
              name="confirmPassword"
              onChange={(value) => {
                setConfirmPassword(value);
                clearFeedback();
              }}
              type="password"
              validate={(value) =>
                value === newPassword ? null : 'Passwords do not match'
              }
              value={confirmPassword}
            >
              <Label>Confirm new password</Label>
              <InputGroup className="h-11 md:h-10" variant="secondary">
                <InputGroup.Input
                  autoComplete="new-password"
                  placeholder="••••••••"
                  type={isConfirmVisible ? 'text' : 'password'}
                />
                <InputGroup.Suffix className="px-1">
                  <Button
                    aria-label={
                      isConfirmVisible
                        ? 'Hide confirmed password'
                        : 'Show confirmed password'
                    }
                    isIconOnly
                    onPress={() => setIsConfirmVisible((v) => !v)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isConfirmVisible ? (
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
            ) : isSaved ? (
              <p className="text-sm text-success" role="status">
                Password changed.
              </p>
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
