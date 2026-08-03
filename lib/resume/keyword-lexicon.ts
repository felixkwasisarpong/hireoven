/**
 * JD keyword lexicon — the deterministic "brain" behind resume↔JD keyword matching.
 *
 * The previous engine anchored JD understanding to a 33-word hardcoded list plus a
 * skills taxonomy that is thin on modern GenAI / cloud / data tooling. For an AI /
 * data / platform role that meant the terms that actually differentiate a candidate
 * (Azure OpenAI, Snowflake, LangGraph, RAG, MLOps, vector databases, …) were never
 * surfaced as present-or-missing, and the match score was computed over a keyword
 * universe that didn't contain them.
 *
 * This module provides:
 *   - A curated, alias-aware lexicon of concrete technologies / tools / platforms /
 *     methodologies grouped by category.
 *   - `matchTermInText` — boundary-aware matching that understands aliases and
 *     multi-word phrases without the substring false-positives of naive `.includes`.
 *   - `extractJdTechTerms` — pull the canonical tech terms a job description actually
 *     asks for, ordered by prominence.
 *
 * It is intentionally deterministic (no LLM) so it works with no API key, runs fast,
 * and gives the LLM a grounded keyword frame to work from rather than replacing it.
 */

import { normalizeKeyword } from "@/lib/resume/hub"

export type LexiconCategory =
  | "language"
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "devops"
  | "mlops"
  | "data"
  | "ai_ml"
  | "genai"
  | "vector"
  | "messaging"
  | "observability"
  | "integration"
  | "methodology"

export interface LexiconEntry {
  /** Display / résumé-ready canonical form. */
  canonical: string
  /** Alternate spellings, abbreviations, and phrasings that mean the same thing. */
  aliases: string[]
  category: LexiconCategory
}

/**
 * The lexicon. Keep entries to CONCRETE tools / languages / platforms / frameworks /
 * named methodologies — never soft skills or hiring adjectives (those are filtered
 * elsewhere as noise). Aliases should be lowercase; matching normalizes both sides.
 */
