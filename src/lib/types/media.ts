export interface FeedItem {
  id: string;
  thumbnailUrl: string | null;
  uploaderName: string;
  uploaderId: string;
  uploadedAt: string;
  contentType: string;
  s3Key: string;
  label: string | null;
  category: string | null;
}
