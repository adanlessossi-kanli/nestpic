/**
 * Dev-only upload proxy endpoint.
 * Accepts PUT requests and stores files in memory (for E2E testing).
 * This endpoint is only active in development mode.
 */
import { NextRequest, NextResponse } from 'next/server';

// Use a global variable to persist across module re-evaluations in dev mode
declare global {
  // eslint-disable-next-line no-var
  var __devStore: Map<string, { data: Buffer; contentType: string }> | undefined;
}

if (!global.__devStore) {
  global.__devStore = new Map();
}

const devStore = global.__devStore;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { key } = await params;
  const objectKey = key.join('/');
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';

  const arrayBuffer = await request.arrayBuffer();
  const data = Buffer.from(arrayBuffer);

  devStore.set(objectKey, { data, contentType });

  return new NextResponse(null, { status: 200 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { key } = await params;
  const objectKey = key.join('/');
  const entry = devStore.get(objectKey);

  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(entry.data, {
    status: 200,
    headers: { 'Content-Type': entry.contentType },
  });
}

export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { key } = await params;
  const objectKey = key.join('/');
  const entry = devStore.get(objectKey);

  if (!entry) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': entry.contentType,
      'Content-Length': String(entry.data.length),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { key } = await params;
  const objectKey = key.join('/');
  devStore.delete(objectKey);

  return new NextResponse(null, { status: 204 });
}

export function getDevStore() {
  return devStore;
}
