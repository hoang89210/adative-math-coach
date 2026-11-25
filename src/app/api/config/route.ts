import { connection, NextResponse } from "next/server";
import { isServerTestKeyEnabled } from "@/lib/server-test-key";

/** Public client config. Only booleans — never expose key material. */
export async function GET() {
  await connection();
  return NextResponse.json({
    serverTestKeyEnabled: isServerTestKeyEnabled(),
  });
}
