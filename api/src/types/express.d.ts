import { User, Organization, ApiKey, Membership } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      org?: Organization;
      membership?: Membership;
      apiKeyRecord?: ApiKey;
    }
  }
}
