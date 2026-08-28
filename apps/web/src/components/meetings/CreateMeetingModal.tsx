'use client';

import { useState } from 'react';
import { Button, Form, Input, Label, Modal } from '@heroui/react';
import { ApiError, createMeeting, type Meeting } from '@/lib/api';
import { parseParticipants } from '@/lib/meetings';

interface CreateMeetingModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreated: (meeting: Meeting) => void;
}

export function CreateMeetingModal({
  isOpen,
  onOpenChange,
  onCreated,
}: CreateMeetingModalProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [participants, setParticipants] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const resetForm = () => {
    setTitle('');
    setDate('');
    setParticipants('');
    setTitleError(null);
    setDateError(null);
    setError(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const isTitleMissing = trimmedTitle.length === 0;
    const isDateMissing = date.length === 0;

    setTitleError(isTitleMissing ? 'Title is required' : null);
    setDateError(isDateMissing ? 'Date is required' : null);

    if (isTitleMissing || isDateMissing) {
      return;
    }

    setError(null);
    setIsPending(true);
    try {
      const meeting = await createMeeting(
        trimmedTitle,
        new Date(date).toISOString(),
        parseParticipants(participants),
      );
      onCreated(meeting);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the meeting. Please try again.',
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
          <Form onSubmit={(event) => void handleSubmit(event)}>
            <Modal.Body>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-meeting-title">Title</Label>
                  <Input
                    className="h-11 md:h-10"
                    id="create-meeting-title"
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Weekly sync"
                    value={title}
                    variant="secondary"
                  />
                  {titleError ? (
                    <p className="text-sm text-danger" role="alert">
                      {titleError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-meeting-date">Date</Label>
                  <Input
                    className="h-11 md:h-10"
                    id="create-meeting-date"
                    onChange={(event) => setDate(event.target.value)}
                    type="datetime-local"
                    value={date}
                    variant="secondary"
                  />
                  {dateError ? (
                    <p className="text-sm text-danger" role="alert">
                      {dateError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="create-meeting-participants">
                    Participants
                  </Label>
                  <Input
                    className="h-11 md:h-10"
                    id="create-meeting-participants"
                    onChange={(event) => setParticipants(event.target.value)}
                    placeholder="alice@example.com, bob@example.com"
                    value={participants}
                    variant="secondary"
                  />
                </div>

                {error ? (
                  <p className="text-sm text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" type="button" variant="secondary">
                Cancel
              </Button>
              <Button isPending={isPending} type="submit">
                Create meeting
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
