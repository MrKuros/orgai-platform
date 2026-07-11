import { Plan } from '@prisma/client';
import { AppError } from './AppError';
import { prisma } from './prisma';

export interface PlanLimits {
  members: number;
  policies: number;
  apiKeys: number;
  evaluationsPerMonth: number;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { members: 5, policies: 10, apiKeys: 5, evaluationsPerMonth: 5_000 },
  TEAM: { members: 50, policies: 100, apiKeys: 10, evaluationsPerMonth: 250_000 },
  ENTERPRISE: { members: UNLIMITED, policies: UNLIMITED, apiKeys: UNLIMITED, evaluationsPerMonth: UNLIMITED }
};

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Throws 402 if the org has reached `limit` for a countable resource.
 * Pass the current count; caller decides what to count.
 */
export function assertWithinLimit(current: number, limit: number, resource: string, plan: Plan): void {
  if (current >= limit) {
    throw new AppError(
      402,
      'PLAN_LIMIT',
      `${resource} limit reached for the ${plan} plan (${limit}). Contact sales to upgrade.`
    );
  }
}

/**
 * Increments the org's monthly evaluation counter and throws 402 once the
 * plan's monthly quota is exhausted. One row per org per month.
 */
export async function meterEvaluation(orgId: string, plan: Plan): Promise<void> {
  const period = currentPeriod();
  const counter = await prisma.usageCounter.upsert({
    where: { orgId_period: { orgId, period } },
    create: { orgId, period, evaluations: 1 },
    update: { evaluations: { increment: 1 } }
  });

  const limit = limitsFor(plan).evaluationsPerMonth;
  if (counter.evaluations > limit) {
    throw new AppError(
      402,
      'PLAN_LIMIT',
      `Monthly policy evaluation quota reached for the ${plan} plan (${limit}). Contact sales to upgrade.`
    );
  }
}

export async function getUsage(orgId: string) {
  const period = currentPeriod();
  const counter = await prisma.usageCounter.findUnique({
    where: { orgId_period: { orgId, period } }
  });
  return { period, evaluations: counter?.evaluations ?? 0 };
}
