/**
 * Dev-only upload proxy endpoint.
 * Accepts PUT requests and stores files in memory (for E2E testing).
 * This endpoint is only active in development mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDevStore } from '../store';

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

  getDevStore().set(objectKey, { data, contentType });
  console.log(`[dev-upload] PUT ${objectKey} (${data.length} bytes) — store size: ${getDevStore().size}`);

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
  const entry = getDevStore().get(objectKey);
  console.log(`[dev-upload] GET ${objectKey} — found: ${!!entry} — store size: ${getDevStore().size}`);

  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(entry.data as unknown as BodyInit, {
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
  const entry = getDevStore().get(objectKey);

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
  getDevStore().delete(objectKey);

  return new NextResponse(null, { status: 204 });
}
