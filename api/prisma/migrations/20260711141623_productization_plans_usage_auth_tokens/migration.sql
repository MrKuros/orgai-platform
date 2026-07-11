-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'TEAM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "evaluations" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "orgId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "evaluatorType" TEXT NOT NULL,
    "evaluatorPattern" TEXT,
    "evaluatorFlags" TEXT,
    "fixSuggestion" TEXT NOT NULL,
    "severity" "PolicySeverity" NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_orgId_period_key" ON "UsageCounter"("orgId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_version_key" ON "PolicyVersion"("policyId", "version");

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
