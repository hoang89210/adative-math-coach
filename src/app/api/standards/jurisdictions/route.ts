import { NextResponse } from "next/server";
import { listJurisdictions } from "@/lib/standards/catalog";

export async function GET() {
  try {
    return NextResponse.json({ jurisdictions: listJurisdictions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