export const KEYWORD_LEXICON: readonly LexiconEntry[] = [
  // ── Languages ──────────────────────────────────────────────────────────────
  { canonical: "Python", aliases: ["python3", "py"], category: "language" },
  { canonical: "Java", aliases: [], category: "language" },
  { canonical: "TypeScript", aliases: ["ts"], category: "language" },
  { canonical: "JavaScript", aliases: ["js", "ecmascript"], category: "language" },
  { canonical: "Go", aliases: ["golang"], category: "language" },
  { canonical: "Rust", aliases: [], category: "language" },
  { canonical: "C++", aliases: ["cpp"], category: "language" },
  { canonical: "C#", aliases: ["csharp", "c sharp", ".net", "dotnet"], category: "language" },
  { canonical: "Scala", aliases: [], category: "language" },
  { canonical: "Ruby", aliases: [], category: "language" },
  { canonical: "PHP", aliases: [], category: "language" },
  { canonical: "SQL", aliases: [], category: "language" },
  { canonical: "Bash", aliases: ["shell scripting", "shell"], category: "language" },
  { canonical: "R", aliases: [], category: "language" },

  // ── Frontend ───────────────────────────────────────────────────────────────
  { canonical: "React", aliases: ["react.js", "reactjs"], category: "frontend" },
  { canonical: "Next.js", aliases: ["nextjs", "next js"], category: "frontend" },
  { canonical: "Vue", aliases: ["vue.js", "vuejs"], category: "frontend" },
  { canonical: "Angular", aliases: [], category: "frontend" },
  { canonical: "Svelte", aliases: ["sveltekit"], category: "frontend" },
  { canonical: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"], category: "frontend" },

  // ── Backend / frameworks ─────────────────────────────────────────────────────
  { canonical: "FastAPI", aliases: ["fast api"], category: "backend" },
  { canonical: "Flask", aliases: [], category: "backend" },
  { canonical: "Django", aliases: [], category: "backend" },
  { canonical: "Spring Boot", aliases: ["spring"], category: "backend" },
  { canonical: "Node.js", aliases: ["nodejs", "node"], category: "backend" },
  { canonical: "Express", aliases: ["express.js", "expressjs"], category: "backend" },
  { canonical: "NestJS", aliases: ["nest.js"], category: "backend" },
  { canonical: ".NET", aliases: ["asp.net", "dotnet"], category: "backend" },
  { canonical: "gRPC", aliases: [], category: "backend" },
  { canonical: "GraphQL", aliases: [], category: "backend" },
  { canonical: "REST APIs", aliases: ["rest api", "restful", "restful apis", "rest"], category: "backend" },
  { canonical: "SOAP", aliases: ["soap/xml", "soap api"], category: "backend" },
  { canonical: "Microservices", aliases: ["microservice", "micro-services"], category: "backend" },

  // ── Databases ────────────────────────────────────────────────────────────────
  { canonical: "PostgreSQL", aliases: ["postgres", "psql"], category: "database" },
  { canonical: "MySQL", aliases: [], category: "database" },
  { canonical: "MongoDB", aliases: ["mongo"], category: "database" },
  { canonical: "Redis", aliases: [], category: "database" },
  { canonical: "Elasticsearch", aliases: ["elastic search", "opensearch"], category: "database" },
  { canonical: "DynamoDB", aliases: ["dynamo"], category: "database" },
  { canonical: "Oracle", aliases: ["oracle db", "oracle database"], category: "database" },
  { canonical: "SQL Server", aliases: ["mssql", "microsoft sql server"], category: "database" },
  { canonical: "Cassandra", aliases: [], category: "database" },

  // ── Cloud ────────────────────────────────────────────────────────────────────
  { canonical: "AWS", aliases: ["amazon web services", "ec2", "lambda", "s3"], category: "cloud" },
  { canonical: "Azure", aliases: ["microsoft azure"], category: "cloud" },
  { canonical: "GCP", aliases: ["google cloud", "google cloud platform"], category: "cloud" },
  { canonical: "Azure OpenAI", aliases: ["azure open ai", "azure openai service", "aoai"], category: "cloud" },
  { canonical: "AWS Bedrock", aliases: ["bedrock", "amazon bedrock"], category: "cloud" },
  { canonical: "Vertex AI", aliases: ["google vertex", "vertex"], category: "cloud" },
  { canonical: "AWS SageMaker", aliases: ["sagemaker"], category: "cloud" },

  // ── Data / analytics ─────────────────────────────────────────────────────────
  { canonical: "Snowflake", aliases: [], category: "data" },
  { canonical: "Databricks", aliases: [], category: "data" },
  { canonical: "Spark", aliases: ["apache spark", "pyspark"], category: "data" },
  { canonical: "Airflow", aliases: ["apache airflow"], category: "data" },
  { canonical: "dbt", aliases: ["data build tool"], category: "data" },
  { canonical: "BigQuery", aliases: ["big query"], category: "data" },
  { canonical: "Data Pipelines", aliases: ["data pipeline", "etl", "elt"], category: "data" },
  { canonical: "Data Warehouse", aliases: ["data warehousing", "lakehouse", "data lake"], category: "data" },

  // ── DevOps ───────────────────────────────────────────────────────────────────
  { canonical: "Docker", aliases: ["docker compose", "containerization", "containers"], category: "devops" },
  { canonical: "Kubernetes", aliases: ["k8s", "k8", "kube"], category: "devops" },
  { canonical: "Terraform", aliases: ["infrastructure as code", "iac"], category: "devops" },
  { canonical: "CI/CD", aliases: ["cicd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"], category: "devops" },
  { canonical: "GitHub Actions", aliases: ["github action"], category: "devops" },
  { canonical: "Jenkins", aliases: [], category: "devops" },
  { canonical: "GitLab CI", aliases: ["gitlab ci/cd"], category: "devops" },
  { canonical: "Helm", aliases: [], category: "devops" },
  { canonical: "ArgoCD", aliases: ["argo cd"], category: "devops" },

  // ── MLOps ────────────────────────────────────────────────────────────────────
  { canonical: "MLOps", aliases: ["ml ops", "machine learning operations"], category: "mlops" },
  { canonical: "MLflow", aliases: ["ml flow"], category: "mlops" },
  { canonical: "Kubeflow", aliases: [], category: "mlops" },
  { canonical: "Model Monitoring", aliases: ["model observability", "model drift"], category: "mlops" },
  { canonical: "Feature Store", aliases: [], category: "mlops" },

  // ── Core AI / ML ──────────────────────────────────────────────────────────────
  { canonical: "Machine Learning", aliases: ["ml", "machine-learning"], category: "ai_ml" },
  { canonical: "Deep Learning", aliases: ["neural networks", "neural network"], category: "ai_ml" },
  { canonical: "NLP", aliases: ["natural language processing"], category: "ai_ml" },
  { canonical: "Computer Vision", aliases: ["cv"], category: "ai_ml" },
  { canonical: "PyTorch", aliases: ["torch"], category: "ai_ml" },
  { canonical: "TensorFlow", aliases: ["tf"], category: "ai_ml" },
  { canonical: "scikit-learn", aliases: ["sklearn", "scikit learn"], category: "ai_ml" },
  { canonical: "Hugging Face", aliases: ["huggingface", "transformers"], category: "ai_ml" },
  { canonical: "Fine-tuning", aliases: ["fine tuning", "finetuning", "lora", "peft"], category: "ai_ml" },

  // ── GenAI / agents ───────────────────────────────────────────────────────────
  { canonical: "LLM", aliases: ["llms", "large language model", "large language models"], category: "genai" },
  { canonical: "Generative AI", aliases: ["genai", "gen ai", "generative ai"], category: "genai" },
  { canonical: "RAG", aliases: ["retrieval augmented generation", "retrieval-augmented generation"], category: "genai" },
  { canonical: "LangChain", aliases: [], category: "genai" },
  { canonical: "LangGraph", aliases: [], category: "genai" },
  { canonical: "LlamaIndex", aliases: ["llama index", "llama-index"], category: "genai" },
  { canonical: "AutoGen", aliases: ["auto gen", "auto-gen"], category: "genai" },
  { canonical: "CrewAI", aliases: ["crew ai"], category: "genai" },
  { canonical: "Semantic Kernel", aliases: [], category: "genai" },
  { canonical: "OpenAI", aliases: ["gpt-4", "gpt4", "gpt-4o", "chatgpt", "gpt"], category: "genai" },
  { canonical: "Anthropic Claude", aliases: ["anthropic", "claude"], category: "genai" },
  { canonical: "Ollama", aliases: [], category: "genai" },
  { canonical: "MCP", aliases: ["model context protocol"], category: "genai" },
  { canonical: "Multi-agent Orchestration", aliases: ["multi-agent", "multi agent", "multiagent", "agent orchestration", "agentic"], category: "genai" },
  { canonical: "AI Agents", aliases: ["ai agent", "autonomous agents", "autonomous agent", "copilot", "copilots"], category: "genai" },
  { canonical: "Prompt Engineering", aliases: ["prompt design", "prompting"], category: "genai" },
  { canonical: "Embeddings", aliases: ["embedding", "text embeddings"], category: "genai" },

  // ── Vector search ─────────────────────────────────────────────────────────────
  { canonical: "Vector Database", aliases: ["vector db", "vector store", "vector search"], category: "vector" },
  { canonical: "FAISS", aliases: [], category: "vector" },
  { canonical: "Pinecone", aliases: [], category: "vector" },
  { canonical: "Weaviate", aliases: [], category: "vector" },
  { canonical: "Chroma", aliases: ["chromadb"], category: "vector" },
  { canonical: "pgvector", aliases: ["pg vector"], category: "vector" },
  { canonical: "Qdrant", aliases: [], category: "vector" },

  // ── Messaging / streaming ─────────────────────────────────────────────────────
  { canonical: "Kafka", aliases: ["apache kafka", "event streaming", "event stream"], category: "messaging" },
  { canonical: "RabbitMQ", aliases: ["rabbit mq"], category: "messaging" },
  { canonical: "JMS", aliases: [], category: "messaging" },
  { canonical: "SQS", aliases: ["amazon sqs"], category: "messaging" },

  // ── Observability ─────────────────────────────────────────────────────────────
  { canonical: "Datadog", aliases: ["data dog"], category: "observability" },
  { canonical: "Prometheus", aliases: [], category: "observability" },
  { canonical: "Grafana", aliases: [], category: "observability" },
  { canonical: "CloudWatch", aliases: ["cloud watch"], category: "observability" },
  { canonical: "OpenTelemetry", aliases: ["otel", "open telemetry"], category: "observability" },

  // ── Enterprise integration ────────────────────────────────────────────────────
  { canonical: "Salesforce", aliases: ["sfdc"], category: "integration" },
  { canonical: "SAP", aliases: [], category: "integration" },
  { canonical: "AS400", aliases: ["as/400", "ibm i", "iseries", "as 400"], category: "integration" },
  { canonical: "ServiceNow", aliases: ["service now"], category: "integration" },
  { canonical: "ISO 8583", aliases: ["iso8583"], category: "integration" },

  // ── Methodologies ─────────────────────────────────────────────────────────────
  { canonical: "Agile", aliases: ["scrum", "kanban"], category: "methodology" },
  { canonical: "Event-Driven Architecture", aliases: ["event driven", "event-driven"], category: "methodology" },
  { canonical: "Distributed Systems", aliases: ["distributed system"], category: "methodology" },
  { canonical: "A/B Testing", aliases: ["ab testing", "a b testing", "experimentation"], category: "methodology" },
  { canonical: "Data Privacy", aliases: ["data governance", "pii", "gdpr", "soc 2", "soc2"], category: "methodology" },
] as const

// ── Matching ────────────────────────────────────────────────────────────────

const termRegexCache = new Map<string, RegExp>()

/**
 * Build a boundary-aware, alias-normalized regex for a single term. Handles
 * multi-word phrases (flexible whitespace) and technology punctuation
 * (Next.js, CI/CD, C++, C#) without the substring false-positives of `.includes`
 * (e.g. "RAG" must not match "storage", "Go" must not match "going").
 */
function buildTermRegex(term: string): RegExp {
  const cached = termRegexCache.get(term)
  if (cached) return cached
  const normalized = normalizeKeyword(term)
  const escapedWords = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+")
  // Leading/trailing guards: a term must not be flanked by another alphanumeric
  // character. `+` and `#` are legal trailing chars (C++, C#), so they are not
  // treated as word characters for the boundary check.
  const source = `(?<![a-z0-9])${escapedWords}(?![a-z0-9])`
  const re = new RegExp(source, "i")
  termRegexCache.set(term, re)
  return re
}

/** True if `term` (or any alias, when an entry is passed) appears in `text`. */
export function matchTermInText(term: string, text: string): boolean {
  if (!term || !text) return false
  return buildTermRegex(term).test(text)
}

/** True if the canonical form OR any alias of `entry` appears in `text`. */
export function matchEntryInText(entry: LexiconEntry, text: string): boolean {
  if (matchTermInText(entry.canonical, text)) return true
  for (const alias of entry.aliases) {
    if (matchTermInText(alias, text)) return true
  }
  return false
}

/** Count how many times any surface form of the entry appears (for prominence ordering). */
function countEntryHits(entry: LexiconEntry, text: string): number {
  const forms = [entry.canonical, ...entry.aliases]
  let count = 0
  for (const form of forms) {
    const normalized = normalizeKeyword(form)
    const escapedWords = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")
    const re = new RegExp(`(?<![a-z0-9])${escapedWords}(?![a-z0-9])`, "gi")
    count += (text.match(re) ?? []).length
  }
  return count
}

const CANONICAL_BY_NORM: Map<string, LexiconEntry> = (() => {
  const map = new Map<string, LexiconEntry>()
  for (const entry of KEYWORD_LEXICON) {
    map.set(normalizeKeyword(entry.canonical), entry)
    for (const alias of entry.aliases) map.set(normalizeKeyword(alias), entry)
  }
  return map
})()

/** Resolve any surface form (canonical or alias) to its canonical display term. */
export function canonicalizeLexiconTerm(term: string): string | null {
  return CANONICAL_BY_NORM.get(normalizeKeyword(term))?.canonical ?? null
}

/** Look up a full lexicon entry from any surface form. */
export function lexiconEntryFor(term: string): LexiconEntry | null {
  return CANONICAL_BY_NORM.get(normalizeKeyword(term)) ?? null
}

/**
 * Extract the canonical tech terms a job description actually asks for, ordered by
 * prominence (mention frequency, then lexicon order for stability). This is the
 * deterministic keyword frame that scoring and the LLM both build on.
 */
export function extractJdTechTerms(jd: string, limit = 40): string[] {
  if (!jd || !jd.trim()) return []
  const hits: { canonical: string; count: number; order: number }[] = []
  KEYWORD_LEXICON.forEach((entry, order) => {
    const count = countEntryHits(entry, jd)
    if (count > 0) hits.push({ canonical: entry.canonical, count, order })
  })
  hits.sort((a, b) => b.count - a.count || a.order - b.order)
  return hits.slice(0, limit).map((h) => h.canonical)
}

/** All alias surface forms for a canonical term — used for indirect-evidence checks. */
export function aliasesForCanonical(canonical: string): string[] {
  const entry = CANONICAL_BY_NORM.get(normalizeKeyword(canonical))
  return entry ? [...entry.aliases] : []
}
