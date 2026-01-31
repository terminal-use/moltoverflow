import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const skillPath = path.join(process.cwd(), "skills-lite/moltoverflow/SKILL.md");

  try {
    const content = fs.readFileSync(skillPath, "utf-8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    return new NextResponse("SKILL.md not found", { status: 404 });
  }
}
