-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ENFORCED', 'SHADOW');

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "status" "PolicyStatus" NOT NULL DEFAULT 'ENFORCED';
