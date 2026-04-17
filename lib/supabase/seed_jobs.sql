-- =============================================================================
-- Hireoven — Seed Data: Jobs for 20 seeded companies
-- Run AFTER seed.sql (companies must exist first)
-- =============================================================================

-- Google
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Infrastructure', 'Senior Software Engineer', 'Engineering', 'Mountain View, CA', false, true, 'fulltime', 'senior', 185000, 280000, 'https://careers.google.com/jobs/1001', 'goog-1001', true, 92, ARRAY['Go','Kubernetes','Distributed Systems','gRPC','C++'], NOW() - INTERVAL '2 hours', NOW(), true FROM companies WHERE domain = 'google.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Staff Machine Learning Engineer', 'Staff ML Engineer', 'Google DeepMind', 'New York, NY', false, true, 'fulltime', 'staff', 230000, 340000, 'https://careers.google.com/jobs/1002', 'goog-1002', true, 95, ARRAY['Python','PyTorch','TensorFlow','JAX','Distributed Training'], 'We are seeking talented engineers to work on large-scale ML systems. We are committed to sponsoring H-1B visas for qualified candidates.', NOW() - INTERVAL '5 hours', NOW(), true FROM companies WHERE domain = 'google.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Product Manager, Google Cloud', 'Product Manager', 'Google Cloud', 'Sunnyvale, CA', false, false, 'fulltime', 'mid', 145000, 215000, 'https://careers.google.com/jobs/1003', 'goog-1003', true, 88, ARRAY['Product Strategy','SQL','APIs','Cloud Computing','Go-to-Market'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'google.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'UX Research Intern (Summer 2025)', 'UX Research Intern', 'Design', 'San Francisco, CA', false, true, 'internship', 'intern', 50, 55, 'https://careers.google.com/jobs/1004', 'goog-1004', true, 80, ARRAY['User Research','Figma','Surveys','Usability Testing','Statistics'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'google.com';

-- Meta
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Reality Labs', 'Software Engineer', 'Reality Labs', 'Redmond, WA', false, false, 'fulltime', 'mid', 165000, 240000, 'https://www.metacareers.com/jobs/2001', 'meta-2001', true, 91, ARRAY['C++','OpenGL','Vulkan','Computer Vision','SLAM'], 'Join the Reality Labs team building the future of AR/VR. Meta sponsors H-1B and immigration support for all qualifying roles.', NOW() - INTERVAL '1 hour', NOW(), true FROM companies WHERE domain = 'meta.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Data Scientist, Ads', 'Senior Data Scientist', 'Monetization', 'Menlo Park, CA', false, true, 'fulltime', 'senior', 190000, 285000, 'https://www.metacareers.com/jobs/2002', 'meta-2002', true, 93, ARRAY['Python','R','Causal Inference','SQL','Spark','Experimentation'], NOW() - INTERVAL '4 hours', NOW(), true FROM companies WHERE domain = 'meta.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Engineering Manager, Infrastructure', 'Engineering Manager', 'Infrastructure', 'Seattle, WA', true, false, 'fulltime', 'director', 240000, 360000, 'https://www.metacareers.com/jobs/2003', 'meta-2003', true, 90, ARRAY['Team Leadership','Distributed Systems','Systems Design','Go','Java'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'meta.com';

