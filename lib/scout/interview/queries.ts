import { getPostgresPool } from '@/lib/postgres/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InterviewPersona =
  | 'friendly_recruiter'
  | 'skeptical_hm'
  | 'senior_staff'
  | 'founder'
  | 'panel'

export type InterviewQuestionSet =
  | 'recruiter_screen'
  | 'behavioral'
  | 'technical_screen'
  | 'system_design'
  | 'coding'
  | 'mixed'

export type InterviewStatus = 'setup' | 'active' | 'completed' | 'abandoned'

export type InterviewTurnRole = 'interviewer' | 'candidate' | 'system'

export interface InterviewSession {
  id: string
  userId: string
  jobId: string | null
  type: 'text' | 'live' | 'coding'
  persona: InterviewPersona
  questionSet: InterviewQuestionSet
  status: InterviewStatus
  durationTargetMin: number
  useResumeContext: boolean
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface InterviewTurn {
  id: string
  sessionId: string
  turnIndex: number
  role: InterviewTurnRole
  content: string
  audioUrl: string | null
  videoThumbUrl: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface InterviewDebrief {
  id: string
  sessionId: string
  overallScore: number | null
  headline: string | null
  strengths: unknown[]
  gaps: unknown[]
  sampleBetterAnswers: unknown[]
  voiceFeedback: unknown | null
  deliverySignals: unknown | null
  codingFeedback: unknown | null
  recommendedNext: unknown[]
  generatedAt: Date
}

export interface InterviewSessionWithDebrief extends InterviewSession {
  debrief: InterviewDebrief | null
  jobTitle: string | null
  jobCompany: string | null
}

export interface CodingProblem {
  id: string
  slug: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  language: 'python' | 'javascript' | 'typescript' | 'any'
  prompt: string
  functionSignature: { python?: string; javascript?: string }
  hiddenTests: Array<{ input: unknown[]; expected: unknown; weight: number }>
  hints: string[]
  targetMinutes: number
  tags: string[]
  createdAt: Date
}

export interface CodingAttempt {
  id: string
  sessionId: string
  problemId: string
  languageUsed: 'python' | 'javascript' | 'typescript'
  codeSnapshots: Array<{ ts: number; code: string }>
  finalCode: string | null
  testResults: unknown | null
  hintsUsed: number
  solveTimeSec: number | null
  submittedAt: Date | null
  createdAt: Date
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapSession(row: Record<string, unknown>): InterviewSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    jobId: (row.job_id as string | null) ?? null,
    type: row.type as InterviewSession['type'],
    persona: row.persona as InterviewPersona,
    questionSet: row.question_set as InterviewQuestionSet,
    status: row.status as InterviewStatus,
    durationTargetMin: row.duration_target_min as number,
    useResumeContext: row.use_resume_context as boolean,
    startedAt: row.started_at ? new Date(row.started_at as string) : null,
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

function mapTurn(row: Record<string, unknown>): InterviewTurn {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    turnIndex: row.turn_index as number,
    role: row.role as InterviewTurnRole,
    content: row.content as string,
    audioUrl: (row.audio_url as string | null) ?? null,
    videoThumbUrl: (row.video_thumb_url as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
  }
}

function mapDebrief(row: Record<string, unknown>, prefix = ''): InterviewDebrief {
  const p = (col: string) => (prefix ? `${prefix}${col}` : col)
  return {
    id: row[p('id')] as string,
    sessionId: row[p('session_id')] as string,
    overallScore: (row[p('overall_score')] as number | null) ?? null,
    headline: (row[p('headline')] as string | null) ?? null,
    strengths: (row[p('strengths')] as unknown[]) ?? [],
    gaps: (row[p('gaps')] as unknown[]) ?? [],
    sampleBetterAnswers: (row[p('sample_better_answers')] as unknown[]) ?? [],
    voiceFeedback: (row[p('voice_feedback')] as unknown) ?? null,
    deliverySignals: (row[p('delivery_signals')] as unknown) ?? null,
    codingFeedback: (row[p('coding_feedback')] as unknown) ?? null,
    recommendedNext: (row[p('recommended_next')] as unknown[]) ?? [],
    generatedAt: new Date(row[p('generated_at')] as string),
  }
}

function mapCodingProblem(row: Record<string, unknown>): CodingProblem {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    difficulty: row.difficulty as CodingProblem['difficulty'],
    language: row.language as CodingProblem['language'],
    prompt: row.prompt as string,
    functionSignature: row.function_signature as { python?: string; javascript?: string },
    hiddenTests: row.hidden_tests as CodingProblem['hiddenTests'],
    hints: row.hints as string[],
    targetMinutes: row.target_minutes as number,
    tags: row.tags as string[],
    createdAt: new Date(row.created_at as string),
  }
}

function mapCodingAttempt(row: Record<string, unknown>): CodingAttempt {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    problemId: row.problem_id as string,
    languageUsed: row.language_used as CodingAttempt['languageUsed'],
    codeSnapshots: (row.code_snapshots as CodingAttempt['codeSnapshots']) ?? [],
    finalCode: (row.final_code as string | null) ?? null,
    testResults: (row.test_results as unknown) ?? null,
    hintsUsed: row.hints_used as number,
    solveTimeSec: (row.solve_time_sec as number | null) ?? null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createInterviewSession(input: {
  userId: string
  jobId?: string | null
  type: 'text' | 'live' | 'coding'
  persona: InterviewPersona
  questionSet: InterviewQuestionSet
  durationTargetMin: number
  useResumeContext: boolean
}): Promise<InterviewSession> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO interview_sessions
       (user_id, job_id, type, persona, question_set, duration_target_min, use_resume_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.userId,
      input.jobId ?? null,
      input.type,
      input.persona,
      input.questionSet,
      input.durationTargetMin,
      input.useResumeContext,
    ]
  )
  return mapSession(result.rows[0])
}

export async function getInterviewSession(
  id: string,
  userId: string
): Promise<InterviewSession | null> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM interview_sessions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return result.rows[0] ? mapSession(result.rows[0]) : null
}

