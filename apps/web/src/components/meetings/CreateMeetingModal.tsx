'use client';

import { useState } from 'react';
import { Form, Modal } from '@heroui/react';
import { createMeeting, type Meeting } from '@/lib/api';
import { NO_FORM_ERRORS, toFormErrorState } from '@/lib/formErrors';
import { parseParticipants } from '@/lib/meetings';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { TextInputField } from '@/components/ui/TextInputField';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onCreated: (meeting: Meeting) => void;
  onOpenChange: (isOpen: boolean) => void;
}

export function CreateMeetingModal({
  isOpen,
  onCreated,
  onOpenChange,
}: CreateMeetingModalProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [participants, setParticipants] = useState('');
  const [errors, setErrors] = useState(NO_FORM_ERRORS);
  const [isPending, setIsPending] = useState(false);

  const resetForm = () => {
    setTitle('');
    setDate('');
    setParticipants('');
    setErrors(NO_FORM_ERRORS);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  // Reached only once every field's `validate` passed: the form blocks its own submit
  // otherwise and focuses the first invalid field.
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors(NO_FORM_ERRORS);
    setIsPending(true);
    try {
      const meeting = await createMeeting(
        title.trim(),
        new Date(date).toISOString(),
        parseParticipants(participants),
      );
      onCreated(meeting);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setErrors(
        toFormErrorState(
          err,
          'Could not create the meeting. Please try again.',
        ),
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[440px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Create meeting</Modal.Heading>
          </Modal.Header>
          <Form
            onSubmit={(event) => void handleSubmit(event)}
            validationErrors={errors.fieldErrors}
          >
            <Modal.Body>
              <div className="flex flex-col gap-4">
                <TextInputField
                  isRequired
                  label="Title"
                  name="title"
                  onChange={setTitle}
                  placeholder="Weekly sync"
                  validate={(value) =>
                    value.trim() ? null : 'Title is required'
                  }
                  value={title}
                />

                <TextInputField
                  isRequired
                  label="Date"
                  name="date"
                  onChange={setDate}
                  type="datetime-local"
                  validate={(value) => (value ? null : 'Date is required')}
                  value={date}
                />

                <TextInputField
                  label="Participants"
                  name="participants"
                  onChange={setParticipants}
                  placeholder="alice@example.com, bob@example.com"
                  value={participants}
                />

                {errors.formError ? (
                  <ErrorText>{errors.formError}</ErrorText>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" type="button" variant="secondary">
                Cancel
              </Button>
              <Button isPending={isPending} type="submit">
                {isPending ? 'Creating…' : 'Create meeting'}
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
