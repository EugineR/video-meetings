import { MeetingSummary, Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MeetingSummaryRepository } from './meeting-summary.repository';

function fkViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Foreign key constraint violated',
    { code: 'P2003', clientVersion: '7.9.1' },
  );
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'An operation failed because it depends on one or more records that were required but not found.',
    { code: 'P2025', clientVersion: '7.9.1' },
  );
}

describe('MeetingSummaryRepository', () => {
  const meetingId = 'meeting-1';
  const summary = {
    id: 'summary-1',
    meetingId,
    status: SummaryStatus.PROCESSING,
    summaryText: null,
    actionItems: [],
    decisions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as MeetingSummary;

  let findUnique: jest.Mock;
  let upsert: jest.Mock;
  let updateMany: jest.Mock;
  let deleteMany: jest.Mock;
  let repository: MeetingSummaryRepository;

  beforeEach(() => {
    findUnique = jest.fn();
    upsert = jest.fn();
    updateMany = jest.fn();
    deleteMany = jest.fn().mockResolvedValue({ count: 1 });

    const prisma = {
      meetingSummary: { findUnique, upsert, updateMany, deleteMany },
    } as unknown as PrismaService;

    repository = new MeetingSummaryRepository(prisma);
  });

  describe('findByMeetingId', () => {
    it('looks up the row by meetingId', async () => {
      findUnique.mockResolvedValue(summary);

      const result = await repository.findByMeetingId(meetingId);

      expect(findUnique).toHaveBeenCalledWith({ where: { meetingId } });
      expect(result).toBe(summary);
    });

    it('returns null when there is no row for the meeting', async () => {
      findUnique.mockResolvedValue(null);

      const result = await repository.findByMeetingId(meetingId);

      expect(result).toBeNull();
    });
  });

  describe('startProcessing', () => {
    it('upserts the row to PROCESSING, creating it on the first run', async () => {
      upsert.mockResolvedValue(summary);

      const result = await repository.startProcessing(meetingId);

      expect(upsert).toHaveBeenCalledWith({
        where: { meetingId },
        create: { meetingId, status: SummaryStatus.PROCESSING },
        update: { status: SummaryStatus.PROCESSING },
      });
      expect(result).toBe(summary);
    });

    it('returns null instead of throwing when the meeting has been deleted (FK violation)', async () => {
      upsert.mockRejectedValue(fkViolation());

      const result = await repository.startProcessing(meetingId);

      expect(result).toBeNull();
    });

    it('returns null instead of throwing on a P2025 not-found error', async () => {
      upsert.mockRejectedValue(notFound());

      const result = await repository.startProcessing(meetingId);

      expect(result).toBeNull();
    });

    it('rethrows an unrelated error', async () => {
      const err = new Error('connection reset');
      upsert.mockRejectedValue(err);

      await expect(repository.startProcessing(meetingId)).rejects.toThrow(
        'connection reset',
      );
    });
  });

  describe('updateStatusIfCurrent', () => {
    it('returns true when the row was updated', async () => {
      updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.updateStatusIfCurrent(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'Summary text',
        actionItems: [{ description: 'Follow up' }],
        decisions: ['Ship it'],
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: { meetingId },
        data: {
          status: SummaryStatus.READY,
          summaryText: 'Summary text',
          actionItems: [{ description: 'Follow up' }],
          decisions: ['Ship it'],
        },
      });
      expect(result).toBe(true);
    });

    it('returns false without throwing when the meeting has since been deleted', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.updateStatusIfCurrent(meetingId, {
        status: SummaryStatus.FAILED,
      });

      expect(result).toBe(false);
    });
  });

  describe('deleteIfExists', () => {
    it('deletes the row scoped by meetingId', async () => {
      await repository.deleteIfExists(meetingId);

      expect(deleteMany).toHaveBeenCalledWith({ where: { meetingId } });
    });

    it('does not throw when there is no row to delete', async () => {
      deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.deleteIfExists(meetingId),
      ).resolves.toBeUndefined();
    });
  });
});
