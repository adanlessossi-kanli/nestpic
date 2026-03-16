import { z } from 'zod';

export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  token: z.string().uuid('Invalid invitation token'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const inviteSchema = z.object({
  // No body required — invitation is generated for the authenticated user
});

export type SignInInput = z.infer<typeof signInSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
