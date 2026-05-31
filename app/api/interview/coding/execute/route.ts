import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  parsePythonSignature,
  generateGoProgram,
  generateJavaProgram,
  generateTsProgram,
  type CodingLanguage,
} from "@/lib/apex/interview/languageUtils"

export const runtime = "nodejs"

const PISTON_URL = process.env.PISTON_API_URL ?? "https://emkc.org/api/v2/piston/execute"

const PISTON_LANG: Record<string, { language: string; version: string }> = {
  typescript: { language: "typescript", version: "5.0.3" },
  go:         { language: "go",         version: "1.16.2" },
  java:       { language: "java",       version: "15.0.2" },
}

interface TestCase {
  input: unknown[]
  expected: unknown
  weight: number
}

interface ExecBody {
  code: string
  language: CodingLanguage
  fnName: string
  tests: TestCase[]
  pythonSignature: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Partial<ExecBody>
  const { code, language, fnName, tests, pythonSignature } = body

  if (!code || !language || !fnName || !tests || !pythonSignature) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const pistonTarget = PISTON_LANG[language]
  if (!pistonTarget) {
    return NextResponse.json({ error: `Unsupported language: ${language}` }, { status: 400 })
  }

  // Build harness program
  let program: string
  if (language === "typescript") {
    program = generateTsProgram(code, tests, fnName)
  } else {
    const sig = parsePythonSignature(pythonSignature)
    if (!sig) {
      return NextResponse.json({ error: "Could not parse Python signature" }, { status: 400 })
    }
    program = language === "go"
      ? generateGoProgram(code, sig, tests)
      : generateJavaProgram(code, sig, tests)
  }

  // Execute via Piston
  const pistonHeaders: Record<string, string> = { "Content-Type": "application/json" }
  if (process.env.PISTON_API_KEY) pistonHeaders["Authorization"] = process.env.PISTON_API_KEY

  let pistonRes: Response
  try {
    pistonRes = await fetch(PISTON_URL, {
      method: "POST",
      headers: pistonHeaders,
      body: JSON.stringify({
        language: pistonTarget.language,
        version: pistonTarget.version,
        files: [{ name: language === "go" ? "main.go" : language === "java" ? "Main.java" : "solution.ts", content: program }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return NextResponse.json({ error: `Execution service unavailable: ${String(e)}` }, { status: 503 })
  }

  if (!pistonRes.ok) {
    return NextResponse.json({ error: "Execution service error" }, { status: 502 })
  }

  const pistonData = await pistonRes.json() as { run?: { stdout?: string; stderr?: string; code?: number } }
  const run = pistonData.run

  if (!run) {
    return NextResponse.json({ error: "No output from runner" }, { status: 502 })
  }

  // Parse JSON result from stdout
  const stdout = (run.stdout ?? "").trim()
  const lastLine = stdout.split('\n').at(-1) ?? ""

  try {
    const result = JSON.parse(lastLine)
    return NextResponse.json({ result, stderr: run.stderr || undefined })
  } catch {
    return NextResponse.json({
      error: "Program produced no parseable output",
      stderr: run.stderr || undefined,
      stdout: run.stdout || undefined,
    }, { status: 422 })
  }
}