-- Apple
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'iOS Software Engineer', 'iOS Software Engineer', 'Software Engineering', 'Cupertino, CA', false, false, 'fulltime', 'mid', 155000, 235000, 'https://jobs.apple.com/3001', 'aapl-3001', true, 88, ARRAY['Swift','Objective-C','UIKit','SwiftUI','Core Data'], NOW() - INTERVAL '6 hours', NOW(), true FROM companies WHERE domain = 'apple.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Machine Learning Researcher, Siri', 'ML Researcher', 'Siri & Information Intelligence', 'Cupertino, CA', false, false, 'fulltime', 'senior', 210000, 310000, 'https://jobs.apple.com/3002', 'aapl-3002', true, 90, ARRAY['Python','PyTorch','NLP','Speech Recognition','Transformer Models'], NOW() - INTERVAL '12 hours', NOW(), true FROM companies WHERE domain = 'apple.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Hardware Engineer, Apple Silicon', 'Hardware Engineer', 'Silicon Engineering', 'Cupertino, CA', false, false, 'fulltime', 'senior', 200000, 300000, 'https://jobs.apple.com/3003', 'aapl-3003', true, 92, ARRAY['VLSI','RTL Design','Verilog','SystemVerilog','RISC-V'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'apple.com';

-- Microsoft
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Principal Software Engineer, Azure', 'Principal Software Engineer', 'Azure Core', 'Redmond, WA', false, true, 'fulltime', 'principal', 220000, 340000, 'https://jobs.careers.microsoft.com/4001', 'msft-4001', true, 94, ARRAY['C#','Azure','Distributed Systems','Kubernetes','Go'], 'Microsoft sponsors and supports H-1B visa petitions for qualified technical roles. Work authorization assistance provided.', NOW() - INTERVAL '30 minutes', NOW(), true FROM companies WHERE domain = 'microsoft.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer II, GitHub', 'Software Engineer', 'GitHub', 'Remote', true, false, 'fulltime', 'mid', 140000, 210000, 'https://jobs.careers.microsoft.com/4002', 'msft-4002', true, 91, ARRAY['Ruby','TypeScript','React','PostgreSQL','GraphQL'], NOW() - INTERVAL '8 hours', NOW(), true FROM companies WHERE domain = 'microsoft.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Product Manager, Copilot', 'Senior Product Manager', 'M365 AI', 'Redmond, WA', false, true, 'fulltime', 'senior', 165000, 250000, 'https://jobs.careers.microsoft.com/4003', 'msft-4003', true, 89, ARRAY['Product Management','AI/ML','Customer Research','OKRs','B2B SaaS'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'microsoft.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Data & Applied Scientist, Bing', 'Data Scientist', 'Bing', 'Bellevue, WA', false, true, 'fulltime', 'mid', 145000, 215000, 'https://jobs.careers.microsoft.com/4004', 'msft-4004', true, 90, ARRAY['Python','Machine Learning','NLP','Spark','Azure ML'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'microsoft.com';

-- Amazon
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'SDE II, Amazon Web Services', 'Software Engineer', 'AWS Lambda', 'Seattle, WA', false, true, 'fulltime', 'mid', 155000, 230000, 'https://www.amazon.jobs/5001', 'amzn-5001', true, 93, ARRAY['Java','Rust','AWS','Distributed Systems','Microservices'], 'Amazon will sponsor visa and provide immigration support for all new and existing employees who require it.', NOW() - INTERVAL '45 minutes', NOW(), true FROM companies WHERE domain = 'amazon.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior SDE, Alexa AI', 'Senior Software Engineer', 'Alexa', 'Seattle, WA', false, false, 'fulltime', 'senior', 190000, 280000, 'https://www.amazon.jobs/5002', 'amzn-5002', true, 95, ARRAY['Python','NLP','Deep Learning','AWS','Java'], NOW() - INTERVAL '2 hours', NOW(), true FROM companies WHERE domain = 'amazon.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Principal Product Manager – Technical', 'Principal Product Manager', 'AWS', 'New York, NY', false, true, 'fulltime', 'principal', 200000, 310000, 'https://www.amazon.jobs/5003', 'amzn-5003', true, 91, ARRAY['Product Strategy','APIs','Cloud Computing','SQL','Technical Writing'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'amazon.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Development Engineer Intern', 'SDE Intern', 'Amazon', 'Austin, TX', false, true, 'internship', 'intern', 48, 52, 'https://www.amazon.jobs/5004', 'amzn-5004', true, 85, ARRAY['Java','Python','Data Structures','Algorithms','AWS'], NOW() - INTERVAL '4 days', NOW(), true FROM companies WHERE domain = 'amazon.com';

-- Stripe
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Payments Infrastructure', 'Software Engineer', 'Payments', 'San Francisco, CA', false, true, 'fulltime', 'mid', 175000, 255000, 'https://stripe.com/jobs/6001', 'stripe-6001', true, 85, ARRAY['Ruby','Go','PostgreSQL','Kafka','Redis'], 'Stripe provides immigration support including H-1B sponsorship for qualified engineers joining our team.', NOW() - INTERVAL '3 hours', NOW(), true FROM companies WHERE domain = 'stripe.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Developer Experience', 'Senior Software Engineer', 'Developer Platform', 'Remote', true, false, 'fulltime', 'senior', 195000, 275000, 'https://stripe.com/jobs/6002', 'stripe-6002', true, 82, ARRAY['TypeScript','Node.js','APIs','SDKs','Documentation'], NOW() - INTERVAL '7 hours', NOW(), true FROM companies WHERE domain = 'stripe.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Data Scientist, Risk', 'Data Scientist', 'Risk & Fraud', 'Chicago, IL', false, true, 'fulltime', 'mid', 145000, 210000, 'https://stripe.com/jobs/6003', 'stripe-6003', true, 80, ARRAY['Python','SQL','Scikit-learn','Fraud Detection','Statistical Modeling'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'stripe.com';

-- Linear
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer', 'Software Engineer', 'Engineering', 'Remote', true, false, 'fulltime', 'mid', 140000, 200000, 'https://linear.app/careers/7001', 'linear-7001', false, 35, ARRAY['TypeScript','React','GraphQL','PostgreSQL','Electron'], 'Applicants must be authorized to work in the US. We are not able to sponsor work visas at this time.', NOW() - INTERVAL '5 days', NOW(), true FROM companies WHERE domain = 'linear.app';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Product Designer', 'Product Designer', 'Design', 'Remote', true, false, 'fulltime', 'senior', 135000, 190000, 'https://linear.app/careers/7002', 'linear-7002', false, 38, ARRAY['Figma','Design Systems','Motion Design','User Research','Prototyping'], NOW() - INTERVAL '6 days', NOW(), true FROM companies WHERE domain = 'linear.app';

-- Vercel
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Runtime', 'Senior Software Engineer', 'Engineering', 'Remote', true, false, 'fulltime', 'senior', 170000, 240000, 'https://vercel.com/careers/8001', 'vercel-8001', true, 70, ARRAY['Rust','Node.js','Edge Computing','WebAssembly','TypeScript'], 'Vercel can sponsor H-1B visas for exceptional candidates depending on experience and role requirements.', NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'vercel.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Developer Relations Engineer', 'Developer Relations Engineer', 'DevRel', 'Remote', true, false, 'fulltime', 'mid', 130000, 180000, 'https://vercel.com/careers/8002', 'vercel-8002', true, 68, ARRAY['Next.js','TypeScript','Technical Writing','Public Speaking','React'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'vercel.com';

-- Notion
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Full Stack Engineer, Editor', 'Full Stack Engineer', 'Engineering', 'San Francisco, CA', false, true, 'fulltime', 'mid', 155000, 230000, 'https://www.notion.so/careers/9001', 'notion-9001', true, 75, ARRAY['TypeScript','React','PostgreSQL','Node.js','CRDTs'], 'Notion provides H-1B sponsorship and full immigration support as part of our commitment to global talent.', NOW() - INTERVAL '10 hours', NOW(), true FROM companies WHERE domain = 'notion.so';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Product Manager, Enterprise', 'Product Manager', 'Product', 'San Francisco, CA', false, true, 'fulltime', 'senior', 155000, 225000, 'https://www.notion.so/careers/9002', 'notion-9002', true, 72, ARRAY['B2B SaaS','Enterprise Sales','Product Analytics','Roadmapping','SQL'], NOW() - INTERVAL '4 days', NOW(), true FROM companies WHERE domain = 'notion.so';

-- Figma
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Rendering', 'Software Engineer', 'Engineering', 'San Francisco, CA', false, true, 'fulltime', 'senior', 185000, 265000, 'https://www.figma.com/careers/10001', 'figma-10001', true, 80, ARRAY['C++','WebGL','WASM','TypeScript','Graphics Programming'], 'Figma will consider H-1B sponsorship for roles requiring specialized expertise in graphics and rendering engineering.', NOW() - INTERVAL '2 hours', NOW(), true FROM companies WHERE domain = 'figma.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Staff Designer, Design Systems', 'Staff Designer', 'Design', 'New York, NY', false, true, 'fulltime', 'staff', 195000, 280000, 'https://www.figma.com/careers/10002', 'figma-10002', true, 78, ARRAY['Design Systems','Figma','Component Libraries','Documentation','Accessibility'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'figma.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Machine Learning Engineer, AI Features', 'ML Engineer', 'AI', 'San Francisco, CA', false, true, 'fulltime', 'mid', 165000, 240000, 'https://www.figma.com/careers/10003', 'figma-10003', true, 82, ARRAY['Python','PyTorch','Computer Vision','LLMs','TypeScript'], NOW() - INTERVAL '5 hours', NOW(), true FROM companies WHERE domain = 'figma.com';

-- Anthropic
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Research Engineer, Alignment', 'Research Engineer', 'Alignment Science', 'San Francisco, CA', false, false, 'fulltime', 'senior', 200000, 340000, 'https://www.anthropic.com/careers/11001', 'anth-11001', true, 83, ARRAY['Python','PyTorch','Reinforcement Learning','LLMs','Interpretability'], 'We provide full immigration support including H-1B sponsorship for research roles. Authorization to work in the US required at hire.', NOW() - INTERVAL '1 hour', NOW(), true FROM companies WHERE domain = 'anthropic.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Claude.ai', 'Software Engineer', 'Product Engineering', 'San Francisco, CA', false, true, 'fulltime', 'mid', 175000, 260000, 'https://www.anthropic.com/careers/11002', 'anth-11002', true, 85, ARRAY['TypeScript','React','Python','APIs','PostgreSQL'], NOW() - INTERVAL '6 hours', NOW(), true FROM companies WHERE domain = 'anthropic.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Research Scientist, Safety', 'Research Scientist', 'Safety Research', 'San Francisco, CA', false, false, 'fulltime', 'senior', 230000, 380000, 'https://www.anthropic.com/careers/11003', 'anth-11003', true, 88, ARRAY['Python','Deep Learning','NLP','Research Methods','Statistics'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'anthropic.com';

-- OpenAI
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Research Scientist, Pretraining', 'Research Scientist', 'Research', 'San Francisco, CA', false, false, 'fulltime', 'senior', 250000, 400000, 'https://openai.com/careers/12001', 'oai-12001', true, 85, ARRAY['Python','PyTorch','Distributed Training','LLMs','CUDA'], 'OpenAI sponsors H-1B and O-1 visas for researchers and engineers. Immigration assistance provided from day one.', NOW() - INTERVAL '20 minutes', NOW(), true FROM companies WHERE domain = 'openai.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, API Platform', 'Software Engineer', 'Platform', 'San Francisco, CA', false, true, 'fulltime', 'mid', 180000, 270000, 'https://openai.com/careers/12002', 'oai-12002', true, 87, ARRAY['Python','Go','Kubernetes','Postgres','gRPC'], NOW() - INTERVAL '4 hours', NOW(), true FROM companies WHERE domain = 'openai.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Product Manager, ChatGPT', 'Product Manager', 'ChatGPT', 'San Francisco, CA', false, true, 'fulltime', 'senior', 175000, 260000, 'https://openai.com/careers/12003', 'oai-12003', true, 83, ARRAY['Consumer Product','AI/ML','Growth','Analytics','User Research'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'openai.com';

-- JPMorgan Chase
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer III, Payments Tech', 'Software Engineer', 'Technology', 'Jersey City, NJ', false, true, 'fulltime', 'mid', 130000, 195000, 'https://careers.jpmorgan.com/13001', 'jpm-13001', true, 88, ARRAY['Java','Spring Boot','Kafka','Oracle','Microservices'], 'JPMorgan Chase & Co. will consider candidates requiring H-1B sponsorship for this position.', NOW() - INTERVAL '8 hours', NOW(), true FROM companies WHERE domain = 'jpmorganchase.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Quantitative Researcher', 'Quantitative Researcher', 'CIB Quant Research', 'New York, NY', false, false, 'fulltime', 'senior', 175000, 280000, 'https://careers.jpmorgan.com/13002', 'jpm-13002', true, 92, ARRAY['Python','C++','Statistics','Financial Modeling','Stochastic Calculus'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'jpmorganchase.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Data Engineer, Risk Tech', 'Data Engineer', 'Risk Technology', 'Columbus, OH', false, true, 'fulltime', 'mid', 105000, 160000, 'https://careers.jpmorgan.com/13003', 'jpm-13003', true, 85, ARRAY['Python','Spark','Hadoop','SQL','Airflow'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'jpmorganchase.com';

-- Goldman Sachs
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Strats & Engineering', 'Software Engineer', 'Engineering', 'New York, NY', false, false, 'fulltime', 'mid', 145000, 220000, 'https://www.goldmansachs.com/careers/14001', 'gs-14001', true, 86, ARRAY['Java','Python','Slang','SecDB','Market Data'], 'Goldman Sachs sponsors H-1B visas. Must be authorized to work in the US or have an active visa petition.', NOW() - INTERVAL '3 hours', NOW(), true FROM companies WHERE domain = 'goldmansachs.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Machine Learning Engineer, Risk', 'ML Engineer', 'Risk Engineering', 'New York, NY', false, false, 'fulltime', 'senior', 185000, 270000, 'https://www.goldmansachs.com/careers/14002', 'gs-14002', true, 90, ARRAY['Python','TensorFlow','Spark','Time Series','Risk Modeling'], NOW() - INTERVAL '5 days', NOW(), true FROM companies WHERE domain = 'goldmansachs.com';

-- CVS Health
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Digital Health', 'Senior Software Engineer', 'Digital Technology', 'Woonsocket, RI', false, true, 'fulltime', 'senior', 120000, 175000, 'https://jobs.cvshealth.com/15001', 'cvs-15001', true, 73, ARRAY['Java','Spring','React','AWS','FHIR'], 'CVS Health will sponsor H-1B work authorization for qualified candidates with specialized skills.', NOW() - INTERVAL '9 hours', NOW(), true FROM companies WHERE domain = 'cvshealth.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Data Analyst, Pharmacy Analytics', 'Data Analyst', 'Analytics', 'Remote', true, false, 'fulltime', 'mid', 75000, 110000, 'https://jobs.cvshealth.com/15002', 'cvs-15002', false, 55, ARRAY['SQL','Tableau','Python','Healthcare Data','Excel'], NOW() - INTERVAL '4 days', NOW(), true FROM companies WHERE domain = 'cvshealth.com';

-- UnitedHealth Group
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Optum Digital', 'Software Engineer', 'Optum Technology', 'Eden Prairie, MN', false, true, 'fulltime', 'mid', 110000, 165000, 'https://careers.unitedhealthgroup.com/16001', 'uhg-16001', true, 78, ARRAY['Java','Microservices','AWS','React','HL7'], 'UnitedHealth Group is committed to workforce diversity and provides H-1B visa sponsorship for qualified technical candidates.', NOW() - INTERVAL '6 hours', NOW(), true FROM companies WHERE domain = 'unitedhealthgroup.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Machine Learning Engineer, Claims AI', 'ML Engineer', 'AI & Data Science', 'Remote', true, false, 'fulltime', 'senior', 145000, 210000, 'https://careers.unitedhealthgroup.com/16002', 'uhg-16002', true, 80, ARRAY['Python','TensorFlow','NLP','Healthcare AI','Apache Kafka'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'unitedhealthgroup.com';

-- Nike
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Digital Commerce', 'Senior Software Engineer', 'Nike Digital', 'Beaverton, OR', false, true, 'fulltime', 'senior', 135000, 195000, 'https://jobs.nike.com/17001', 'nike-17001', true, 71, ARRAY['Node.js','React','GraphQL','AWS','TypeScript'], 'Nike may provide H-1B sponsorship for uniquely qualified candidates on a case-by-case basis.', NOW() - INTERVAL '11 hours', NOW(), true FROM companies WHERE domain = 'nike.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Data Scientist, Consumer Analytics', 'Data Scientist', 'Consumer Analytics', 'Portland, OR', false, true, 'fulltime', 'mid', 110000, 160000, 'https://jobs.nike.com/17002', 'nike-17002', true, 68, ARRAY['Python','R','SQL','A/B Testing','Retail Analytics'], NOW() - INTERVAL '5 days', NOW(), true FROM companies WHERE domain = 'nike.com';

-- Airbnb
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Trust & Safety', 'Software Engineer', 'Trust', 'San Francisco, CA', false, true, 'fulltime', 'mid', 160000, 235000, 'https://careers.airbnb.com/18001', 'airbnb-18001', true, 81, ARRAY['Python','Java','Machine Learning','Fraud Detection','Kafka'], 'Airbnb sponsors H-1B visas and provides comprehensive immigration support for all qualifying employees globally.', NOW() - INTERVAL '4 hours', NOW(), true FROM companies WHERE domain = 'airbnb.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Product Designer', 'Senior Product Designer', 'Design', 'San Francisco, CA', false, true, 'fulltime', 'senior', 155000, 225000, 'https://careers.airbnb.com/18002', 'airbnb-18002', true, 79, ARRAY['Figma','Product Design','Design Systems','User Research','Prototyping'], NOW() - INTERVAL '3 days', NOW(), true FROM companies WHERE domain = 'airbnb.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'ML Engineer, Search & Discovery', 'ML Engineer', 'Search', 'San Francisco, CA', false, true, 'fulltime', 'senior', 185000, 265000, 'https://careers.airbnb.com/18003', 'airbnb-18003', true, 85, ARRAY['Python','PyTorch','Search Ranking','NLP','Spark'], NOW() - INTERVAL '1 day', NOW(), true FROM companies WHERE domain = 'airbnb.com';

-- Cloudflare
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Software Engineer, Edge Network', 'Software Engineer', 'Engineering', 'Austin, TX', false, true, 'fulltime', 'mid', 150000, 215000, 'https://www.cloudflare.com/careers/19001', 'cf-19001', true, 78, ARRAY['Rust','Go','Networking','Linux','Distributed Systems'], 'Cloudflare will sponsor visas for roles where we cannot find qualified local candidates. H-1B sponsorship available.', NOW() - INTERVAL '7 hours', NOW(), true FROM companies WHERE domain = 'cloudflare.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Reliability Engineer', 'Senior SRE', 'Infrastructure', 'Remote', true, false, 'fulltime', 'senior', 165000, 235000, 'https://www.cloudflare.com/careers/19002', 'cf-19002', true, 76, ARRAY['SRE','Kubernetes','Prometheus','Go','Incident Response'], NOW() - INTERVAL '2 days', NOW(), true FROM companies WHERE domain = 'cloudflare.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Security Research Engineer', 'Security Engineer', 'Security Research', 'San Francisco, CA', false, true, 'fulltime', 'senior', 175000, 250000, 'https://www.cloudflare.com/careers/19003', 'cf-19003', true, 80, ARRAY['Security Research','Reverse Engineering','Cryptography','Python','C'], NOW() - INTERVAL '4 days', NOW(), true FROM companies WHERE domain = 'cloudflare.com';

-- Databricks
INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, description, first_detected_at, last_seen_at, is_active)
SELECT id, 'Senior Software Engineer, Spark Core', 'Senior Software Engineer', 'Engineering', 'San Francisco, CA', false, true, 'fulltime', 'senior', 195000, 285000, 'https://www.databricks.com/company/careers/20001', 'db-20001', true, 84, ARRAY['Scala','Java','Apache Spark','Distributed Computing','SQL'], 'Databricks actively supports H-1B sponsorship and immigration assistance for all qualifying technical employees.', NOW() - INTERVAL '2 hours', NOW(), true FROM companies WHERE domain = 'databricks.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Staff ML Engineer, Data Intelligence', 'Staff ML Engineer', 'AI Research', 'Seattle, WA', false, true, 'fulltime', 'staff', 225000, 330000, 'https://www.databricks.com/company/careers/20002', 'db-20002', true, 88, ARRAY['Python','PyTorch','LLMs','Spark','MLflow'], NOW() - INTERVAL '6 hours', NOW(), true FROM companies WHERE domain = 'databricks.com';

INSERT INTO jobs (company_id, title, normalized_title, department, location, is_remote, is_hybrid, employment_type, seniority_level, salary_min, salary_max, apply_url, external_id, sponsors_h1b, sponsorship_score, skills, first_detected_at, last_seen_at, is_active)
SELECT id, 'Product Manager, Lakehouse', 'Product Manager', 'Product', 'San Francisco, CA', false, true, 'fulltime', 'senior', 165000, 240000, 'https://www.databricks.com/company/careers/20003', 'db-20003', true, 82, ARRAY['Data Engineering','Cloud Platforms','SQL','APIs','Product Analytics'], NOW() - INTERVAL '4 days', NOW(), true FROM companies WHERE domain = 'databricks.com';

-- =============================================================================
-- Update job_count on companies to reflect seeded jobs
-- =============================================================================
UPDATE companies c
SET job_count = (
  SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.is_active = true
);
