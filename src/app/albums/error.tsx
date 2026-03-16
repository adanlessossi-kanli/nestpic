'use client'

interface AlbumsErrorProps {
  error: Error
  reset: () => void
}

export default function AlbumsError({ error, reset }: AlbumsErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-red-600 mb-4">{error.message || 'Something went wrong loading albums.'}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  )
}
