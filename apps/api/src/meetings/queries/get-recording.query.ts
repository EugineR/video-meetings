export class GetRecordingQuery {
  constructor(
    public readonly meetingId: string,
    public readonly recordingId: string,
    public readonly ownerId: string,
    public readonly rangeHeader?: string,
  ) {}
}
