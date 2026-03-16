'use client'

interface AlbumErrorProps {
  error: Error
  reset: () => void
}

export default function AlbumError({ error, reset }: AlbumErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-red-600 mb-4">{error.message || 'Something went wrong loading the album.'}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  )
}