export async function updateInterviewSessionStatus(
  id: string,
  status: InterviewStatus,
  endedAt?: Date
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE interview_sessions
     SET status = $2, ended_at = $3
     WHERE id = $1`,
    [id, status, endedAt ?? null]
  )
}

export async function listRecentSessions(
  userId: string,
  limit: number
): Promise<InterviewSessionWithDebrief[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT
       s.id, s.user_id, s.job_id, s.type, s.persona, s.question_set, s.status,
       s.duration_target_min, s.use_resume_context, s.started_at, s.ended_at,
       s.created_at, s.updated_at,
       j.title  AS job_title,
       c.name   AS job_company,
       d.id             AS d_id,
       d.session_id     AS d_session_id,
       d.overall_score  AS d_overall_score,
       d.headline       AS d_headline,
       d.strengths      AS d_strengths,
       d.gaps           AS d_gaps,
       d.sample_better_answers AS d_sample_better_answers,
       d.voice_feedback     AS d_voice_feedback,
       d.delivery_signals   AS d_delivery_signals,
       d.coding_feedback    AS d_coding_feedback,
       d.recommended_next   AS d_recommended_next,
       d.generated_at   AS d_generated_at
     FROM interview_sessions s
     LEFT JOIN jobs j         ON j.id = s.job_id
     LEFT JOIN companies c    ON c.id = j.company_id
     LEFT JOIN interview_debriefs d ON d.session_id = s.id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [userId, limit]
  )

  return result.rows.map((row) => ({
    ...mapSession(row),
    debrief: row['d_id'] ? mapDebrief(row, 'd_') : null,
    jobTitle: (row['job_title'] as string | null) ?? null,
    jobCompany: (row['job_company'] as string | null) ?? null,
  }))
}

export async function listSessionsForJob(
  userId: string,
  jobId: string
): Promise<InterviewSession[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM interview_sessions
     WHERE user_id = $1 AND job_id = $2
     ORDER BY created_at DESC`,
    [userId, jobId]
  )
  return result.rows.map(mapSession)
}

// ─── Turns ────────────────────────────────────────────────────────────────────

export async function appendTurn(input: {
  sessionId: string
  turnIndex: number
  role: InterviewTurnRole
  content: string
  audioUrl?: string
  videoThumbUrl?: string
  metadata?: Record<string, unknown>
}): Promise<InterviewTurn> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO interview_turns
       (session_id, turn_index, role, content, audio_url, video_thumb_url, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.sessionId,
      input.turnIndex,
      input.role,
      input.content,
      input.audioUrl ?? null,
      input.videoThumbUrl ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  )
  return mapTurn(result.rows[0])
}

