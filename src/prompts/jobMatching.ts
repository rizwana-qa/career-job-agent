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
  "reason": ""
}`;
}
