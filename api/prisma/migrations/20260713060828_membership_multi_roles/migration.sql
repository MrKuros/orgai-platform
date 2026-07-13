-- Membership.assignedRoleId (single) → Membership.assignedRoles (many-to-many).
-- Existing assignments are copied into the join table before the column drops.

-- CreateTable
CREATE TABLE "_MembershipAssignedRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_MembershipAssignedRoles_AB_unique" ON "_MembershipAssignedRoles"("A", "B");

-- CreateIndex
CREATE INDEX "_MembershipAssignedRoles_B_index" ON "_MembershipAssignedRoles"("B");

-- AddForeignKey
ALTER TABLE "_MembershipAssignedRoles" ADD CONSTRAINT "_MembershipAssignedRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MembershipAssignedRoles" ADD CONSTRAINT "_MembershipAssignedRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing single-role assignments
INSERT INTO "_MembershipAssignedRoles" ("A", "B")
SELECT "id", "assignedRoleId" FROM "Membership" WHERE "assignedRoleId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_assignedRoleId_fkey";

-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "assignedRoleId";