export async function getTurns(sessionId: string): Promise<InterviewTurn[]> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM interview_turns
     WHERE session_id = $1
     ORDER BY turn_index ASC`,
    [sessionId]
  )
  return result.rows.map(mapTurn)
}

// ─── Debriefs ─────────────────────────────────────────────────────────────────

export async function upsertDebrief(input: {
  sessionId: string
  overallScore: number | null
  headline: string
  strengths: unknown[]
  gaps: unknown[]
  sampleBetterAnswers: unknown[]
  voiceFeedback?: unknown
  deliverySignals?: unknown
  codingFeedback?: unknown
  recommendedNext: unknown[]
}): Promise<InterviewDebrief> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO interview_debriefs
       (session_id, overall_score, headline, strengths, gaps, sample_better_answers,
        voice_feedback, delivery_signals, coding_feedback, recommended_next)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (session_id) DO UPDATE SET
       overall_score        = EXCLUDED.overall_score,
       headline             = EXCLUDED.headline,
       strengths            = EXCLUDED.strengths,
       gaps                 = EXCLUDED.gaps,
       sample_better_answers = EXCLUDED.sample_better_answers,
       voice_feedback       = EXCLUDED.voice_feedback,
       delivery_signals     = EXCLUDED.delivery_signals,
       coding_feedback      = EXCLUDED.coding_feedback,
       recommended_next     = EXCLUDED.recommended_next,
       generated_at         = NOW()
     RETURNING *`,
    [
      input.sessionId,
      input.overallScore,
      input.headline,
      JSON.stringify(input.strengths),
      JSON.stringify(input.gaps),
      JSON.stringify(input.sampleBetterAnswers),
      input.voiceFeedback !== undefined ? JSON.stringify(input.voiceFeedback) : null,
      input.deliverySignals !== undefined ? JSON.stringify(input.deliverySignals) : null,
      input.codingFeedback !== undefined ? JSON.stringify(input.codingFeedback) : null,
      JSON.stringify(input.recommendedNext),
    ]
  )
  return mapDebrief(result.rows[0])
}

export async function getDebrief(sessionId: string): Promise<InterviewDebrief | null> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM interview_debriefs WHERE session_id = $1`,
    [sessionId]
  )
  return result.rows[0] ? mapDebrief(result.rows[0]) : null
}

// ─── Coding problems ──────────────────────────────────────────────────────────

export async function listCodingProblems(filter?: {
  difficulty?: 'easy' | 'medium' | 'hard'
  tags?: string[]
}): Promise<CodingProblem[]> {
  const pool = getPostgresPool()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter?.difficulty) {
    params.push(filter.difficulty)
    conditions.push(`difficulty = $${params.length}::coding_difficulty`)
  }

  if (filter?.tags && filter.tags.length > 0) {
    params.push(filter.tags)
    conditions.push(`tags && $${params.length}::text[]`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM coding_problems ${where} ORDER BY difficulty, title`,
    params
  )
  return result.rows.map(mapCodingProblem)
}

export async function getCodingProblem(id: string): Promise<CodingProblem | null> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM coding_problems WHERE id = $1`,
    [id]
  )
  return result.rows[0] ? mapCodingProblem(result.rows[0]) : null
}

export async function pickCodingProblemForSession(input: {
  difficulty: 'easy' | 'medium' | 'hard'
  excludeIds?: string[]
  preferredTags?: string[]
}): Promise<CodingProblem | null> {
  const pool = getPostgresPool()
  const excluded = input.excludeIds ?? []
  const preferred = input.preferredTags ?? []

  // Try preferred tags first (uses GIN index)
  if (preferred.length > 0) {
    const tagged = await pool.query<Record<string, unknown>>(
      `SELECT * FROM coding_problems
       WHERE difficulty = $1::coding_difficulty
         AND id != ALL($2::uuid[])
         AND tags && $3::text[]
       ORDER BY RANDOM()
       LIMIT 1`,
      [input.difficulty, excluded, preferred]
    )
    if (tagged.rows[0]) return mapCodingProblem(tagged.rows[0])
  }

  // Fallback: any problem of that difficulty
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM coding_problems
     WHERE difficulty = $1::coding_difficulty
       AND id != ALL($2::uuid[])
     ORDER BY RANDOM()
     LIMIT 1`,
    [input.difficulty, excluded]
  )
  return result.rows[0] ? mapCodingProblem(result.rows[0]) : null
}

// ─── Coding attempts ──────────────────────────────────────────────────────────

export async function createCodingAttempt(input: {
  sessionId: string
  problemId: string
  languageUsed: 'python' | 'javascript' | 'typescript'
}): Promise<CodingAttempt> {
  const pool = getPostgresPool()
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO coding_attempts (session_id, problem_id, language_used)
     VALUES ($1, $2, $3::coding_language)
     RETURNING *`,
    [input.sessionId, input.problemId, input.languageUsed]
  )
  return mapCodingAttempt(result.rows[0])
}

export async function appendCodeSnapshot(
  attemptId: string,
  ts: number,
  code: string
): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE coding_attempts
     SET code_snapshots = code_snapshots || $2::jsonb
     WHERE id = $1`,
    [attemptId, JSON.stringify([{ ts, code }])]
  )
}

export async function submitCodingAttempt(input: {
  attemptId: string
  finalCode: string
  testResults: unknown
  hintsUsed: number
  solveTimeSec: number
}): Promise<void> {
  const pool = getPostgresPool()
  await pool.query(
    `UPDATE coding_attempts
     SET final_code    = $2,
         test_results  = $3::jsonb,
         hints_used    = $4,
         solve_time_sec = $5,
         submitted_at  = NOW()
     WHERE id = $1`,
    [
      input.attemptId,
      input.finalCode,
      JSON.stringify(input.testResults),
      input.hintsUsed,
      input.solveTimeSec,
    ]
  )
}
