import 'server-only';
import { err, ok, type Result } from '../../lib/result';
import type { ChatImage } from '../ai/provider/types';
export const DOCUMENT_IMAGE_LIMITS = Object.freeze({ count: 5, eachBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 });
/** In-memory validation of the existing ChatImage contract. No URL/file fetch. */
export function validateDocumentImages(raw: unknown): Result<readonly ChatImage[], Record<string, string[]>> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DOCUMENT_IMAGE_LIMITS.count) return err({ images: ['Supply between one and five PNG, JPEG or WebP images.'] });
  const images: ChatImage[] = []; let total = 0;
  for (const [index, value] of raw.entries()) {
    const key = `images.${index}`;
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['mimeType', 'data'].includes(k))) return err({ [key]: ['Supply only the image MIME type and base64 data.'] });
    const image = value as Record<string, unknown>;
    if (typeof image.mimeType !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) return err({ [`${key}.mimeType`]: ['Use a PNG, JPEG or WebP image. Native PDF files are unavailable.'] });
    if (typeof image.data !== 'string' || !image.data.length || image.data.length > Math.ceil(DOCUMENT_IMAGE_LIMITS.eachBytes / 3) * 4 || image.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return err({ [`${key}.data`]: ['Supply canonical base64 data within the image size limit.'] });
    const bytes = Buffer.from(image.data, 'base64');
    if (!bytes.length || bytes.length > DOCUMENT_IMAGE_LIMITS.eachBytes || bytes.toString('base64') !== image.data) return err({ [`${key}.data`]: ['Invalid or oversized image data.'] });
    const valid = image.mimeType === 'image/png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
      : image.mimeType === 'image/jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) return err({ [`${key}.data`]: ['The image header does not match its MIME type.'] });
    total += bytes.length;
    if (total > DOCUMENT_IMAGE_LIMITS.totalBytes) return err({ images: ['The combined images exceed the upload limit.'] });
    images.push({ mimeType: image.mimeType as ChatImage['mimeType'], data: image.data });
  }
  return ok(images);
}
