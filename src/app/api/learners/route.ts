import { NextRequest, NextResponse } from "next/server";
import {
  createLearner,
  findLearnerByCode,
  publicLearnerView,
  verifyLearnerPin,
} from "@/lib/learners";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "create" | "login" | "lookup";
      pin?: string;
      code?: string;
      grade?: string;
      jurisdiction?: string;
    };
    const action = body.action ?? "create";

    if (action === "create") {
      const { profile, pin } = await createLearner({
        pin: String(body.pin ?? ""),
        grade: body.grade,
        jurisdiction: body.jurisdiction,
      });
      return NextResponse.json({
        learnerId: profile.id,
        publicCode: profile.publicCode,
        pin,
        view: publicLearnerView(profile),
      });
    }

    if (action === "login") {
      const profile = await verifyLearnerPin(
        String(body.code ?? ""),
        String(body.pin ?? ""),
      );
      if (!profile) {
        return NextResponse.json(
          { error: "Invalid code or PIN" },
          { status: 401 },
        );
      }
      return NextResponse.json({
        learnerId: profile.id,
        publicCode: profile.publicCode,
        view: publicLearnerView(profile),
      });
    }

    if (action === "lookup") {
      const profile = await findLearnerByCode(String(body.code ?? ""));
      if (!profile) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({
        publicCode: profile.publicCode,
        view: publicLearnerView(profile),
      });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
