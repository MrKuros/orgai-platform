import { User, Organization, ApiKey, Membership, Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      org?: Organization;
      membership?: Membership;
      // member is populated for member-bound keys (developer identity + roles)
      apiKeyRecord?: ApiKey & {
        member?: (Membership & { user: User; assignedRoles: Role[] }) | null;
      };
    }
  }
}
