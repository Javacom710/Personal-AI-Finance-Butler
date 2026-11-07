import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Receipt and statement drafts' };
export default async function DocumentDraftPage() {
  await requireSession('/ai/documents');
  return <>
    <PageHeader title="Receipt and statement drafts" description="Extract monetary transactions from images, then review and confirm each draft." />
    <p>Document extraction will be available after setup approval.</p>
    <label className="block">Receipt or short statement images<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled className="mt-2 block" /></label>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Extract transaction drafts</button>
    <p>PNG, JPEG and WebP images are supported, up to five images, two megabytes each and eight megabytes combined. Native PDFs and investment trades are unavailable.</p>
    <p>Each extraction can draft up to twenty monetary transactions. Check completeness against the original document and process additional pages separately. Every extracted field is an unconfirmed proposal; review amounts, dates, accounts and categories before confirming.</p>
    <p>Unconfirmed drafts expire after twenty-four hours. Original images are not retained. Missing or ambiguous fields require your correction and acknowledgement.</p>
    <Link href="/money/proposals" className="underline">Review transaction drafts</Link>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
