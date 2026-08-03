import test from "node:test"
import assert from "node:assert/strict"
import { buildLocalTailorAnalysis } from "@/lib/resume/tailor-analysis"
import type { Resume } from "@/types"

// Real-world regression: Felix's resume vs the live Worldpac "AI Engineer" JD.
// Before the keyword-lexicon work, the engine's JD universe was a 33-word canon
// that missed Azure OpenAI / Snowflake / Databricks / LlamaIndex / MLOps / vector
// DBs, so those never surfaced as gaps and the match score was computed blind to
// them. These assertions lock in that they are now understood.

const WORLDPAC_JD = `AI Engineer — Worldpac (automotive parts distribution)
Seeking an AI Engineer to identify, architect, and deploy production GenAI applications across the enterprise.
Working in a modern Azure Databricks and Snowflake environment, you'll ship LLM-powered agents and automation.
Architect and develop prototype agents using private ChatGPT instances, Azure OpenAI, Anthropic Claude, and open-source LLMs.
Implement RAG systems, multi-agent orchestration, and intelligent automation using frameworks such as LangChain, LlamaIndex, or LangGraph.
Evaluate and tune prompt engineering strategies, tool integrations, and memory handling for agent reliability.
Build API services (FastAPI) integrating with enterprise systems (AS400/IBM i, Salesforce, Oracle, etc.) and Snowflake data.
Deploy applications on Azure infrastructure with CI/CD pipelines, MLOps workflows, monitoring, and cost optimization.
Prior work with open-source or commercial RAG systems, embedding models, or vector search (e.g., FAISS, Weaviate, Pinecone).`

const FELIX_RESUME: Resume = {
  id: "00000000-0000-0000-0000-000000000000",
  summary:
    "Backend-first software engineer working in Python/FastAPI and Java/Spring Boot across payment microservices, event-driven transaction processing, and agent infrastructure. Recent work centres on control planes for tool-using agents: policy gating, human approval workflows, audit logging, and MCP tool governance.",
  work_experience: [
    {
      company: "Community Dreams Foundation",
      title: "Generative AI Specialist",
      description:
        "Implemented a multi-step LLM agent workflow for automated needs assessment. Designed and shipped the RAG-powered incentive-matching pipeline end to end. Developed reusable prompt templates, tool-calling schemas and evaluation pipelines.",
      achievements: ["Reduced manual incentive-matching work by approximately 90%."],
    },
    {
      company: "Electronic Funds Technology Corporation Limited",
      title: "Full Stack Developer",
      description:
        "Built and maintained production payment processing systems handling 1M+ transactions/day. Optimized transaction APIs via Redis caching and asynchronous/event-driven processing (Kafka/JMS). Reduced MTTR by 35% through a Datadog and CloudWatch observability stack.",
      achievements: [],
    },
  ],
  skills: {
    technical: ["Python", "Java", "SQL", "FastAPI", "Spring Boot", "Node.js", "LangGraph", "RAG", "OpenAI", "Anthropic", "AutoGen", "LangChain", "MCP", "Ollama", "Docker"],
    soft: [],
    languages: [],
    certifications: [],
  },
  top_skills: ["Python", "FastAPI", "LangChain", "RAG", "LangGraph"],
  raw_text:
    "Python Java SQL FastAPI Spring Boot Node.js LangGraph RAG OpenAI Anthropic AutoGen LangChain MCP Ollama Docker Docker Compose CI/CD FAISS Canon force RAG vector search",
} as unknown as Resume

test("Worldpac JD analysis surfaces the real missing GenAI/cloud/data gaps", () => {
  const analysis = buildLocalTailorAnalysis({
    resume: FELIX_RESUME,
    jobDescription: WORLDPAC_JD,
    skillsText: "Python, Java, SQL, FastAPI, Spring Boot, Node.js, LangGraph, RAG, OpenAI, Anthropic, AutoGen, LangChain, MCP, Ollama, Docker",
    profileSummary: FELIX_RESUME.summary ?? "",
    experienceDraft: (FELIX_RESUME.work_experience ?? []).map((w) => ({
      company: w.company ?? "",
      role: w.title ?? "",
      description: [w.description, ...(w.achievements ?? [])].filter(Boolean).join("\n"),
    })),
  })

  const missing = new Set(analysis.missingKeywords)
  // These are genuinely absent from Felix's resume but core to the JD.
  for (const gap of ["Azure OpenAI", "Snowflake", "Databricks", "LlamaIndex", "MLOps"]) {
    assert.ok(missing.has(gap), `expected missing keywords to include "${gap}"; missing = ${[...missing].join(", ")}`)
  }

  const present = new Set(analysis.presentKeywords)
  // These ARE in Felix's resume and must be credited (some via alias: Anthropic → Anthropic Claude, FAISS present).
  for (const hit of ["RAG", "LangChain", "LangGraph", "FastAPI", "Anthropic Claude", "FAISS"]) {
    assert.ok(present.has(hit), `expected present keywords to include "${hit}"; present = ${[...present].join(", ")}`)
  }
})
