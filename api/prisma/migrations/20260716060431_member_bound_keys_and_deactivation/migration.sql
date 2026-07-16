-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "memberId" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
