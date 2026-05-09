import type { Resume, Skills } from "@/types"

type SkillDefinition = {
  label: string
  aliases: string[]
  patterns?: RegExp[]
  /**
   * When true, the skill is only matched via `patterns` (not raw aliases).
   * Use for skills whose aliases are common English words that produce false
   * positives in non-technical text (e.g. "Rust" → "rust", "ML" → "ml").
   */
  requiresPattern?: boolean
}

export type SkillCategory =
  | "programmingLanguages"
  | "frameworks"
  | "cloud"
  | "databases"
  | "devops"
  | "aiMl"
  | "data"
  | "security"
  | "engineering"
  | "testing"
  | "networking"
  | "media"
  | "healthcare"
  | "science"
  | "softSkills"

export type CategorizedSkills = Record<SkillCategory, string[]>

const GO_LANGUAGE_SIGNAL_RE =
  /\b(?:go\s+language|go\s+(?:developer|engineer|backend|services?|microservices?|sdk|runtime)|golang|written in go|using go|experience\s+(?:with|in)\s+go|proficien(?:cy|t)\s+(?:with|in)\s+go|knowledge of go|expertise in go|fluency in go|(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php)\s*(?:,|\/|\band\b)\s*go|go\s*(?:,|\/|\band\b)\s*(?:python|java|rust|kotlin|scala|typescript|javascript|c\+\+|c#|ruby|php))\b/i

const RUST_LANGUAGE_SIGNAL_RE =
  /\b(?:rust\s+(?:language|developer|engineer|programming|crate|crates|ownership|borrow|async|tokio|axum)|written in rust|using rust|experience\s+(?:with|in)\s+rust|proficien(?:cy|t)\s+(?:with|in)\s+rust|knowledge of rust|(?:python|java|go|kotlin|c\+\+|typescript|javascript)\s*(?:,|\/|\band\b)\s*rust|rust\s*(?:,|\/|\band\b)\s*(?:python|java|go|kotlin|c\+\+|typescript|javascript))\b/i

const MACHINE_LEARNING_SIGNAL_RE =
  /\b(?:machine learning|ml engineer|ml platform|ml model|ml pipeline|ml ops|mlops|ml infrastructure|train(?:ing)?\s+(?:a\s+)?(?:model|algorithm)|ml\s+(?:framework|project|team|experience|background)|deploy(?:ing)?\s+ml|build(?:ing)?\s+ml)\b/i

const NLP_SIGNAL_RE =
  /\b(?:natural language processing|nlp\s+(?:model|pipeline|engineer|experience|techniques?|tasks?)|(?:text|language)\s+(?:model|processing|classification|generation)|transformer(?:s|\s+model)?|bert|gpt)\b/i

const COMPUTER_VISION_SIGNAL_RE =
  /\b(?:computer vision|cv\s+(?:model|engineer|pipeline|experience|techniques?)|image\s+(?:classification|detection|segmentation|recognition)|object detection|opencv|yolo)\b/i

const AGILE_SIGNAL_RE =
  /\b(?:scrum|kanban|sprint planning|agile\s+(?:methodolog(?:y|ies)|frameworks?|project management|software development|delivery|ceremon(?:y|ies)|practices?))\b/i


export const SKILL_DEFINITIONS: SkillDefinition[] = [
  // ─── Languages ────────────────────────────────────────────────────────────
  { label: "JavaScript",  aliases: ["javascript", "js"] },
  { label: "TypeScript",  aliases: ["typescript", "ts"] },
  { label: "Python",      aliases: ["python"] },
  { label: "Java",        aliases: ["java"] },
  { label: "Go",          aliases: ["go", "golang"], patterns: [GO_LANGUAGE_SIGNAL_RE] },
  { label: "Rust",        aliases: ["rust"], patterns: [RUST_LANGUAGE_SIGNAL_RE], requiresPattern: true },
  { label: "C++",         aliases: ["c++", "cpp"] },
  { label: "C#",          aliases: ["c#", "csharp"] },
  { label: "Ruby",        aliases: ["ruby"] },
  { label: "PHP",         aliases: ["php"] },
  { label: "Swift",       aliases: ["swift"] },
  { label: "Kotlin",      aliases: ["kotlin"] },
  { label: "Scala",       aliases: ["scala"] },
  { label: "R",           aliases: ["r language", "r programming", "rlang"] },
  { label: "MATLAB",      aliases: ["matlab"] },
  { label: "Bash",        aliases: ["bash", "shell scripting", "bash scripting"] },
  { label: "Dart",        aliases: ["dart"] },
  { label: "Elixir",      aliases: ["elixir"] },
  { label: "Haskell",     aliases: ["haskell"] },

  // ─── Frontend ─────────────────────────────────────────────────────────────
  { label: "React",         aliases: ["react", "react.js", "reactjs"] },
  { label: "Next.js",       aliases: ["next.js", "nextjs"] },
  { label: "Vue.js",        aliases: ["vue", "vue.js", "vuejs"] },
  { label: "Angular",       aliases: ["angular", "angularjs"] },
  { label: "Svelte",        aliases: ["svelte", "sveltekit"] },
  { label: "HTML",          aliases: ["html", "html5"] },
  { label: "CSS",           aliases: ["css", "css3"] },
  { label: "Tailwind CSS",  aliases: ["tailwind", "tailwindcss"] },
  { label: "Sass",          aliases: ["sass", "scss"] },
  { label: "Redux",         aliases: ["redux", "redux toolkit"] },
  { label: "webpack",       aliases: ["webpack"] },
  { label: "Vite",          aliases: ["vite"] },
  { label: "React Native",  aliases: ["react native"] },
  { label: "Flutter",       aliases: ["flutter"] },

  // ─── Backend / Runtime ────────────────────────────────────────────────────
  { label: "Node.js",    aliases: ["node", "node.js", "nodejs"] },
  { label: "Django",     aliases: ["django"] },
  { label: "FastAPI",    aliases: ["fastapi"] },
  { label: "Flask",      aliases: ["flask"] },
  { label: "Spring",     aliases: ["spring", "spring boot", "spring framework"] },
  { label: "Rails",      aliases: ["rails", "ruby on rails", "ror"] },
  { label: "Laravel",    aliases: ["laravel"] },
  { label: "Express",    aliases: ["express", "express.js", "expressjs"] },
  { label: ".NET",       aliases: [".net", "dotnet", "asp.net"] },

  // ─── Databases ────────────────────────────────────────────────────────────
  { label: "SQL",         aliases: ["sql"] },
  { label: "PostgreSQL",  aliases: ["postgresql", "postgres"] },
  { label: "MySQL",       aliases: ["mysql"] },
  { label: "MongoDB",     aliases: ["mongodb", "mongo"] },
  { label: "Redis",       aliases: ["redis"] },
  { label: "Elasticsearch", aliases: ["elasticsearch", "elastic search", "opensearch"] },
  { label: "Cassandra",   aliases: ["cassandra", "apache cassandra"] },
  { label: "DynamoDB",    aliases: ["dynamodb"] },
  { label: "BigQuery",    aliases: ["bigquery"] },
  { label: "Snowflake",   aliases: ["snowflake"] },
  { label: "Redshift",    aliases: ["redshift", "amazon redshift"] },
  { label: "SQLite",      aliases: ["sqlite"] },
  { label: "Databricks",  aliases: ["databricks"] },

  // ─── Cloud & DevOps ───────────────────────────────────────────────────────
  { label: "AWS",          aliases: ["aws", "amazon web services"] },
  { label: "GCP",          aliases: ["gcp", "google cloud", "google cloud platform"] },
  { label: "Azure",        aliases: ["azure", "microsoft azure"] },
  { label: "Docker",       aliases: ["docker"] },
  { label: "Kubernetes",   aliases: ["kubernetes", "k8s"] },
  { label: "Terraform",    aliases: ["terraform"] },
  { label: "Ansible",      aliases: ["ansible"] },
  { label: "Helm",         aliases: ["helm"] },
  { label: "CI/CD",        aliases: ["ci/cd", "ci cd", "continuous integration", "continuous deployment", "continuous delivery"] },
  { label: "GitHub Actions", aliases: ["github actions"] },
  { label: "Jenkins",      aliases: ["jenkins"] },
  { label: "CircleCI",     aliases: ["circleci"] },
  { label: "Linux",        aliases: ["linux", "unix"] },
  { label: "Nginx",        aliases: ["nginx"] },
  { label: "Prometheus",   aliases: ["prometheus"] },
  { label: "Grafana",      aliases: ["grafana"] },
  { label: "Datadog",      aliases: ["datadog"] },

  // ─── APIs & Integration ───────────────────────────────────────────────────
  { label: "GraphQL",    aliases: ["graphql"] },
  { label: "REST",       aliases: ["rest", "restful", "rest api", "rest apis"] },
  { label: "gRPC",       aliases: ["grpc"] },
  { label: "Kafka",      aliases: ["kafka", "apache kafka"] },
  { label: "RabbitMQ",   aliases: ["rabbitmq"] },
  { label: "WebSockets", aliases: ["websockets", "websocket"] },
  { label: "OAuth",      aliases: ["oauth", "oauth2", "oauth 2.0"] },
  { label: "OpenAPI",    aliases: ["openapi", "swagger"] },

  // ─── Data & ML ────────────────────────────────────────────────────────────
  { label: "Machine Learning",  aliases: ["machine learning", "ml"], patterns: [MACHINE_LEARNING_SIGNAL_RE], requiresPattern: false },
  { label: "Deep Learning",     aliases: ["deep learning"] },
  { label: "TensorFlow",        aliases: ["tensorflow"] },
  { label: "PyTorch",           aliases: ["pytorch"] },
  { label: "scikit-learn",      aliases: ["scikit-learn", "sklearn"] },
  { label: "Pandas",            aliases: ["pandas"] },
  { label: "NumPy",             aliases: ["numpy"] },
  { label: "Spark",             aliases: ["spark", "apache spark"] },
  { label: "Airflow",           aliases: ["airflow", "apache airflow"] },
  { label: "dbt",               aliases: ["dbt", "data build tool"] },
  { label: "Data Analysis",     aliases: ["data analysis", "data analytics"] },
  { label: "Data Engineering",  aliases: ["data engineering", "data pipelines", "etl", "elt"] },
  { label: "Data Visualization", aliases: ["data visualization", "data viz", "tableau", "power bi", "looker"] },
  { label: "NLP",               aliases: ["nlp", "natural language processing"], patterns: [NLP_SIGNAL_RE], requiresPattern: false },
  { label: "Computer Vision",   aliases: ["computer vision", "cv"], patterns: [COMPUTER_VISION_SIGNAL_RE], requiresPattern: false },
  { label: "LLMs",              aliases: ["llm", "llms", "large language models", "generative ai", "gen ai", "rag"] },
  { label: "Statistics",        aliases: ["statistics", "statistical analysis", "statistical modeling"] },
  { label: "A/B Testing",       aliases: ["a/b testing", "a/b test", "experimentation", "hypothesis testing"] },

  // ─── Security ─────────────────────────────────────────────────────────────
  { label: "Cybersecurity",       aliases: ["cybersecurity", "information security", "infosec"] },
  { label: "Penetration Testing", aliases: ["penetration testing", "pen testing", "pentest"] },
  { label: "Network Security",    aliases: ["network security"] },
  { label: "SIEM",                aliases: ["siem"] },
  { label: "Compliance",          aliases: ["compliance", "sox", "hipaa", "gdpr", "pci", "iso 27001"] },

  // ─── Design & UX ─────────────────────────────────────────────────────────
  { label: "Figma",              aliases: ["figma"] },
  { label: "Sketch",             aliases: ["sketch"] },
  { label: "Adobe XD",           aliases: ["adobe xd", "xd"] },
  { label: "Photoshop",          aliases: ["photoshop", "adobe photoshop"] },
  { label: "Illustrator",        aliases: ["illustrator", "adobe illustrator"] },
  { label: "After Effects",      aliases: ["after effects", "adobe after effects"] },
  { label: "InDesign",           aliases: ["indesign", "adobe indesign"] },
  { label: "UX Research",        aliases: ["ux research", "user research", "usability testing"] },
  { label: "UI Design",          aliases: ["ui design", "user interface design"] },
  { label: "UX Design",          aliases: ["ux design", "user experience design"] },
  { label: "Wireframing",        aliases: ["wireframing", "wireframes", "prototyping"] },
  { label: "Design Systems",     aliases: ["design systems", "design system"] },
  { label: "Motion Design",      aliases: ["motion design", "motion graphics"] },
  { label: "Accessibility",      aliases: ["accessibility", "a11y", "wcag", "ada compliance"] },

  // ─── Product & Project Management ────────────────────────────────────────
  { label: "Product Management",  aliases: ["product management"] },
  { label: "Product Strategy",    aliases: ["product strategy", "product vision", "product roadmap"] },
  { label: "Project Management",  aliases: ["project management"] },
  {
    label: "Agile",
    aliases: ["agile", "scrum", "kanban", "sprint planning"],
    patterns: [AGILE_SIGNAL_RE],
    requiresPattern: true,
  },
  { label: "Jira",                aliases: ["jira"] },
  { label: "Confluence",          aliases: ["confluence"] },
  { label: "Roadmapping",         aliases: ["roadmapping", "roadmap planning"] },
  { label: "Stakeholder Management", aliases: ["stakeholder management", "stakeholder communication"] },
  { label: "OKRs",                aliases: ["okrs", "objectives and key results"] },
  { label: "PRDs",                aliases: ["prds", "product requirements", "product requirements document"] },

  // ─── Marketing ───────────────────────────────────────────────────────────
  { label: "SEO",                   aliases: ["seo", "search engine optimization"] },
  { label: "SEM",                   aliases: ["sem", "search engine marketing", "paid search"] },
  { label: "Google Ads",            aliases: ["google ads", "google adwords"] },
  { label: "Meta Ads",              aliases: ["meta ads", "facebook ads", "instagram ads", "facebook advertising"] },
  { label: "Email Marketing",       aliases: ["email marketing", "email campaigns"] },
  { label: "Content Marketing",     aliases: ["content marketing", "content strategy"] },
  { label: "Social Media Marketing", aliases: ["social media marketing", "social media management"] },
  { label: "Copywriting",           aliases: ["copywriting", "copy writing"] },
  { label: "Brand Strategy",        aliases: ["brand strategy", "branding"] },
  { label: "Marketing Analytics",   aliases: ["marketing analytics", "campaign analytics"] },
  { label: "HubSpot",               aliases: ["hubspot"] },
  { label: "Salesforce",            aliases: ["salesforce", "sfdc"] },
  { label: "Marketo",               aliases: ["marketo"] },
  { label: "Google Analytics",      aliases: ["google analytics", "ga4"] },
  { label: "CRM",                   aliases: ["crm", "customer relationship management"] },
  { label: "Growth Marketing",      aliases: ["growth marketing", "growth hacking"] },
  { label: "Performance Marketing", aliases: ["performance marketing"] },
  { label: "Affiliate Marketing",   aliases: ["affiliate marketing"] },
  { label: "Influencer Marketing",  aliases: ["influencer marketing"] },

  // ─── Sales ───────────────────────────────────────────────────────────────
  { label: "Sales",              aliases: ["sales", "b2b sales", "enterprise sales"] },
  { label: "Account Management", aliases: ["account management", "account executive"] },
  { label: "Business Development", aliases: ["business development", "biz dev"] },
  { label: "Lead Generation",    aliases: ["lead generation", "lead gen"] },
  { label: "Cold Outreach",      aliases: ["cold outreach", "cold calling", "cold emailing"] },
  { label: "Pipeline Management", aliases: ["pipeline management", "sales pipeline"] },
  { label: "Negotiation",        aliases: ["negotiation", "contract negotiation"] },
  { label: "Outbound Sales",     aliases: ["outbound sales", "outbound"] },

  // ─── Finance & Accounting ─────────────────────────────────────────────────
  { label: "Financial Modeling",  aliases: ["financial modeling", "financial models"] },
  { label: "Financial Analysis",  aliases: ["financial analysis", "financial reporting"] },
  { label: "Accounting",          aliases: ["accounting", "general ledger"] },
  { label: "Forecasting",         aliases: ["forecasting", "financial forecasting"] },
  { label: "Budgeting",           aliases: ["budgeting", "budget planning"] },
  { label: "Excel",               aliases: ["excel", "microsoft excel", "advanced excel"] },
  { label: "QuickBooks",          aliases: ["quickbooks"] },
  { label: "SAP",                 aliases: ["sap", "sap erp"] },
  { label: "Valuation",           aliases: ["valuation", "dcf", "discounted cash flow"] },
  { label: "M&A",                 aliases: ["m&a", "mergers and acquisitions", "mergers & acquisitions"] },
  { label: "FP&A",                aliases: ["fp&a", "financial planning and analysis"] },
  { label: "Tax",                 aliases: ["tax", "tax compliance", "tax planning"] },
  { label: "Auditing",            aliases: ["auditing", "internal audit", "external audit"] },

  // ─── Operations ──────────────────────────────────────────────────────────
  { label: "Operations Management", aliases: ["operations management", "ops management"] },
  { label: "Supply Chain",          aliases: ["supply chain", "supply chain management"] },
  { label: "Logistics",             aliases: ["logistics", "logistics management"] },
  { label: "Process Improvement",   aliases: ["process improvement", "process optimization", "lean", "six sigma"] },
  { label: "Vendor Management",     aliases: ["vendor management"] },
  { label: "Procurement",           aliases: ["procurement"] },
  { label: "ERP",                   aliases: ["erp", "enterprise resource planning"] },
  { label: "Inventory Management",  aliases: ["inventory management"] },

  // ─── HR & People ─────────────────────────────────────────────────────────
  { label: "Recruiting",          aliases: ["recruiting", "talent acquisition", "recruitment"] },
  { label: "HR",                  aliases: ["human resources", "hr management"] },
  { label: "Performance Management", aliases: ["performance management", "performance reviews"] },
  { label: "Employee Relations",  aliases: ["employee relations"] },
  { label: "HRIS",                aliases: ["hris", "workday", "bamboohr"] },
  { label: "Onboarding",          aliases: ["onboarding"] },
  { label: "Compensation",        aliases: ["compensation", "total rewards", "compensation design"] },

  // ─── Legal ────────────────────────────────────────────────────────────────
  { label: "Contract Management", aliases: ["contract management", "contract drafting", "contract review"] },
  { label: "Corporate Law",       aliases: ["corporate law", "corporate governance"] },
  { label: "Intellectual Property", aliases: ["intellectual property", "ip law", "trademark", "patent"] },
  { label: "Employment Law",      aliases: ["employment law", "labor law"] },
  { label: "Privacy Law",         aliases: ["privacy law", "data privacy", "gdpr", "ccpa"] },

  // ─── Customer Success & Support ───────────────────────────────────────────
  { label: "Customer Success",    aliases: ["customer success", "csm"] },
  { label: "Customer Support",    aliases: ["customer support", "customer service", "technical support"] },
  { label: "Account Retention",   aliases: ["account retention", "churn reduction"] },
  { label: "Zendesk",             aliases: ["zendesk"] },
  { label: "Intercom",            aliases: ["intercom"] },

  // ─── Hardware & Mechanical Engineering ──────────────────────────────────
  { label: "SolidWorks",        aliases: ["solidworks", "solid works"] },
  { label: "CATIA",             aliases: ["catia"] },
  { label: "Siemens NX",        aliases: ["siemens nx", "nx cad", "unigraphics", "ugsnx"] },
  { label: "Creo",              aliases: ["creo", "pro/engineer", "proengineer", "pro-e"] },
  { label: "AutoCAD",           aliases: ["autocad", "auto cad"] },
  { label: "Fusion 360",        aliases: ["fusion 360", "autodesk fusion"] },
  { label: "ANSYS",             aliases: ["ansys"] },
  { label: "FEA",               aliases: ["fea", "finite element analysis", "finite element method", "fem"] },
  { label: "CFD",               aliases: ["cfd", "computational fluid dynamics"] },
  { label: "Thermal Analysis",  aliases: ["thermal analysis", "thermal management", "thermal simulation", "thermal modeling"] },
  { label: "Structural Analysis", aliases: ["structural analysis", "structural simulation", "stress analysis", "fatigue analysis"] },
  { label: "GD&T",              aliases: ["gd&t", "geometric dimensioning", "geometric tolerancing"] },
  { label: "PCB Design",        aliases: ["pcb design", "pcb layout", "printed circuit board", "pcb"] },
  { label: "Altium",            aliases: ["altium", "altium designer"] },
  { label: "Cadence",           aliases: ["cadence", "cadence allegro", "cadence virtuoso"] },
  { label: "Allegro",           aliases: ["allegro pcb"] },
  { label: "KiCad",             aliases: ["kicad"] },
  { label: "Eagle",             aliases: ["eagle cad", "autodesk eagle"] },
  { label: "Zuken",             aliases: ["zuken", "zuken e3", "zuken cr-8000"] },
  { label: "Capital",           aliases: ["capital logic", "capital electra", "mentor capital"] },
  { label: "FPGA",              aliases: ["fpga", "field programmable gate array"] },
  { label: "VHDL",              aliases: ["vhdl"] },
  { label: "Verilog",           aliases: ["verilog", "systemverilog", "system verilog"] },
  { label: "Embedded Systems",  aliases: ["embedded systems", "embedded software", "embedded engineering", "bare metal", "rtos", "embedded firmware"] },
  { label: "Avionics",          aliases: ["avionics", "avionics systems", "avionics packaging"] },
  { label: "EMI/EMC",           aliases: ["emi/emc", "emi", "emc", "electromagnetic interference", "electromagnetic compatibility"] },
  { label: "MIL-STD",          aliases: ["mil-std", "mil std", "milspec", "mil-spec", "mil-std-810", "mil-std-461", "mil-std-1553"] },
  { label: "DO-160",            aliases: ["do-160", "do160"] },
  { label: "DO-178",            aliases: ["do-178", "do-178c", "do178"] },
  { label: "DO-254",            aliases: ["do-254", "do254"] },
  { label: "Systems Engineering", aliases: ["systems engineering", "model-based systems engineering", "mbse"] },
  { label: "Robotics",          aliases: ["robotics", "robot operating system", "ros", "ros2"] },
  { label: "PLC",               aliases: ["plc", "programmable logic controller", "ladder logic"] },
  { label: "CAM",               aliases: ["cam", "computer-aided manufacturing"] },
  { label: "Mechanical Design", aliases: ["mechanical design", "mechanical engineering", "mechanism design"] },
  { label: "Aerospace Engineering", aliases: ["aerospace engineering", "aeronautics", "aerostructures"] },
  { label: "Electrical Engineering", aliases: ["electrical engineering", "electrical design", "circuit design"] },
  { label: "Hardware Design",   aliases: ["hardware design", "hardware development", "hardware engineering"] },
  { label: "Signal Processing", aliases: ["signal processing", "dsp", "digital signal processing"] },
  { label: "Power Electronics", aliases: ["power electronics", "power systems", "power supply design", "dc-dc converter"] },
  { label: "RF Engineering",    aliases: ["rf engineering", "rf design", "radio frequency", "antenna design", "microwave"] },
  { label: "Sensors",           aliases: ["sensor fusion", "sensor integration", "imu", "lidar", "radar"] },
  { label: "Controls",          aliases: ["control systems", "control theory", "pid controller", "pid control", "flight control"] },
  { label: "LabVIEW",          aliases: ["labview", "lab view"] },
  { label: "COMSOL",           aliases: ["comsol", "comsol multiphysics"] },
  { label: "Simulink",         aliases: ["simulink", "matlab simulink"] },

  // ─── QA & Testing ─────────────────────────────────────────────────────────
  { label: "Selenium",          aliases: ["selenium", "selenium webdriver"] },
  { label: "Cypress",           aliases: ["cypress", "cypress.io"] },
  { label: "Playwright",        aliases: ["playwright"] },
  { label: "Jest",              aliases: ["jest", "jest testing"] },
  { label: "pytest",            aliases: ["pytest"] },
  { label: "JUnit",             aliases: ["junit", "junit5"] },
  { label: "Mocha",             aliases: ["mocha", "mocha.js"] },
  { label: "Postman",           aliases: ["postman"] },
  { label: "JMeter",            aliases: ["jmeter", "apache jmeter"] },
  { label: "Appium",            aliases: ["appium"] },
  { label: "TestNG",            aliases: ["testng"] },
  { label: "Load Testing",      aliases: ["load testing", "performance testing", "stress testing"] },
  { label: "Test Automation",   aliases: ["test automation", "automated testing", "qa automation"] },
  { label: "Manual Testing",    aliases: ["manual testing", "functional testing", "regression testing"] },
  { label: "BDD",               aliases: ["bdd", "behavior driven development", "cucumber", "gherkin"] },
  { label: "API Testing",       aliases: ["api testing", "api test", "rest assured"] },
  { label: "Accessibility Testing", aliases: ["accessibility testing", "a11y testing"] },

  // ─── Networking & Infrastructure ─────────────────────────────────────────
  { label: "TCP/IP",            aliases: ["tcp/ip", "tcp ip", "networking protocols", "network protocols"] },
  { label: "DNS",               aliases: ["dns", "domain name system"] },
  { label: "Firewall",          aliases: ["firewall", "network firewall", "palo alto", "fortinet", "checkpoint"] },
  { label: "VPN",               aliases: ["vpn", "virtual private network", "ipsec", "ssl vpn"] },
  { label: "Cisco",             aliases: ["cisco", "cisco networking", "ccna", "ccnp", "ccie"] },
  { label: "BGP/OSPF",          aliases: ["bgp", "ospf", "eigrp", "routing protocols"] },
  { label: "SD-WAN",            aliases: ["sd-wan", "sdwan"] },
  { label: "Load Balancing",    aliases: ["load balancing", "load balancer", "f5", "nginx load balancer", "haproxy"] },
  { label: "Wireshark",         aliases: ["wireshark", "packet analysis", "packet capture"] },
  { label: "Network Monitoring", aliases: ["network monitoring", "snmp", "nagios", "zabbix"] },
  { label: "5G/LTE",            aliases: ["5g", "lte", "4g lte", "cellular networks", "ran"] },
  { label: "VoIP",              aliases: ["voip", "sip", "asterisk", "webrtc", "unified communications"] },
  { label: "Zero Trust",        aliases: ["zero trust", "zero-trust", "ztna"] },

  // ─── Media & Creative Tools ───────────────────────────────────────────────
  { label: "Premiere Pro",      aliases: ["premiere pro", "adobe premiere", "premiere"] },
  { label: "Final Cut Pro",     aliases: ["final cut pro", "final cut", "fcp"] },
  { label: "DaVinci Resolve",   aliases: ["davinci resolve", "resolve"] },
  { label: "Avid",              aliases: ["avid", "avid media composer", "media composer"] },
  { label: "Logic Pro",         aliases: ["logic pro", "logic x", "logic audio"] },
  { label: "Pro Tools",         aliases: ["pro tools", "avid pro tools"] },
  { label: "Audacity",          aliases: ["audacity"] },
  { label: "Blender",           aliases: ["blender", "blender 3d"] },
  { label: "Cinema 4D",         aliases: ["cinema 4d", "c4d"] },
  { label: "Maya",              aliases: ["maya", "autodesk maya"] },
  { label: "3ds Max",           aliases: ["3ds max", "3d studio max"] },
  { label: "Unity",             aliases: ["unity", "unity3d", "unity engine"] },
  { label: "Unreal Engine",     aliases: ["unreal engine", "unreal", "ue4", "ue5"] },
  { label: "WordPress",         aliases: ["wordpress", "wp"] },
  { label: "Webflow",           aliases: ["webflow"] },
  { label: "Shopify",           aliases: ["shopify"] },
  { label: "Video Production",  aliases: ["video production", "video editing", "video post-production"] },
  { label: "Photography",       aliases: ["photography", "photo editing", "lightroom"] },
  { label: "AR/VR",             aliases: ["ar", "vr", "augmented reality", "virtual reality", "mixed reality", "xr"] },

  // ─── Healthcare & Life Sciences ───────────────────────────────────────────
  { label: "HIPAA",             aliases: ["hipaa", "hipaa compliance", "phi"] },
  { label: "Epic",              aliases: ["epic", "epic systems", "epic ehr"] },
  { label: "Cerner",            aliases: ["cerner", "cerner millennium", "oracle health"] },
  { label: "HL7/FHIR",         aliases: ["hl7", "fhir", "hl7 fhir", "hl7 v2"] },
  { label: "EHR/EMR",          aliases: ["ehr", "emr", "electronic health records", "electronic medical records"] },
  { label: "ICD-10",           aliases: ["icd-10", "icd10", "medical coding", "cpt coding"] },
  { label: "Clinical Trials",  aliases: ["clinical trials", "clinical research", "clinical studies"] },
  { label: "GMP",              aliases: ["gmp", "good manufacturing practice", "cgmp"] },
  { label: "FDA Regulatory",   aliases: ["fda", "fda regulatory", "510k", "pma", "fda approval", "regulatory affairs"] },
  { label: "Bioinformatics",   aliases: ["bioinformatics", "computational biology", "genomics"] },
  { label: "PCR",              aliases: ["pcr", "qpcr", "rt-pcr", "polymerase chain reaction"] },
  { label: "CRISPR",           aliases: ["crispr", "gene editing", "gene therapy"] },
  { label: "Flow Cytometry",   aliases: ["flow cytometry", "facs", "cell sorting"] },
  { label: "Microscopy",       aliases: ["microscopy", "confocal microscopy", "electron microscopy"] },
  { label: "NGS",              aliases: ["ngs", "next generation sequencing", "dna sequencing", "rna sequencing", "rnaseq"] },
  { label: "Cell Culture",     aliases: ["cell culture", "tissue culture", "mammalian cell culture"] },
  { label: "Pharmacovigilance", aliases: ["pharmacovigilance", "drug safety", "adverse event reporting"] },
  { label: "Medical Devices",  aliases: ["medical devices", "medical device", "iso 13485", "510(k)"] },
  { label: "Radiology",        aliases: ["radiology", "dicom", "pacs", "medical imaging"] },

  // ─── Science & Research ───────────────────────────────────────────────────
  { label: "SAS",              aliases: ["sas", "sas programming"] },
  { label: "SPSS",             aliases: ["spss", "ibm spss"] },
  { label: "STATA",            aliases: ["stata"] },
  { label: "LaTeX",            aliases: ["latex"] },
  { label: "Scientific Writing", aliases: ["scientific writing", "research writing", "grant writing"] },
  { label: "Lab Research",     aliases: ["laboratory research", "lab research", "wet lab", "dry lab"] },
  { label: "Experimental Design", aliases: ["experimental design", "study design", "research methodology"] },
  { label: "Mass Spectrometry", aliases: ["mass spectrometry", "hplc", "gc-ms", "lc-ms"] },
  { label: "Protein Analysis", aliases: ["western blot", "elisa", "protein purification", "sds-page"] },
  { label: "Animal Studies",   aliases: ["animal studies", "in vivo", "mouse model", "preclinical"] },
  { label: "GIS",              aliases: ["gis", "arcgis", "qgis", "geographic information systems"] },

  // ─── Soft Skills ─────────────────────────────────────────────────────────
  { label: "Leadership",           aliases: ["leadership", "team leadership", "people management"] },
  { label: "Communication",        aliases: ["communication", "communications"] },
  { label: "Collaboration",        aliases: ["collaboration", "cross-functional collaboration"] },
  { label: "Problem Solving",      aliases: ["problem solving", "problem-solving", "analytical thinking"] },
  { label: "Critical Thinking",    aliases: ["critical thinking"] },
  { label: "Time Management",      aliases: ["time management"] },
  { label: "Mentoring",            aliases: ["mentoring", "mentorship", "coaching"] },
  { label: "Public Speaking",      aliases: ["public speaking", "presentations", "presenting"] },
  { label: "Writing",              aliases: ["technical writing", "writing skills", "documentation"] },
  { label: "Adaptability",         aliases: ["adaptability", "adaptable"] },
  { label: "Organizational Skills", aliases: ["organizational skills", "highly organized"] },
]

const BY_KEY = new Map<string, string>()
for (const skill of SKILL_DEFINITIONS) {
  BY_KEY.set(normalizeSkillKey(skill.label), skill.label)
  for (const alias of skill.aliases) {
    BY_KEY.set(normalizeSkillKey(alias), skill.label)
  }
}

const PROGRAMMING_LANGUAGE_SKILLS = new Set([
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "Go",
  "Rust",
  "C++",
  "C#",
  "Ruby",
  "PHP",
  "Swift",
  "Kotlin",
  "Scala",
  "R",
  "MATLAB",
  "Bash",
  "Dart",
  "Elixir",
  "Haskell",
])

const FRAMEWORK_SKILLS = new Set([
  "React",
  "Next.js",
  "Vue.js",
  "Angular",
  "Svelte",
  "Tailwind CSS",
  "Redux",
  "React Native",
  "Flutter",
  "Node.js",
  "Django",
  "FastAPI",
  "Flask",
  "Spring",
  "Rails",
  "Laravel",
  "Express",
  ".NET",
  "GraphQL",
  "REST",
  "gRPC",
  "WebSockets",
])

const CLOUD_SKILLS = new Set(["AWS", "GCP", "Azure"])

const DATABASE_SKILLS = new Set([
  "SQL",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "Elasticsearch",
  "Cassandra",
  "DynamoDB",
  "BigQuery",
  "Snowflake",
  "Redshift",
  "SQLite",
  "Databricks",
])

const DEVOPS_SKILLS = new Set([
  "Docker",
  "Kubernetes",
  "Terraform",
  "Ansible",
  "Helm",
  "CI/CD",
  "GitHub Actions",
  "Jenkins",
  "CircleCI",
  "Linux",
  "Nginx",
  "Prometheus",
  "Grafana",
  "Datadog",
  "Kafka",
  "RabbitMQ",
])

const AI_ML_SKILLS = new Set([
  "Machine Learning",
  "Deep Learning",
  "TensorFlow",
  "PyTorch",
  "scikit-learn",
  "NLP",
  "Computer Vision",
  "LLMs",
])

const DATA_SKILLS = new Set([
  "Pandas",
  "NumPy",
  "Spark",
  "Airflow",
  "dbt",
  "Data Analysis",
  "Data Engineering",
  "Data Visualization",
  "Statistics",
  "A/B Testing",
])

const SECURITY_SKILLS = new Set([
  "Cybersecurity",
  "Penetration Testing",
  "Network Security",
  "SIEM",
  "Compliance",
  "OAuth",
])

const ENGINEERING_SKILLS = new Set([
  "SolidWorks", "CATIA", "Siemens NX", "Creo", "AutoCAD", "Fusion 360",
  "ANSYS", "FEA", "CFD", "Thermal Analysis", "Structural Analysis", "GD&T",
  "PCB Design", "Altium", "Cadence", "Allegro", "KiCad", "Eagle", "Zuken", "Capital",
  "FPGA", "VHDL", "Verilog", "Embedded Systems", "Avionics", "EMI/EMC",
  "MIL-STD", "DO-160", "DO-178", "DO-254",
  "Systems Engineering", "Robotics", "PLC", "CAM",
  "Mechanical Design", "Aerospace Engineering", "Electrical Engineering", "Hardware Design",
  "Signal Processing", "Power Electronics", "RF Engineering", "Sensors", "Controls",
  "LabVIEW", "COMSOL", "Simulink",
])

const TESTING_SKILLS = new Set([
  "Selenium", "Cypress", "Playwright", "Jest", "pytest", "JUnit", "Mocha",
  "Postman", "JMeter", "Appium", "TestNG", "Load Testing", "Test Automation",
  "Manual Testing", "BDD", "API Testing", "Accessibility Testing",
])

const NETWORKING_SKILLS = new Set([
  "TCP/IP", "DNS", "Firewall", "VPN", "Cisco", "BGP/OSPF", "SD-WAN",
  "Load Balancing", "Wireshark", "Network Monitoring", "5G/LTE", "VoIP", "Zero Trust",
])

const MEDIA_SKILLS = new Set([
  "Premiere Pro", "Final Cut Pro", "DaVinci Resolve", "Avid", "Logic Pro", "Pro Tools",
  "Audacity", "Blender", "Cinema 4D", "Maya", "3ds Max", "Unity", "Unreal Engine",
  "WordPress", "Webflow", "Shopify", "Video Production", "Photography", "AR/VR",
])

const HEALTHCARE_SKILLS = new Set([
  "HIPAA", "Epic", "Cerner", "HL7/FHIR", "EHR/EMR", "ICD-10", "Clinical Trials",
  "GMP", "FDA Regulatory", "Bioinformatics", "PCR", "CRISPR", "Flow Cytometry",
  "Microscopy", "NGS", "Cell Culture", "Pharmacovigilance", "Medical Devices", "Radiology",
])

const SCIENCE_SKILLS = new Set([
  "SAS", "SPSS", "STATA", "LaTeX", "Scientific Writing", "Lab Research",
  "Experimental Design", "Mass Spectrometry", "Protein Analysis", "Animal Studies", "GIS",
])

const SOFT_SKILLS = new Set([
  "Leadership",
  "Communication",
  "Collaboration",
  "Problem Solving",
  "Critical Thinking",
  "Time Management",
  "Mentoring",
  "Public Speaking",
  "Writing",
  "Adaptability",
  "Organizational Skills",
  "Project Management",
  "Stakeholder Management",
])

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
    .replace(/[^a-z0-9+#.&/]+/g, " ")
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
    // Skills that require pattern match: only count them when a specific tech
    // context pattern fires (prevents ambiguous aliases like "rust" from
    // matching unrelated text).
    if (skill.requiresPattern) {
      if (skill.patterns?.some((pattern) => pattern.test(blob))) {
        found.push(skill.label)
      }
      continue
    }

    // "Go" needs special handling: the bare alias is too short and common, so
    // we check aliases except "go" itself and rely on the pattern for that case.
    const aliasesToCheck =
      skill.label === "Go"
        ? skill.aliases.filter((alias) => normalizeSkillKey(alias) !== "go")
        : skill.aliases

    const patternMatch = Boolean(skill.patterns?.some((pattern) => pattern.test(blob)))
    const aliasMatch = aliasesToCheck.some((alias) => aliasPattern(alias).test(blob))

    if (patternMatch || aliasMatch) found.push(skill.label)
  }

  return normalizeSkillList(found)
}

export function filterSkillsByTextEvidence(
  values: Array<string | null | undefined>,
  ...parts: Array<string | null | undefined>
) {
  const normalized = normalizeSkillList(values)
  const blob = parts.filter(Boolean).join(" ")
  if (!blob.trim()) return normalized

  return normalized.filter((skill) => {
    // "Agile" is frequently a prose adjective ("agile environment") in JDs.
    // Keep it only when stronger framework/methodology context is present.
    if (canonicalizeSkill(skill) === "Agile") {
      return AGILE_SIGNAL_RE.test(blob)
    }
    return true
  })
}

export function emptyCategorizedSkills(): CategorizedSkills {
  return {
    programmingLanguages: [],
    frameworks: [],
    cloud: [],
    databases: [],
    devops: [],
    aiMl: [],
    data: [],
    security: [],
    engineering: [],
    testing: [],
    networking: [],
    media: [],
    healthcare: [],
    science: [],
    softSkills: [],
  }
}

export function categorizeSkills(values: Array<string | null | undefined>): CategorizedSkills {
  const buckets = emptyCategorizedSkills()
  const normalized = normalizeSkillList(values)

  for (const skill of normalized) {
    if (PROGRAMMING_LANGUAGE_SKILLS.has(skill)) {
      buckets.programmingLanguages.push(skill)
    } else if (FRAMEWORK_SKILLS.has(skill)) {
      buckets.frameworks.push(skill)
    } else if (CLOUD_SKILLS.has(skill)) {
      buckets.cloud.push(skill)
    } else if (DATABASE_SKILLS.has(skill)) {
      buckets.databases.push(skill)
    } else if (DEVOPS_SKILLS.has(skill)) {
      buckets.devops.push(skill)
    } else if (AI_ML_SKILLS.has(skill)) {
      buckets.aiMl.push(skill)
    } else if (DATA_SKILLS.has(skill)) {
      buckets.data.push(skill)
    } else if (SECURITY_SKILLS.has(skill)) {
      buckets.security.push(skill)
    } else if (ENGINEERING_SKILLS.has(skill)) {
      buckets.engineering.push(skill)
    } else if (TESTING_SKILLS.has(skill)) {
      buckets.testing.push(skill)
    } else if (NETWORKING_SKILLS.has(skill)) {
      buckets.networking.push(skill)
    } else if (MEDIA_SKILLS.has(skill)) {
      buckets.media.push(skill)
    } else if (HEALTHCARE_SKILLS.has(skill)) {
      buckets.healthcare.push(skill)
    } else if (SCIENCE_SKILLS.has(skill)) {
      buckets.science.push(skill)
    } else if (SOFT_SKILLS.has(skill)) {
      buckets.softSkills.push(skill)
    }
  }

  return buckets
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
