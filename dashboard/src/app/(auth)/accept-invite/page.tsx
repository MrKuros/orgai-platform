'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';

import { ResetPasswordForm } from '../reset-password-form';

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <ResetPasswordForm
        title="Join your team"
        description="Set a password to join your team on OrgAI"
        buttonLabel="Join team"
      />
    </Suspense>
  );
}
