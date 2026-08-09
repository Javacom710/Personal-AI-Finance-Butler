/**
 * Validation schemas for the authentication boundary (ADR-16).
 *
 * Zod is the single validation boundary: server actions, route handlers, AI
 * tool inputs and structured output all parse through schemas like these rather
 * than trusting a shape. These live in `src/lib/schemas` so the same definition
 * can be shared by a form and by a future API surface without being duplicated.
 */

import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .refine((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), { message: 'Enter a valid email address.' });

export const loginSchema = z.object({
  email: emailSchema,
  // No length or shape constraint at login: policy applies when a password is
  // *set*. Enforcing it here would tell an attacker which rule a guess violated,
  // and would lock out a user whose valid old password predates a policy change.
  password: z.string().min(1, 'Enter your password.').max(1024),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const secondFactorSchema = z.object({
  /**
   * Accepts a 6-digit TOTP code or a recovery code in either written form.
   * Kept loose on purpose — `verifySecondFactorStep` decides which it is, and a
   * strict pattern here would reject recovery codes before they were tried.
   */
  code: z
    .string()
    .trim()
    .min(6, 'Enter the 6-digit code from your authenticator, or a recovery code.')
    .max(32),
  next: z.string().optional(),
});

export type SecondFactorInput = z.infer<typeof secondFactorSchema>;
