import { z } from 'zod';

export const createAlbumSchema = z.object({
  name: z.string().min(1).max(100),
});

export const albumQuerySchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
});

export const addMediaToAlbumSchema = z.object({
  mediaId: z.string().uuid(),
});

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export type AlbumQuery = z.infer<typeof albumQuerySchema>;
export type AddMediaToAlbumInput = z.infer<typeof addMediaToAlbumSchema>;
