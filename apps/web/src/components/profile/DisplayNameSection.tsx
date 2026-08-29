'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, Form } from '@heroui/react';
import { updateProfile } from '@/lib/api';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import type { ProfileSaved } from '@/lib/queries/profile';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/validation';
import { ErrorText } from '@/components/ui/ErrorText';
import { SuccessText } from '@/components/ui/SuccessText';
import { TextInputField } from '@/components/ui/TextInputField';

interface DisplayNameSectionProps {
  name: string | null;
  /**
   * The shared "saved, here is the result" callback (see `ProfileSaved`): the display
   * name this section just wrote, for the caller to apply without refetching.
   */
  onSaved: (saved: ProfileSaved) => void;
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
  const [errors, setErrors] = useState(NO_FORM_ERRORS);
  const [isSaved, setIsSaved] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors(NO_FORM_ERRORS);
    setIsSaved(false);
    setIsPending(true);
    try {
      const updated = await updateProfile(value.trim() ? value : null);
      setValue(updated.name ?? '');
      setSavedValue(updated.name ?? '');
      setIsSaved(true);
      onSaved({ profile: { name: updated.name } });
    } catch (err) {
      setErrors(
        toFormErrorState(err, 'Something went wrong. Please try again.'),
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

      <Form
        onSubmit={(event) => void onSubmit(event)}
        validationErrors={errors.fieldErrors}
      >
        <Card.Content>
          <div className="flex flex-col gap-4">
            <TextInputField
              autoComplete="name"
              label="Display name"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              name="name"
              onChange={(newValue) => {
                setValue(newValue);
                setIsSaved(false);
                setErrors(NO_FORM_ERRORS);
              }}
              placeholder="Jane Doe"
              value={value}
            />

            {errors.formError ? (
              <ErrorText>{errors.formError}</ErrorText>
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
