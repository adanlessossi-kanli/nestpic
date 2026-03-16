import { Suspense } from 'react'
import Link from 'next/link'
import NewAlbumButton from '@/components/NewAlbumButton'
import AlbumsLoading from './loading'

interface Album {
  id: string
  name: string
  created_by: string
  created_at: string
}

interface AlbumsResponse {
  data: Album[]
}

async function AlbumsList() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/albums`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load albums')
  const json: AlbumsResponse = await res.json()
  const albums = json.data

  if (albums.length === 0) {
    return <p className="text-gray-500">No albums yet. Create one to get started.</p>
  }

  return (
    <ul className="space-y-3">
      {albums.map((album) => (
        <li key={album.id} className="rounded border border-gray-100 shadow-sm p-4 hover:bg-gray-50">
          <Link href={`/albums/${album.id}`} className="block">
            <p className="font-bold text-gray-900">{album.name}</p>
            <p className="text-sm text-gray-500">
              {new Date(album.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function AlbumsPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Albums</h1>
        <NewAlbumButton />
      </div>
      <Suspense fallback={<AlbumsLoading />}>
        <AlbumsList />
      </Suspense>
    </main>
  )
}
