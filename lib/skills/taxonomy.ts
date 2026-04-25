import type { Resume, Skills } from "@/types"

type SkillDefinition = {
  label: string
  aliases: string[]
  patterns?: RegExp[]
}

const GO_LANGUAGE_SIGNAL_RE =
  /\b(?:go\s+language|go\s+(?:developer|engineer|backend|services?|microservices?|sdk|runtime)|golang|written in go|using go|experience\s+(?:with|in)\s+go|proficien(?:cy|t)\s+(?:with|in)\s+go|knowledge of go|expertise in go|fluency in go|(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php)\s*(?:,|\/|\band\b)\s*go|go\s*(?:,|\/|\band\b)\s*(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php))\b/i

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  { label: "JavaScript", aliases: ["javascript", "js"] },
  { label: "TypeScript", aliases: ["typescript", "ts"] },
  { label: "Node.js", aliases: ["node", "node.js", "nodejs"] },
  { label: "React", aliases: ["react", "react.js", "reactjs"] },
  { label: "Next.js", aliases: ["next.js", "nextjs", "next"] },
  { label: "Python", aliases: ["python"] },
  { label: "Java", aliases: ["java"] },
  { label: "Go", aliases: ["go", "golang"], patterns: [GO_LANGUAGE_SIGNAL_RE] },
  { label: "Rust", aliases: ["rust"] },
  { label: "C++", aliases: ["c++", "cpp"] },
  { label: "C#", aliases: ["c#", "csharp"] },
  { label: "SQL", aliases: ["sql"] },
  { label: "PostgreSQL", aliases: ["postgresql", "postgres"] },
  { label: "MySQL", aliases: ["mysql"] },
  { label: "MongoDB", aliases: ["mongodb", "mongo"] },
  { label: "Redis", aliases: ["redis"] },
  { label: "AWS", aliases: ["aws", "amazon web services"] },
  { label: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { label: "Azure", aliases: ["azure", "microsoft azure"] },
  { label: "Docker", aliases: ["docker"] },
  { label: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { label: "Terraform", aliases: ["terraform"] },
  { label: "GraphQL", aliases: ["graphql"] },
  { label: "REST", aliases: ["rest", "restful", "rest api", "rest apis"] },
  { label: "Spark", aliases: ["spark", "apache spark"] },
  { label: "Airflow", aliases: ["airflow", "apache airflow"] },
  { label: "Pandas", aliases: ["pandas"] },
  { label: "Machine Learning", aliases: ["machine learning", "ml"] },
  { label: "Deep Learning", aliases: ["deep learning"] },
  { label: "Data Analysis", aliases: ["data analysis", "data analytics"] },
  { label: "Figma", aliases: ["figma"] },
  { label: "Product Strategy", aliases: ["product strategy"] },
  { label: "Project Management", aliases: ["project management"] },
  { label: "Leadership", aliases: ["leadership"] },
  { label: "Communication", aliases: ["communication", "communications"] },
]

const BY_KEY = new Map<string, string>()
for (const skill of SKILL_DEFINITIONS) {
  BY_KEY.set(normalizeSkillKey(skill.label), skill.label)
  for (const alias of skill.aliases) {
    BY_KEY.set(normalizeSkillKey(alias), skill.label)
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function aliasPattern(alias: string) {
  return new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(alias)}([^a-z0-9+#.]|$)`, "i")
}

export function normalizeSkillKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\bnodejs\b/g, "node js")
    .replace(/\bnextjs\b/g, "next js")
    .replace(/\bpostgres\b/g, "postgresql")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function canonicalizeSkill(value: string) {
  const key = normalizeSkillKey(value)
  return BY_KEY.get(key) ?? value.trim()
}

export function normalizeSkillList(values: Array<string | null | undefined>, limit = Number.POSITIVE_INFINITY) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value?.trim()) continue
    const canonical = canonicalizeSkill(value)
    const key = normalizeSkillKey(canonical)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(canonical)
    if (out.length >= limit) break
  }
  return out
}

export function extractSkillsFromText(...parts: Array<string | null | undefined>) {
  const blob = parts.filter(Boolean).join(" ")
  if (!blob.trim()) return []

  const found: string[] = []
  for (const skill of SKILL_DEFINITIONS) {
    const matched =
      Boolean(skill.patterns?.some((pattern) => pattern.test(blob))) ||
      skill.aliases.some((alias) => aliasPattern(alias).test(blob))

    if (matched) found.push(skill.label)
  }

  return normalizeSkillList(found)
}

export function getAllResumeSkillLabels(resume: Pick<Resume, "skills" | "top_skills"> | null | undefined) {
  return normalizeSkillList([
    ...(resume?.top_skills ?? []),
    ...getSkillsBucketValues(resume?.skills ?? null),
  ])
}

export function getSkillsBucketValues(skills: Skills | null | undefined) {
  if (!skills) return []
  return [
    ...(skills.technical ?? []),
    ...(skills.soft ?? []),
    ...(skills.languages ?? []),
    ...(skills.certifications ?? []),
  ]
}

export function normalizeSkillsBuckets(skills: Skills | null | undefined): Skills {
  return {
    technical: normalizeSkillList(skills?.technical ?? []),
    soft: normalizeSkillList(skills?.soft ?? []),
    languages: normalizeSkillList(skills?.languages ?? []),
    certifications: normalizeSkillList(skills?.certifications ?? []),
  }
}

export function skillMatches(required: string, candidate: string) {
  const requiredKey = normalizeSkillKey(canonicalizeSkill(required))
  const candidateKey = normalizeSkillKey(canonicalizeSkill(candidate))
  if (!requiredKey || !candidateKey) return false
  return (
    requiredKey === candidateKey ||
    (requiredKey.length >= 3 && candidateKey.includes(requiredKey)) ||
    (candidateKey.length >= 3 && requiredKey.includes(candidateKey))
  )
}
