'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import { ApiError, updateProfile, type Profile } from '@/lib/api';
import { ErrorText } from '@/components/ui/ErrorText';
import { SuccessText } from '@/components/ui/SuccessText';

interface DisplayNameSectionProps {
  name: string | null;
  /** Called with the API's response right after a successful save, so the caller can propagate it (e.g. to the header) without refetching. */
  onSaved: (profile: Profile) => void;
}

/**
 * Submitted independently of the password section on /profile/edit. Tracks its
 * own "last saved" baseline (separate from the `name` prop) so the Save button
 * disables itself again right after a successful save, without needing the
 * parent to refetch the profile.
 */
export function DisplayNameSection({ name, onSaved }: DisplayNameSectionProps) {
  const [value, setValue] = useState(name ?? '');
  const [savedValue, setSavedValue] = useState(name ?? '');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaved(false);
    setIsPending(true);
    try {
      const updated = await updateProfile(value.trim() ? value : null);
      setValue(updated.name ?? '');
      setSavedValue(updated.name ?? '');
      setIsSaved(true);
      onSaved(updated);
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
    <Card>
      <Card.Header>
        <Card.Title>Display name</Card.Title>
        <Card.Description>
          Shown across the app in place of your email.
        </Card.Description>
      </Card.Header>

      <Form onSubmit={(event) => void onSubmit(event)}>
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextField
              maxLength={100}
              name="name"
              onChange={(newValue) => {
                setValue(newValue);
                setIsSaved(false);
                setError(null);
              }}
              value={value}
            >
              <Label>Display name</Label>
              <Input
                autoComplete="name"
                className="h-11 md:h-10"
                placeholder="Jane Doe"
                variant="secondary"
              />
              <FieldError />
            </TextField>

            {error ? (
              <ErrorText>{error}</ErrorText>
            ) : isSaved ? (
              <SuccessText>Display name saved.</SuccessText>
            ) : null}
          </div>
        </Card.Content>

        <Card.Footer className="mt-2 justify-end">
          <Button
            isDisabled={value === savedValue}
            isPending={isPending}
            type="submit"
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </Card.Footer>
      </Form>
    </Card>
  );
}
