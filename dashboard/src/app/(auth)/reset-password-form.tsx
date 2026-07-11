'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Code2 } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { resetPassword, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordFormProps {
  title: string;
  description: string;
  buttonLabel: string;
}

// ponytail: shared by /reset-password and /accept-invite — same endpoint, different copy
export function ResetPasswordForm({ title, description, buttonLabel }: ResetPasswordFormProps) {
  const { login } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [isLoading, setIsLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(token ? null : 'This link is invalid or has expired.');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordFormValues) => {
    try {
      setIsLoading(true);
      const res = await resetPassword({ token, password: data.password });
      login(res.token, res.user, res.org);
      router.push('/dashboard');
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setTokenError(error.message);
      } else {
        toast({
          title: 'Request Failed',
          description: error instanceof ApiError ? error.message : 'An unexpected error occurred.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-2 text-center">
        <div className="flex justify-center mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Code2 className="h-6 w-6 text-primary-foreground" />
          </div>
        </div>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {tokenError ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">{tokenError}</p>
            <p className="text-sm text-muted-foreground">
              <Link href="/forgot-password" className="text-primary hover:underline">
                Request a new reset link
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                {...register('password')}
                disabled={isLoading}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                {...register('confirmPassword')}
                disabled={isLoading}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2" /> : null}
              {buttonLabel}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
