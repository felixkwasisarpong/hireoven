import test from "node:test"
import assert from "node:assert/strict"
import { extractSkillsFromText } from "@/lib/skills/taxonomy"

// Skills are phrased as realistic comma/list-delimited requirements (how JD
// skills sections read). The taxonomy's word-boundary regex excludes "." to
// protect tokens like node.js / c#, so we avoid placing a target skill flush
// against a sentence-ending period.
function extracts(text: string, expected: string[]) {
  const found = new Set(extractSkillsFromText(text))
  for (const skill of expected) {
    assert.ok(found.has(skill), `expected "${skill}" from: ${text}\n got: ${[...found].join(", ")}`)
  }
}

test("Accounting / Audit / Tax", () => {
  extracts(
    "Skills: US GAAP, IFRS, income tax provision (ASC 740), transfer pricing, SOX compliance, NetSuite, financial modeling",
    ["GAAP", "IFRS", "Tax Provision", "Transfer Pricing", "Sarbanes-Oxley", "NetSuite", "Financial Modeling"],
  )
  extracts("Requirements: internal audit, internal controls, variance analysis, accounts payable", ["Internal Audit", "Variance Analysis", "Accounts Payable"])
})

test("Insurance / Actuarial", () => {
  extracts(
    "Requirements: actuarial science, loss reserving, generalized linear models, underwriting, property & casualty, claims management",
    ["Actuarial Science", "Loss Reserving", "Generalized Linear Models", "Underwriting", "Property & Casualty", "Claims Management"],
  )
})

test("Construction / Civil Engineering", () => {
  extracts(
    "Tools: Revit, AutoCAD Civil 3D, BIM coordination, geotechnical, PE License, Primavera P6, OSHA 30, construction management",
    ["Revit", "Civil 3D", "BIM", "Geotechnical Engineering", "PE License", "Primavera P6", "OSHA", "Construction Management"],
  )
})

test("Energy / Oil & Gas / Renewables", () => {
  extracts(
    "Background: petroleum engineering, reservoir simulation, petrophysics, well logging, Aspen HYSYS, process simulation, HSE compliance",
    ["Petroleum Engineering", "Reservoir Engineering", "Petrophysics", "Well Logging", "Aspen HYSYS", "Process Simulation", "HSE"],
  )
  extracts("Designs solar energy, wind energy, and renewable energy systems", ["Renewable Energy"])
})

test("Food Tech / Agriculture", () => {
  extracts(
    "Owns HACCP, food safety, sensory evaluation, fermentation, and food science programs",
    ["HACCP", "Food Safety", "Sensory Analysis", "Fermentation", "Food Science"],
  )
  extracts("Uses agronomy, precision agriculture, remote sensing, and GIS", ["Agronomy", "Precision Agriculture", "Remote Sensing", "GIS"])
})

test("Controls / Manufacturing / Mechanical", () => {
  extracts(
    "Controls engineer: PLC, SCADA, HMI development, thermodynamics, tolerance analysis, lean six sigma",
    ["PLC", "SCADA", "HMI", "Thermodynamics", "Tolerance Analysis", "Lean Manufacturing"],
  )
})

test("Telecommunications", () => {
  extracts("Network engineer: 5G/LTE, RAN, fiber optic transport, VoIP", ["5G/LTE", "Fiber Optics"])
})

test("Supply Chain / Logistics", () => {
  extracts(
    "Skills: demand planning, S&OP, warehouse management system, procurement, freight forwarding, inventory management",
    ["Demand Planning", "S&OP", "Warehouse Management System", "Procurement", "Freight Forwarding", "Inventory Management"],
  )
})

test("Pharma / Clinical", () => {
  extracts(
    "Requires biostatistics, epidemiology, GxP, good clinical practice, and regulatory affairs",
    ["Biostatistics", "Epidemiology", "GxP", "Regulatory Affairs"],
  )
})

test("AI platform and agentic systems", () => {
  extracts(
    "Requirements: agentic AI systems, RAG pipelines, LLM workloads, Production ML / LLM operations, Python, LangGraph / Temporal / orchestration frameworks, Vector databases, HIPAA / SOC-2, Terraform / Kubernetes",
    [
      "Agentic AI",
      "RAG",
      "LLMs",
      "MLOps",
      "LLMOps",
      "Python",
      "LangGraph",
      "Temporal",
      "AI Orchestration",
      "Vector Databases",
      "HIPAA",
      "Compliance",
      "Terraform",
      "Kubernetes",
    ],
  )
})

test("Cyber defense tools and practices", () => {
  extracts(
    "Technical requirements: Microsoft Sentinel, Defender suite, KQL, SIEM/SOAR, UEBA, SOC engineering, detection logic, incident response, Python, PowerShell, and API development",
    [
      "Microsoft Sentinel",
      "Microsoft Defender",
      "KQL",
      "SIEM",
      "SOAR",
      "UEBA",
      "SOC Operations",
      "Detection Engineering",
      "Incident Response",
      "Python",
      "PowerShell",
      "API Development",
    ],
  )
})

test("Public-health communications product skills", () => {
  extracts(
    "Requirements: public health communications, health literacy, plain-language standards, strategic communications, content calendars, Section 508 accessibility, Adobe Creative Suite, Canva for Enterprise, graphic design, data visualizations, Microsoft Office Suite, Microsoft Teams, SharePoint",
    [
      "Public Health",
      "Health Literacy",
      "Plain Language",
      "Strategic Communications",
      "Content Calendars",
      "Accessibility",
      "Adobe Creative Suite",
      "Canva",
      "Graphic Design",
      "Data Visualization",
      "Microsoft Office",
      "Microsoft Teams",
      "SharePoint",
    ],
  )
})

test("does not false-positive on ordinary prose", () => {
  const found = new Set(
    extractSkillsFromText(
      "We are a friendly team that values clear communication and helping each other grow. Maintain version control over documents and comply with information security requirements. Snacks provided.",
    ),
  )
  for (const noise of ["GAAP", "Actuarial Science", "SCADA", "Revit", "HACCP", "Underwriting", "Git", "Cybersecurity"]) {
    assert.ok(!found.has(noise), `should not extract "${noise}" from ordinary prose`)
  }
})
