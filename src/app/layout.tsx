import type { Metadata } from 'next';
import { headers } from 'next/headers';
import NavBar from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nestpic',
  description: 'Private family photo and video sharing',
};

// Routes that should not show the nav bar
const AUTH_ROUTES = ['/signin', '/register'];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';
  const showNav = !AUTH_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {showNav && <NavBar />}
        <main>{children}</main>
      </body>
    </html>
  );
}
