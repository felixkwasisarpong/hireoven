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
  category:
    | "language"
    | "framework"
    | "database"
    | "cloud"
    | "tool"
    | "method"
    | "ml"
    | "domain"
    | "retail"
    | "sales"
    | "healthcare"
    | "finance"
    | "marketing"
    | "hr"
    | "operations"
    | "soft"
    | "natlang"
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

  // Retail / Customer Service
  { canonical: "Customer Service", aliases: ["customer service", "customer support"], category: "retail" },
  { canonical: "POS Systems", aliases: ["point of sale", "pos system", "\\bPOS\\b"], category: "retail" },
  { canonical: "Cash Handling", aliases: ["cash handling", "cash register"], category: "retail" },
  { canonical: "Visual Merchandising", aliases: ["visual merchandising"], category: "retail" },
  { canonical: "Product Knowledge", aliases: ["product knowledge"], category: "retail" },
  { canonical: "Inventory Management", aliases: ["inventory management", "stock management"], category: "retail" },
  { canonical: "Loss Prevention", aliases: ["loss prevention"], category: "retail" },
  { canonical: "Retail Operations", aliases: ["retail operations"], category: "retail" },
  { canonical: "Restocking", aliases: ["restocking", "stocking shelves"], category: "retail" },
  { canonical: "Cashier", aliases: ["cashier"], category: "retail" },
  { canonical: "Upselling", aliases: ["upselling", "up-selling"], category: "retail" },
  { canonical: "Cross-selling", aliases: ["cross-selling", "cross selling"], category: "retail" },
  { canonical: "Merchandising", aliases: ["merchandising"], category: "retail" },
  { canonical: "Customer Experience", aliases: ["customer experience", "\\bCX\\b"], category: "retail" },
  { canonical: "Returns Processing", aliases: ["returns processing", "handling returns"], category: "retail" },

  // Sales / Account Management
  { canonical: "Salesforce", aliases: ["salesforce"], category: "sales" },
  { canonical: "HubSpot", aliases: ["hubspot"], category: "sales" },
  { canonical: "Cold Calling", aliases: ["cold calling", "cold call"], category: "sales" },
  { canonical: "B2B Sales", aliases: ["b2b sales", "b2b selling"], category: "sales" },
  { canonical: "B2C Sales", aliases: ["b2c sales"], category: "sales" },
  { canonical: "Pipeline Management", aliases: ["pipeline management", "sales pipeline"], category: "sales" },
  { canonical: "CRM", aliases: ["\\bCRM\\b", "customer relationship management"], category: "sales" },
  { canonical: "Account Management", aliases: ["account management"], category: "sales" },
  { canonical: "Lead Generation", aliases: ["lead generation", "lead gen"], category: "sales" },
  { canonical: "Sales Forecasting", aliases: ["sales forecasting"], category: "sales" },
  { canonical: "Sales Enablement", aliases: ["sales enablement"], category: "sales" },
  { canonical: "Outbound Sales", aliases: ["outbound sales", "outbound prospecting"], category: "sales" },
  { canonical: "Inbound Sales", aliases: ["inbound sales"], category: "sales" },
  { canonical: "Negotiation", aliases: ["negotiation"], category: "sales" },
  { canonical: "Customer Success", aliases: ["customer success"], category: "sales" },
  { canonical: "Sales Operations", aliases: ["sales operations", "sales ops"], category: "sales" },
  { canonical: "Quota Attainment", aliases: ["quota attainment", "quota carrying"], category: "sales" },
  { canonical: "Outreach", aliases: ["outreach\\.io", "outreach tool"], category: "sales" },
  { canonical: "Salesloft", aliases: ["salesloft"], category: "sales" },
  { canonical: "ZoomInfo", aliases: ["zoominfo"], category: "sales" },

  // Healthcare
  { canonical: "Registered Nurse", aliases: ["registered nurse", "\\bRN\\b"], category: "healthcare" },
  { canonical: "LPN", aliases: ["licensed practical nurse", "\\bLPN\\b"], category: "healthcare" },
  { canonical: "CPR Certified", aliases: ["\\bCPR\\b", "cpr certified", "cpr certification"], category: "healthcare" },
  { canonical: "EMR", aliases: ["electronic medical record", "\\bEMR\\b"], category: "healthcare" },
  { canonical: "EHR", aliases: ["electronic health record", "\\bEHR\\b"], category: "healthcare" },
  { canonical: "Epic", aliases: ["epic systems", "epic emr"], category: "healthcare" },
  { canonical: "Cerner", aliases: ["cerner"], category: "healthcare" },
  { canonical: "HIPAA", aliases: ["\\bHIPAA\\b"], category: "healthcare" },
  { canonical: "Phlebotomy", aliases: ["phlebotomy", "phlebotomist"], category: "healthcare" },
  { canonical: "Patient Care", aliases: ["patient care"], category: "healthcare" },
  { canonical: "Triage", aliases: ["triage"], category: "healthcare" },
  { canonical: "Vital Signs", aliases: ["vital signs"], category: "healthcare" },
  { canonical: "IV Therapy", aliases: ["iv therapy", "intravenous therapy"], category: "healthcare" },
  { canonical: "Medication Administration", aliases: ["medication administration"], category: "healthcare" },
  { canonical: "Wound Care", aliases: ["wound care"], category: "healthcare" },
  { canonical: "ICU", aliases: ["\\bICU\\b", "intensive care unit"], category: "healthcare" },
  { canonical: "Pediatrics", aliases: ["pediatrics", "pediatric"], category: "healthcare" },
  { canonical: "Pharmacology", aliases: ["pharmacology"], category: "healthcare" },
  { canonical: "BLS", aliases: ["\\bBLS\\b", "basic life support"], category: "healthcare" },
  // ACLS healthcare alias deliberately omits the bare "\bACLS\b" — too easy
  // to collide with "Access Control Lists" in networking/security JDs. Only
  // match the full phrase or a "ACLS certified" context.
  { canonical: "ACLS", aliases: ["advanced cardiac life support", "acls certified", "acls certification"], category: "healthcare" },

  // Finance / Accounting
  { canonical: "GAAP", aliases: ["\\bGAAP\\b"], category: "finance" },
  { canonical: "IFRS", aliases: ["\\bIFRS\\b"], category: "finance" },
  { canonical: "QuickBooks", aliases: ["quickbooks"], category: "finance" },
  { canonical: "SAP", aliases: ["sap erp", "sap hana", "sap s/4"], category: "finance" },
  { canonical: "Reconciliation", aliases: ["reconciliation", "account reconciliation"], category: "finance" },
  { canonical: "Audit", aliases: ["financial audit", "internal audit", "external audit"], category: "finance" },
  { canonical: "Tax Preparation", aliases: ["tax preparation", "tax filing"], category: "finance" },
  { canonical: "Accounts Payable", aliases: ["accounts payable"], category: "finance" },
  { canonical: "Accounts Receivable", aliases: ["accounts receivable"], category: "finance" },
  { canonical: "Budgeting", aliases: ["budgeting", "budget management"], category: "finance" },
  { canonical: "Financial Reporting", aliases: ["financial reporting"], category: "finance" },
  { canonical: "Financial Modeling", aliases: ["financial modeling", "financial modelling"], category: "finance" },
  { canonical: "Forecasting", aliases: ["financial forecasting"], category: "finance" },
  { canonical: "Excel", aliases: ["microsoft excel", "ms excel", "advanced excel"], category: "finance" },
  { canonical: "Pivot Tables", aliases: ["pivot tables", "pivot table"], category: "finance" },
  { canonical: "Variance Analysis", aliases: ["variance analysis"], category: "finance" },
  { canonical: "Cost Accounting", aliases: ["cost accounting"], category: "finance" },
  { canonical: "Payroll", aliases: ["payroll processing", "payroll administration"], category: "finance" },
  { canonical: "Bookkeeping", aliases: ["bookkeeping", "bookkeeper"], category: "finance" },
  { canonical: "CPA", aliases: ["\\bCPA\\b", "certified public accountant"], category: "finance" },

  // Marketing
  { canonical: "SEO", aliases: ["\\bSEO\\b", "search engine optimization"], category: "marketing" },
  { canonical: "SEM", aliases: ["\\bSEM\\b", "search engine marketing"], category: "marketing" },
  { canonical: "Google Analytics", aliases: ["google analytics", "\\bGA4\\b"], category: "marketing" },
  { canonical: "Google Ads", aliases: ["google ads", "google adwords"], category: "marketing" },
  { canonical: "Facebook Ads", aliases: ["facebook ads", "meta ads"], category: "marketing" },
  { canonical: "Mailchimp", aliases: ["mailchimp"], category: "marketing" },
  { canonical: "Marketo", aliases: ["marketo"], category: "marketing" },
  { canonical: "Content Marketing", aliases: ["content marketing"], category: "marketing" },
  { canonical: "Social Media Marketing", aliases: ["social media marketing", "smm"], category: "marketing" },
  { canonical: "A/B Testing", aliases: ["a/b testing", "split testing"], category: "marketing" },
  { canonical: "Email Marketing", aliases: ["email marketing", "email campaigns"], category: "marketing" },
  { canonical: "Marketing Automation", aliases: ["marketing automation"], category: "marketing" },
  { canonical: "Brand Management", aliases: ["brand management", "brand strategy"], category: "marketing" },
  { canonical: "Copywriting", aliases: ["copywriting", "copy writing"], category: "marketing" },
  { canonical: "Adobe Creative Suite", aliases: ["adobe creative suite", "creative cloud"], category: "marketing" },
  { canonical: "Photoshop", aliases: ["photoshop"], category: "marketing" },
  { canonical: "Figma", aliases: ["figma"], category: "marketing" },
  { canonical: "Canva", aliases: ["canva"], category: "marketing" },
  { canonical: "Influencer Marketing", aliases: ["influencer marketing"], category: "marketing" },
  { canonical: "Performance Marketing", aliases: ["performance marketing"], category: "marketing" },

  // HR / Recruiting
  { canonical: "ATS", aliases: ["applicant tracking system", "\\bATS\\b"], category: "hr" },
  { canonical: "Onboarding", aliases: ["onboarding", "new-hire orientation"], category: "hr" },
  { canonical: "Compensation", aliases: ["compensation planning", "comp & benefits"], category: "hr" },
  { canonical: "Benefits Administration", aliases: ["benefits administration"], category: "hr" },
  { canonical: "Employee Relations", aliases: ["employee relations"], category: "hr" },
  { canonical: "HRIS", aliases: ["\\bHRIS\\b"], category: "hr" },
  { canonical: "Performance Management", aliases: ["performance management", "performance reviews"], category: "hr" },
  { canonical: "Talent Acquisition", aliases: ["talent acquisition"], category: "hr" },
  { canonical: "Recruiting", aliases: ["technical recruiting", "full-cycle recruiting", "sourcing candidates"], category: "hr" },
  { canonical: "DEI", aliases: ["diversity equity inclusion", "diversity and inclusion", "\\bDEI\\b"], category: "hr" },
  { canonical: "Employee Engagement", aliases: ["employee engagement"], category: "hr" },
  { canonical: "Training & Development", aliases: ["training and development", "learning and development", "\\bL&D\\b"], category: "hr" },

  // Operations / Supply Chain
  { canonical: "Lean", aliases: ["lean manufacturing", "lean methodology", "lean process"], category: "operations" },
  { canonical: "Six Sigma", aliases: ["six sigma", "lean six sigma"], category: "operations" },
  { canonical: "ERP", aliases: ["\\bERP\\b", "enterprise resource planning"], category: "operations" },
  { canonical: "Logistics", aliases: ["logistics"], category: "operations" },
  { canonical: "Procurement", aliases: ["procurement", "purchasing"], category: "operations" },
  { canonical: "Supply Chain Management", aliases: ["supply chain management", "scm"], category: "operations" },
  { canonical: "Warehouse Management", aliases: ["warehouse management", "wms"], category: "operations" },
  { canonical: "Vendor Management", aliases: ["vendor management"], category: "operations" },
  { canonical: "Process Improvement", aliases: ["process improvement", "continuous improvement"], category: "operations" },
  { canonical: "Operations Management", aliases: ["operations management"], category: "operations" },
  { canonical: "Project Management", aliases: ["project management"], category: "operations" },
  { canonical: "PMP", aliases: ["\\bPMP\\b", "project management professional"], category: "operations" },

  // Soft skills
  { canonical: "Communication", aliases: ["written communication", "verbal communication", "strong communicator"], category: "soft" },
  { canonical: "Teamwork", aliases: ["teamwork"], category: "soft" },
  { canonical: "Leadership", aliases: ["leadership skills", "team lead", "people leadership"], category: "soft" },
  { canonical: "Problem Solving", aliases: ["problem solving", "problem-solving"], category: "soft" },
  { canonical: "Mentorship", aliases: ["mentorship", "mentoring", "coaching"], category: "soft" },
  { canonical: "Cross-functional Collaboration", aliases: ["cross-functional", "cross functional"], category: "soft" },
  { canonical: "Critical Thinking", aliases: ["critical thinking"], category: "soft" },
  { canonical: "Time Management", aliases: ["time management"], category: "soft" },
  { canonical: "Conflict Resolution", aliases: ["conflict resolution"], category: "soft" },
  { canonical: "Stakeholder Management", aliases: ["stakeholder management"], category: "soft" },
  { canonical: "Public Speaking", aliases: ["public speaking", "presentation skills"], category: "soft" },
  { canonical: "Attention to Detail", aliases: ["attention to detail", "detail-oriented", "detail oriented"], category: "soft" },

  // Languages (natural)
  { canonical: "Bilingual", aliases: ["bilingual"], category: "natlang" },
  { canonical: "Spanish", aliases: ["fluent in spanish", "spanish speaking", "spanish-speaking"], category: "natlang" },
  { canonical: "French", aliases: ["fluent in french", "french speaking", "french-speaking"], category: "natlang" },
  { canonical: "Mandarin", aliases: ["mandarin", "mandarin chinese"], category: "natlang" },
  { canonical: "Cantonese", aliases: ["cantonese"], category: "natlang" },
  { canonical: "German", aliases: ["fluent in german", "german speaking"], category: "natlang" },
  { canonical: "Japanese", aliases: ["fluent in japanese", "japanese speaking"], category: "natlang" },
  { canonical: "Korean", aliases: ["fluent in korean", "korean speaking"], category: "natlang" },
  { canonical: "Portuguese", aliases: ["fluent in portuguese", "brazilian portuguese"], category: "natlang" },
  { canonical: "ASL", aliases: ["american sign language", "\\bASL\\b"], category: "natlang" },
]
