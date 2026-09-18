import { NextResponse } from 'next/server';

export const revalidate = 300; // Cache for 5 mins

export async function GET(request: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  try {
    const res = await fetch(`https://data-api.polymarket.com/positions?user=${wallet}`);
    if (!res.ok) throw new Error('Failed to fetch positions');
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 });
  }
}
