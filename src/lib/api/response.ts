import { NextResponse } from 'next/server';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 200 });
}

export function err(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
