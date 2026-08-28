-- AlterTable
ALTER TABLE "meeting_summaries" ADD COLUMN     "foldedRecordingIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
