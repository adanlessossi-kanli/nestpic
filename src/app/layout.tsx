import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Nestpic',
  description: 'Private family photo and video sharing',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
