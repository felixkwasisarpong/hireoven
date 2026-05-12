/**
 * Curated skill dictionary for batch enrichment.
 *
 * Each entry: a canonical skill name + a list of aliases (case-insensitive,
 * matched with word boundaries). The matcher returns the canonical form; the
 * caller unions with whatever the normalizer already produced.
 *
 * Aliases should NEVER be substrings of common English words — e.g. "AI" is
 * deliberately excluded as a standalone alias because it appears inside
 * "available", "training", "details", etc. Use only forms that are
 * unambiguous at word boundaries.
 */

export type SkillEntry = {
  canonical: string
  aliases: string[]
  category: "language" | "framework" | "database" | "cloud" | "tool" | "method" | "ml" | "domain"
}

export const SKILL_DICTIONARY: SkillEntry[] = [
  // Programming languages
  { canonical: "JavaScript", aliases: ["javascript", "ecmascript"], category: "language" },
  { canonical: "TypeScript", aliases: ["typescript"], category: "language" },
  { canonical: "Python", aliases: ["python"], category: "language" },
  { canonical: "Go", aliases: ["golang", "go-lang"], category: "language" },
  { canonical: "Rust", aliases: ["rustlang"], category: "language" },
  { canonical: "Java", aliases: ["java"], category: "language" },
  { canonical: "Kotlin", aliases: ["kotlin"], category: "language" },
  { canonical: "Swift", aliases: ["swift"], category: "language" },
  { canonical: "Ruby", aliases: ["ruby"], category: "language" },
  { canonical: "PHP", aliases: ["php"], category: "language" },
  { canonical: "C++", aliases: ["c\\+\\+", "cpp"], category: "language" },
  { canonical: "C#", aliases: ["c#", "csharp"], category: "language" },
  { canonical: "Scala", aliases: ["scala"], category: "language" },
  { canonical: "Elixir", aliases: ["elixir"], category: "language" },
  { canonical: "Haskell", aliases: ["haskell"], category: "language" },
  { canonical: "Clojure", aliases: ["clojure"], category: "language" },
  { canonical: "R", aliases: ["\\br language\\b", "r programming"], category: "language" }, // require disambiguation
  { canonical: "SQL", aliases: ["sql"], category: "language" },
  { canonical: "Bash", aliases: ["bash", "shell scripting"], category: "language" },
  { canonical: "Solidity", aliases: ["solidity"], category: "language" },

  // Frontend frameworks
  { canonical: "React", aliases: ["react", "react\\.js", "reactjs"], category: "framework" },
  { canonical: "Vue", aliases: ["vue\\.js", "vuejs", "vue 3"], category: "framework" },
  { canonical: "Angular", aliases: ["angular"], category: "framework" },
  { canonical: "Svelte", aliases: ["svelte", "sveltekit"], category: "framework" },
  { canonical: "Next.js", aliases: ["next\\.js", "nextjs"], category: "framework" },
  { canonical: "Nuxt", aliases: ["nuxt", "nuxt\\.js"], category: "framework" },
  { canonical: "Remix", aliases: ["remix\\.run", "remix framework"], category: "framework" },
  { canonical: "Astro", aliases: ["astro\\.build", "astro framework"], category: "framework" },

  // Backend frameworks
  { canonical: "Node.js", aliases: ["node\\.js", "nodejs", "node js"], category: "framework" },
  { canonical: "Express", aliases: ["express\\.js", "expressjs"], category: "framework" },
  { canonical: "Django", aliases: ["django"], category: "framework" },
  { canonical: "Flask", aliases: ["flask"], category: "framework" },
  { canonical: "FastAPI", aliases: ["fastapi", "fast api"], category: "framework" },
  { canonical: "Rails", aliases: ["ruby on rails", "rails framework"], category: "framework" },
  { canonical: "Spring", aliases: ["spring boot", "spring framework"], category: "framework" },
  { canonical: ".NET", aliases: ["\\.net", "dotnet"], category: "framework" },
  { canonical: "Laravel", aliases: ["laravel"], category: "framework" },
  { canonical: "NestJS", aliases: ["nest\\.js", "nestjs"], category: "framework" },
  { canonical: "tRPC", aliases: ["trpc"], category: "framework" },

  // Databases
  { canonical: "PostgreSQL", aliases: ["postgresql", "postgres"], category: "database" },
  { canonical: "MySQL", aliases: ["mysql"], category: "database" },
  { canonical: "MongoDB", aliases: ["mongodb", "mongo db"], category: "database" },
  { canonical: "Redis", aliases: ["redis"], category: "database" },
  { canonical: "Cassandra", aliases: ["cassandra"], category: "database" },
  { canonical: "DynamoDB", aliases: ["dynamodb", "dynamo db"], category: "database" },
  { canonical: "Snowflake", aliases: ["snowflake"], category: "database" },
  { canonical: "BigQuery", aliases: ["bigquery", "big query"], category: "database" },
  { canonical: "ClickHouse", aliases: ["clickhouse"], category: "database" },
  { canonical: "Elasticsearch", aliases: ["elasticsearch", "elastic search"], category: "database" },
  { canonical: "Kafka", aliases: ["kafka", "apache kafka"], category: "tool" },
  { canonical: "SQLite", aliases: ["sqlite"], category: "database" },
  { canonical: "Supabase", aliases: ["supabase"], category: "database" },
  { canonical: "Firebase", aliases: ["firebase"], category: "database" },
  { canonical: "Prisma", aliases: ["prisma"], category: "framework" },

  // Cloud
  { canonical: "AWS", aliases: ["aws", "amazon web services"], category: "cloud" },
  { canonical: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"], category: "cloud" },
  { canonical: "Azure", aliases: ["microsoft azure", "azure cloud"], category: "cloud" },
  { canonical: "Kubernetes", aliases: ["kubernetes", "k8s"], category: "cloud" },
  { canonical: "Docker", aliases: ["docker"], category: "cloud" },
  { canonical: "Terraform", aliases: ["terraform"], category: "cloud" },
  { canonical: "Pulumi", aliases: ["pulumi"], category: "cloud" },
  { canonical: "Cloudflare", aliases: ["cloudflare"], category: "cloud" },
  { canonical: "Vercel", aliases: ["vercel"], category: "cloud" },
  { canonical: "Netlify", aliases: ["netlify"], category: "cloud" },

  // ML / AI
  { canonical: "TensorFlow", aliases: ["tensorflow", "tensor flow"], category: "ml" },
  { canonical: "PyTorch", aliases: ["pytorch", "py torch"], category: "ml" },
  { canonical: "Keras", aliases: ["keras"], category: "ml" },
  { canonical: "scikit-learn", aliases: ["scikit-learn", "sklearn", "scikit learn"], category: "ml" },
  { canonical: "LangChain", aliases: ["langchain", "lang chain"], category: "ml" },
  { canonical: "Machine Learning", aliases: ["machine learning"], category: "ml" },
  { canonical: "Deep Learning", aliases: ["deep learning"], category: "ml" },
  { canonical: "NLP", aliases: ["natural language processing", "\\bnlp\\b"], category: "ml" },
  { canonical: "Computer Vision", aliases: ["computer vision"], category: "ml" },
  { canonical: "MLOps", aliases: ["mlops"], category: "ml" },
  { canonical: "LLM", aliases: ["large language model", "\\bllm\\b", "\\bllms\\b"], category: "ml" },

  // Tools
  { canonical: "Git", aliases: ["\\bgit\\b"], category: "tool" },
  { canonical: "GitHub Actions", aliases: ["github actions"], category: "tool" },
  { canonical: "CircleCI", aliases: ["circleci", "circle ci"], category: "tool" },
  { canonical: "Jenkins", aliases: ["jenkins"], category: "tool" },
  { canonical: "Ansible", aliases: ["ansible"], category: "tool" },
  { canonical: "Datadog", aliases: ["datadog", "data dog"], category: "tool" },
  { canonical: "Splunk", aliases: ["splunk"], category: "tool" },
  { canonical: "Prometheus", aliases: ["prometheus"], category: "tool" },
  { canonical: "Grafana", aliases: ["grafana"], category: "tool" },
  { canonical: "Sentry", aliases: ["sentry\\.io", "sentry monitoring"], category: "tool" },

  // Methodologies
  { canonical: "Agile", aliases: ["agile"], category: "method" },
  { canonical: "Scrum", aliases: ["scrum"], category: "method" },
  { canonical: "Kanban", aliases: ["kanban"], category: "method" },
  { canonical: "CI/CD", aliases: ["ci/cd", "ci-cd", "continuous integration"], category: "method" },
  { canonical: "TDD", aliases: ["test-driven development", "\\btdd\\b"], category: "method" },
  { canonical: "DevOps", aliases: ["devops", "dev ops"], category: "method" },
  { canonical: "SRE", aliases: ["site reliability engineering", "\\bsre\\b"], category: "method" },
  { canonical: "Microservices", aliases: ["microservices", "micro services"], category: "method" },
  { canonical: "REST", aliases: ["\\brest api\\b", "restful api"], category: "method" },
  { canonical: "GraphQL", aliases: ["graphql", "graph ql"], category: "method" },
  { canonical: "gRPC", aliases: ["grpc"], category: "method" },

  // Domain
  { canonical: "Security", aliases: ["cybersecurity", "infosec", "information security"], category: "domain" },
  { canonical: "Mobile", aliases: ["ios development", "android development", "mobile development"], category: "domain" },
  { canonical: "Embedded", aliases: ["embedded systems", "firmware"], category: "domain" },
  { canonical: "Blockchain", aliases: ["blockchain", "web3"], category: "domain" },
  { canonical: "Data Engineering", aliases: ["data engineering", "data engineer"], category: "domain" },
  { canonical: "Data Science", aliases: ["data science", "data scientist"], category: "domain" },
]
