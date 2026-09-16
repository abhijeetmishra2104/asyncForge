-- A dispatcher now claims the events it is about to publish, so a second
-- dispatcher cannot pick up the same rows while the first is still publishing.
-- Both columns are nullable: rows written before this migration are simply
-- unclaimed, and a dispatcher still running the previous version ignores them.

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT;
