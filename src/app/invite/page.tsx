'use client';

import { useState } from 'react';

export default function InvitePage() {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setInviteLink(null);

    const res = await fetch('/api/auth/invite', { method: 'POST' });
    const data = await res.json();

    setLoading(false);

    if (!res.ok) {
      if (res.status === 429) {
        setError('Too many invitations sent. Please try again later.');
      } else {
        setError(data.error?.message ?? 'Failed to generate invite link.');
      }
      return;
    }

    setInviteLink(data.data.inviteLink);
  }

  async function handleCopy() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Invite someone</h1>
      <p className="text-sm text-gray-500 mb-6">
        Generate a one-time invite link. It expires in 72 hours.
      </p>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? 'Generating…' : 'Generate invite link'}
      </button>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {inviteLink && (
        <div className="mt-6">
          <p className="text-sm text-gray-600 mb-2">Share this link:</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteLink}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-800 truncate"
              aria-label="Invite link"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
