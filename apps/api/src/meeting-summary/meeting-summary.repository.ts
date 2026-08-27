import { Injectable } from '@nestjs/common';
import { MeetingSummary, Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma's "record to update/delete not found" error code. */
const PRISMA_NOT_FOUND_CODE = 'P2025';
/** Prisma's "foreign key constraint violated" error code. */
const PRISMA_FK_VIOLATION_CODE = 'P2003';

export interface UpdateSummaryStatusInput {
  status: SummaryStatus;
  summaryText?: string | null;
  actionItems?: Prisma.InputJsonValue;
  decisions?: Prisma.InputJsonValue;
}

@Injectable()
export class MeetingSummaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByMeetingId(meetingId: string): Promise<MeetingSummary | null> {
    return this.prisma.meetingSummary.findUnique({ where: { meetingId } });
  }

  /**
   * Creates the meeting's summary row with status `PROCESSING` if none exists yet (the first
   * summarization run for this meeting), or moves an existing one back to `PROCESSING` for a
   * re-run. Returns `null` instead of throwing if the meeting has been deleted since the caller
   * decided to run this — the FK constraint on `meetingId` rejects the create — so a background
   * run started for a since-deleted meeting becomes a no-op, mirroring
   * `RecordingsRepository.updateStatusIfCurrent`'s no-op-on-deleted-row behavior.
   */
  async startProcessing(meetingId: string): Promise<MeetingSummary | null> {
    try {
      return await this.prisma.meetingSummary.upsert({
        where: { meetingId },
        create: { meetingId, status: SummaryStatus.PROCESSING },
        update: { status: SummaryStatus.PROCESSING },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === PRISMA_FK_VIOLATION_CODE ||
          err.code === PRISMA_NOT_FOUND_CODE)
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Updates the meeting's summary row, but only while it (and its owning meeting) still exists —
   * matched by `meetingId` alone via `updateMany`, the same matched-on-current-row approach
   * `RecordingsRepository.updateStatusIfCurrent` uses for recordings. Returns `false` without
   * writing anything if the meeting has since been deleted (cascading away this row too).
   */
  async updateStatusIfCurrent(
    meetingId: string,
    data: UpdateSummaryStatusInput,
  ): Promise<boolean> {
    const result = await this.prisma.meetingSummary.updateMany({
      where: { meetingId },
      data,
    });
    return result.count > 0;
  }
}
