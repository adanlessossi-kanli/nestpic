import { z } from 'zod';

export const presignSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  fileSize: z.number().int().positive('File size must be a positive integer'),
  label: z.string().max(100, 'Label must be 100 characters or fewer').optional(),
  category: z.string().max(100, 'Category must be 100 characters or fewer').optional(),
});

export const confirmSchema = z.object({
  mediaId: z.string().uuid('Invalid media ID'),
  label: z.string().max(100, 'Label must be 100 characters or fewer').optional(),
  category: z.string().max(100, 'Category must be 100 characters or fewer').optional(),
});

export type PresignInput = z.infer<typeof presignSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
