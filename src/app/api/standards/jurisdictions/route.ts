import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { listJurisdictions } from "@/lib/standards/catalog";

export async function GET() {
  try {
    return NextResponse.json({ jurisdictions: listJurisdictions() });
  } catch (err) {
    return errorResponse(err);
  }
}
