import { z } from 'zod';

export const feedQuerySchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;
