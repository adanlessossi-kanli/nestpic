'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewAlbumButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleOpen() {
    setOpen(true)
    setName('')
    setError(null)
  }

  function handleCancel() {
    setOpen(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Album name is required.')
      return
    }
    if (trimmed.length > 100) {
      setError('Album name must be 100 characters or fewer.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError((json as { message?: string }).message ?? 'Failed to create album.')
        return
      }
      setOpen(false)
      setName('')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        New Album
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Album name"
        className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        disabled={loading}
        autoFocus
      />
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Submit'}
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={loading}
        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
      >
        Cancel
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  )
}
