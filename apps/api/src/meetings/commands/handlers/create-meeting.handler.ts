import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Meeting } from '@prisma/client';
import { MeetingsRepository } from '../../meetings.repository';
import { CreateMeetingCommand } from '../create-meeting.command';

@CommandHandler(CreateMeetingCommand)
export class CreateMeetingHandler implements ICommandHandler<
  CreateMeetingCommand,
  Meeting
> {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  execute(command: CreateMeetingCommand): Promise<Meeting> {
    return this.meetingsRepository.create(
      command.ownerId,
      command.title,
      command.date,
      command.participants,
    );
  }
}
