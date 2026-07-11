'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Code2 } from 'lucide-react';

import { forgotPassword, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    try {
      setIsLoading(true);
      await forgotPassword(data);
      setIsSubmitted(true);
    } catch (error) {
      toast({
        title: 'Request Failed',
        description: error instanceof ApiError ? error.message : 'An unexpected error occurred.',
        variant: 'destructive',
      });
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
        <CardTitle className="text-2xl">Forgot password</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        {isSubmitted ? (
          <p className="text-center text-sm text-muted-foreground">
            If that email is registered, a reset link has been sent.
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                {...register('email')}
                disabled={isLoading}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2" /> : null}
              Send Reset Link
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="text-center text-sm text-muted-foreground">
          Remembered your password?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
