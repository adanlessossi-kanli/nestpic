import { z } from 'zod';

export const presignSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  fileSize: z.number().int().positive('File size must be a positive integer'),
});

export const confirmSchema = z.object({
  mediaId: z.string().uuid('Invalid media ID'),
});

export type PresignInput = z.infer<typeof presignSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
