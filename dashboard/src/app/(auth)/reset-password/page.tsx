'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';

import { ResetPasswordForm } from '../reset-password-form';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm
        title="Reset password"
        description="Choose a new password for your OrgAI account"
        buttonLabel="Reset Password"
      />
    </Suspense>
  );
}
