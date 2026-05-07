import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const year = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  try {
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`, {
      next: { revalidate: 86400 }, // cache 24 h en el servidor
    })
    if (!res.ok) return NextResponse.json([])
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json([])
  }
}
