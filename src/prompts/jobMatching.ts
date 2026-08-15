import type { Job } from "../schemas/job.js";
import type { RelevantProfileFields } from "../services/profileService.js";

const FIELD_LABELS: Record<keyof RelevantProfileFields, string> = {
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
  domainExperience: "Domain Experience"
};

function formatProfile(profile: RelevantProfileFields): string {
  const lines: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS) as [keyof RelevantProfileFields, string][]) {
    const value = profile[field];
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(No profile data available for this candidate.)";
}

/** Exported for reuse by prompts/resumeTailoring.ts — same job, same facts, no need to duplicate the formatting. */
export function formatJob(job: Job): string {
  return [
    `Title: ${job.jobTitle}`,
    `Company: ${job.company}`,
    `Location: ${job.location}, ${job.country} (${job.remoteStatus})`,
    `Employment Type: ${job.employmentType}`,
    `Description: ${job.jobDescription}`,
    `Requirements: ${job.requirements.join("; ")}`,
    `Responsibilities: ${job.responsibilities.join("; ")}`,
    `Skills: ${job.skills.join(", ")}`
  ].join("\n");
}

const TARGET_CAREER_FAMILY = `Principal Software Quality Engineer, Staff QA Engineer, Lead QA Engineer, QA Architect, Quality Engineering Manager, AI Quality Engineer, AI Test Engineer, LLM Testing, RAG Testing, AI Agent Testing, SDET, Automation Architect, API Testing Lead, Software Quality Architect`;

const CAREER_RELEVANCE_POSITIVE_SIGNALS = `QA, Quality Engineering, Software Testing, SDET, Automation, Test Automation, Software Quality, Quality Assurance, QA Architecture, AI Quality, AI Testing, LLM Testing, RAG Testing, Agent Testing, AI Agent, API Testing, Performance Testing, Automation Architecture, Software Testing Strategy, Engineering Quality Leadership`;

export const JOB_MATCHING_SYSTEM_PROMPT = `You are a job-fit evaluator for a career agent. You compare one candidate's real career profile against one job description and output a strict JSON assessment.

Non-negotiable rules:
- Never invent, assume, or embellish experience the profile does not state.
- Never assume a qualification not directly supported by the profile.
- Every claim in strongMatches, transferableSkills, gaps, and risks must be labeled with an "evidence" level:
  - FACT: directly stated in the candidate's profile.
  - INFERENCE: a plausible transfer from stated experience, not itself stated.
  - UNKNOWN: the profile does not establish this either way.
- Never upgrade an INFERENCE to a FACT.
- matchScore, interviewPotential, careerGrowth, and futureAIValue are integers from 0 to 100. They are estimates of relevance, never a real ATS score.
- recommendation must be exactly one of: APPLY, CONSIDER, REJECT.

CAREER RELEVANCE SCORE — a separate judgment from matchScore:
- matchScore measures how well THIS job fits the candidate's OWN stated skills and experience.
- careerRelevanceScore (0-100, integer) measures something different: how strongly this role itself belongs to the candidate's target career family, independent of whether the candidate personally qualifies for it.
- Target career family (roles that belong here by definition): ${TARGET_CAREER_FAMILY}.
- Related roles may also score highly on careerRelevanceScore when they have strong genuine overlap with: ${CAREER_RELEVANCE_POSITIVE_SIGNALS}. Judge overlap by what the role actually IS and DOES day-to-day, not by matching isolated keywords — a role whose title and core responsibilities are quality engineering/testing/automation-centered belongs here even if the exact title varies; a role whose title and core responsibilities are something else entirely (e.g. IT help desk, service desk, desktop support, system/network administration, NOC, general IT operations/infrastructure support) does NOT belong here even if it incidentally mentions a related tool or system once. A single incidental phrase (e.g. "QA Engineer supporting IT service desk software" — this is a QA role, not a service desk role) must never by itself drag the score down; judge the role as a whole.
- Score low (well under 70) for roles that are fundamentally a different career family, even if some individual factors elsewhere in your assessment look favorable.

Also provide:
- whySelected: one short sentence explaining why this role is (or is not) a strong fit for the candidate's target career direction — safe to show the candidate directly, no job description text, no profile content verbatim.

- Respond with ONLY valid JSON matching the required shape. No prose, no markdown code fences, no commentary before or after the JSON.`;

export function buildJobMatchingUserPrompt(job: Job, profile: RelevantProfileFields): string {
  return `CANDIDATE PROFILE
${formatProfile(profile)}

JOB DESCRIPTION
${formatJob(job)}

Evaluate this job against the candidate profile across: Technical Match, Quality Engineering Match, Automation Match, API Testing Match, AI Match, LLM Match, RAG Match, AI Agent Testing Match, Leadership Match, Architecture Match, Domain Match, Seniority Match, and Transferable Skills.

Return JSON in exactly this shape:
{
  "matchScore": 0,
  "interviewPotential": 0,
  "careerGrowth": 0,
  "futureAIValue": 0,
  "recommendation": "APPLY | CONSIDER | REJECT",
  "strongMatches": [{ "statement": "", "evidence": "FACT | INFERENCE | UNKNOWN" }],
  "transferableSkills": [{ "statement": "", "evidence": "FACT | INFERENCE | UNKNOWN" }],
  "gaps": [{ "statement": "", "evidence": "FACT | INFERENCE | UNKNOWN" }],
  "risks": [{ "statement": "", "evidence": "FACT | INFERENCE | UNKNOWN" }],
  "reason": "",
  "careerRelevanceScore": 0,
  "whySelected": ""
}`;
}
