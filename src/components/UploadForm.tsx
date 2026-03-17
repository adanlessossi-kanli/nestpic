'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import type { FeedItem } from '@/lib/types/media'

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
]

const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.avi'
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

interface UploadFormProps {
  onClose: () => void
  onSuccess: (item: FeedItem) => void
  albumId?: string
}

interface PresignResponse {
  uploadUrl: string
  mediaId: string
}

interface ConfirmResponse {
  media: FeedItem
}

interface Category {
  id: string
  name: string
  createdBy: string
  createdAt: string
}

export default function UploadForm({ onClose, onSuccess, albumId }: UploadFormProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)

  const [label, setLabel] = useState('')
  const [labelError, setLabelError] = useState<string | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('') // '' = none, '__new__' = new
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)

  // Fetch existing categories on mount
  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.ok ? res.json() : Promise.resolve([]))
      .then((data) => {
        if (Array.isArray(data)) setCategories(data)
      })
      .catch(() => {/* silently ignore */})
  }, [])

  const validateAndSetFile = useCallback((f: File) => {
    setError(null)
    if (!ACCEPTED_MIME_TYPES.includes(f.type)) {
      setError('Unsupported file type. Accepted: JPEG, PNG, GIF, WebP, MP4, MOV, AVI.')
      setFile(null)
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      setError('File exceeds the 200 MB size limit.')
      setFile(null)
      return
    }
    setFile(f)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) validateAndSetFile(f)
  }, [validateAndSetFile])

  const handleLabelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setLabel(val)
    if (val.length > 100) {
      setLabelError('Label must be 100 characters or fewer.')
    } else {
      setLabelError(null)
    }
  }, [])

  const handleNewCategoryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setNewCategoryName(val)
    if (val.length > 100) {
      setCategoryError('Category name must be 100 characters or fewer.')
    } else {
      setCategoryError(null)
    }
  }, [])

  const handleCategorySelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value)
    setCategoryError(null)
    setNewCategoryName('')
  }, [])

  const hasValidationErrors = !!labelError || !!categoryError

  const handleUpload = useCallback(async () => {
    if (!file) return

    // Final client-side validation
    if (label.length > 100) {
      setLabelError('Label must be 100 characters or fewer.')
      return
    }
    if (selectedCategory === '__new__' && newCategoryName.length > 100) {
      setCategoryError('Category name must be 100 characters or fewer.')
      return
    }

    setUploading(true)
    setError(null)
    setProgress(0)

    const categoryValue = selectedCategory === '__new__'
      ? (newCategoryName.trim() || undefined)
      : (selectedCategory || undefined)

    try {
      // 1. Request presigned URL
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          label: label || undefined,
          category: categoryValue,
        }),
      })

      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({}))
        setError(body?.error?.message ?? 'Failed to initiate upload.')
        return
      }

      const { uploadUrl, mediaId }: PresignResponse = await presignRes.json()

      // 2. XHR upload with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed with status ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      })

      setProgress(100)

      // 3. Confirm upload
      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId,
          label: label || undefined,
          category: categoryValue,
        }),
      })

      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}))
        setError(body?.error?.message ?? 'Upload confirmation failed.')
        return
      }

      const confirmed: ConfirmResponse = await confirmRes.json()
      const m = confirmed.media

      // 4. If albumId provided, add media to album
      if (albumId) {
        await fetch(`/api/albums/${albumId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaId: m.id }),
        })
      }

      onSuccess({
        id: m.id,
        thumbnailUrl: m.thumbnailUrl,
        uploaderName: m.uploaderName,
        uploaderId: m.uploaderId,
        uploadedAt: m.uploadedAt,
        contentType: m.contentType,
        s3Key: m.s3Key,
        label: m.label ?? null,
        category: m.category ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }, [file, label, selectedCategory, newCategoryName, albumId, onSuccess])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h2 id="upload-dialog-title" className="text-lg font-semibold mb-4">Upload Media</h2>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-700 mb-3 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          aria-label="Select a file to upload"
          disabled={uploading}
        />

        {file && !error && (
          <p className="text-sm text-gray-600 mb-3 truncate">
            {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}

        {/* Label input */}
        <div className="mb-3">
          <label htmlFor="upload-label" className="block text-sm text-gray-700 mb-1">
            Label <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="upload-label"
            type="text"
            maxLength={100}
            value={label}
            onChange={handleLabelChange}
            disabled={uploading}
            placeholder="e.g. Beach sunset"
            className="block w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            aria-describedby={labelError ? 'label-error' : undefined}
          />
          {labelError && (
            <p id="label-error" role="alert" className="text-xs text-red-600 mt-1">{labelError}</p>
          )}
        </div>

        {/* Category selector */}
        <div className="mb-3">
          <label htmlFor="upload-category" className="block text-sm text-gray-700 mb-1">
            Category <span className="text-gray-400">(optional)</span>
          </label>
          <select
            id="upload-category"
            value={selectedCategory}
            onChange={handleCategorySelect}
            disabled={uploading}
            className="block w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          >
            <option value="">— None —</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
            <option value="__new__">New category…</option>
          </select>
        </div>

        {/* New category name input */}
        {selectedCategory === '__new__' && (
          <div className="mb-3">
            <label htmlFor="upload-new-category" className="block text-sm text-gray-700 mb-1">
              New category name
            </label>
            <input
              id="upload-new-category"
              type="text"
              maxLength={100}
              value={newCategoryName}
              onChange={handleNewCategoryChange}
              disabled={uploading}
              placeholder="e.g. Holidays"
              className="block w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              aria-describedby={categoryError ? 'category-error' : undefined}
            />
            {categoryError && (
              <p id="category-error" role="alert" className="text-xs text-red-600 mt-1">{categoryError}</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>
        )}

        {progress !== null && (
          <div className="mb-3" aria-label={`Upload progress: ${progress}%`}>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading || !!error || hasValidationErrors}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
