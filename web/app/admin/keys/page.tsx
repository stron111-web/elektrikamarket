import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminKeyPage() {
  // No authentication level may disclose server credentials through the browser.
  notFound();
}
