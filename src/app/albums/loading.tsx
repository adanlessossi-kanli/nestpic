export default function AlbumsLoading() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded border border-gray-100 shadow-sm p-4 space-y-2">
          <div className="h-5 bg-gray-200 animate-pulse rounded w-1/3" />
          <div className="h-3 bg-gray-200 animate-pulse rounded w-1/4" />
        </div>
      ))}
    </div>
  )
}
