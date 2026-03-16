'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/signin');
  }

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-semibold text-gray-900 text-lg">
          Nestpic
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/feed" className="text-sm text-gray-700 hover:text-gray-900">
            Feed
          </Link>
          <Link href="/albums" className="text-sm text-gray-700 hover:text-gray-900">
            Albums
          </Link>
          <Link href="/invite" className="text-sm text-gray-700 hover:text-gray-900">
            Invite
          </Link>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-gray-700"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            // X icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Hamburger icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 px-4 py-3 flex flex-col gap-3">
          <Link
            href="/feed"
            className="text-sm text-gray-700 hover:text-gray-900"
            onClick={() => setMenuOpen(false)}
          >
            Feed
          </Link>
          <Link
            href="/albums"
            className="text-sm text-gray-700 hover:text-gray-900"
            onClick={() => setMenuOpen(false)}
          >
            Albums
          </Link>
          <Link
            href="/invite"
            className="text-sm text-gray-700 hover:text-gray-900"
            onClick={() => setMenuOpen(false)}
          >
            Invite
          </Link>
          <button
            onClick={handleSignOut}
            className="text-left text-sm text-gray-500 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
