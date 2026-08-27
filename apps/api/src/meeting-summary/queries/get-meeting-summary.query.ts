/** Read-only lookup of a meeting's summary row by `meetingId`, dispatched cross-module (e.g. by `meetings/`'s `GetMeetingByIdHandler`) via `QueryBus` rather than a direct repository import. */
export class GetMeetingSummaryQuery {
  constructor(public readonly meetingId: string) {}
}
