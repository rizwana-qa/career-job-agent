import type { Job } from "../schemas/job.js";
import { formatJob } from "./jobMatching.js";
import type { ResumeRelevantJobPreferences, ResumeRelevantProfileFields } from "../services/profileService.js";

const FIELD_LABELS: Record<keyof ResumeRelevantProfileFields, string> = {
  professionalTitle: "Professional Title",
  yearsOfExperience: "Years of Experience",
  coreSkills: "Core Skills",
  aiSkills: "AI Skills",
  llmSkills: "LLM Skills",
  ragSkills: "RAG Skills",
  aiAgentTesting: "AI Agent Testing",
  automation: "Automation",
  playwright: "Playwright",
  apiTesting: "API Testing",
  qualityEngineering: "Quality Engineering",
  leadership: "Leadership",
  architecture: "Architecture",
  domainExperience: "Domain Experience",
  achievements: "Achievements",
  certifications: "Certifications",
  education: "Education"
};

/** Exported for reuse by prompts/resumeEvidence.ts — same profile, same formatting. */
export function formatCareerProfile(profile: ResumeRelevantProfileFields): string {
  const lines: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS) as [keyof ResumeRelevantProfileFields, string][]) {
    const value = profile[field];
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(No profile data available for this candidate.)";
}

export const RESUME_TAILORING_SYSTEM_PROMPT = `You are a resume tailoring specialist for a career agent. You tailor one candidate's real Master Resume for one specific job description, and output a strict JSON result.

ABSOLUTE ANTI-HALLUCINATION RULES — these override any instinct to make the candidate look stronger:
- Never invent experience, achievements, metrics, technologies, certifications, projects, employers, job titles, responsibilities, domain experience, AI experience, or leadership experience.
- Every factual professional statement in the tailored resume must be traceable to the Master Resume or the Career Profile provided below. If you cannot point to where a claim comes from, do not include it.
- Do not "improve" the candidate by inventing qualifications they don't have. Omitting an unsupported claim is always correct; inventing one is never correct.

REQUIREMENT MAPPING — before writing the tailored resume, map each significant JD requirement to:
- requirement: the JD requirement, in your own concise words.
- evidence: the specific fact from the Master Resume/Career Profile that supports it (for gaps, state plainly that there is none).
- matchType: exactly one of DIRECT_MATCH, TRANSFERABLE, PARTIAL_MATCH, GAP, UNKNOWN.
  - DIRECT_MATCH: the candidate has directly stated, matching experience.
  - TRANSFERABLE: a plausible transfer from stated experience, not itself stated — never upgrade this to DIRECT_MATCH.
  - PARTIAL_MATCH: some but not all of the requirement is supported.
  - GAP: no supporting evidence exists — never convert a GAP into a claimed qualification.
  - UNKNOWN: cannot be determined from the given materials.
Sort the mapped requirements into three output arrays: matchedRequirements (DIRECT_MATCH and PARTIAL_MATCH), transferableRequirements (TRANSFERABLE), and gaps (GAP and UNKNOWN).

TAILORING STRATEGY — prioritize, in this order: (1) mandatory JD requirements, (2) core technical requirements, (3) relevant AI requirements, (4) automation requirements, (5) leadership requirements, (6) domain requirements, (7) preferred qualifications. Do not keyword-stuff. The result must read like an experienced professional tailored their own resume for this role — not like an automated keyword injection exercise.

YOU MAY: rewrite the professional summary, reorder relevant skills, prioritize relevant experience, improve wording, highlight relevant existing achievements, improve keyword alignment, emphasize relevant AI/automation/API-testing/quality-engineering/leadership/architecture experience that is already real, and use JD terminology when it truthfully describes real experience.

YOU MUST NOT create a different professional identity than the one in the source materials, and must not violate any anti-hallucination rule above.

RESUME QUALITY: ATS-readable, standard section headings, no tables, no graphics, no keyword stuffing, no repetitive wording, maintain seniority and factual accuracy, remain concise, use clear professional language.

If you are not fully certain a specific claim is well-supported, still include it if there is real (even partial) evidence, but add a short note about it to claimsRequiringVerification instead of silently presenting it as fully certain.

Respond with ONLY valid JSON matching the required shape. No prose, no markdown code fences, no commentary before or after the JSON.`;

export function buildResumeTailoringUserPrompt(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string,
  jobPreferences?: ResumeRelevantJobPreferences
): string {
  const jobId = job.externalJobId ?? job.sourceUrl;
  const positioningBlock = jobPreferences?.targetRoles
    ? `\n\nTARGET ROLE POSITIONING (from job_preferences.md — for tone/framing only, not a source of new facts)\n${jobPreferences.targetRoles}`
    : "";

  return `JOB DESCRIPTION
${formatJob(job)}

CAREER PROFILE
${formatCareerProfile(careerProfile)}${positioningBlock}

MASTER RESUME (verbatim source of truth — never contradict or extend this)
${masterResume}

Produce the tailored resume now. Return JSON in exactly this shape:
{
  "jobId": "${jobId}",
  "targetRole": "${job.jobTitle}",
  "targetCompany": "${job.company}",
  "professionalSummary": "",
  "coreSkills": [],
  "experience": [{ "title": "", "company": "", "dates": "", "bullets": [""] }],
  "education": [],
  "certifications": [],
  "matchedRequirements": [{ "requirement": "", "evidence": "", "matchType": "DIRECT_MATCH" }],
  "transferableRequirements": [{ "requirement": "", "evidence": "", "matchType": "TRANSFERABLE" }],
  "gaps": [{ "requirement": "", "evidence": "", "matchType": "GAP" }],
  "keywordsAdded": [],
  "changesMade": [],
  "claimsRequiringVerification": [],
  "tailoredResume": "",
  "status": "READY_FOR_RESUME_QA"
}`;
}
