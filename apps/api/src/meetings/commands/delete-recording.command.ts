export class DeleteRecordingCommand {
  constructor(
    public readonly meetingId: string,
    public readonly ownerId: string,
  ) {}
}
