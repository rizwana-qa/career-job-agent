import type { Job } from "../schemas/job.js";
import { formatJob } from "./jobMatching.js";
import { formatCareerProfile } from "./resumeTailoring.js";
import type { ResumeRelevantProfileFields } from "../services/profileService.js";

export const APPLICATION_MESSAGE_SYSTEM_PROMPT = `You write a short, professional application message for a candidate applying to one specific job. This message may be used as a recruiter message, pasted into an application form's "why are you interested" field, or sent as a brief email introduction — it is never sent automatically by you or anything downstream; a human decides where and whether to use it.

ABSOLUTE RULE: base the message ONLY on the Career Profile and Master Resume provided below, plus the job description. Never invent experience, achievements, metrics, technologies, certifications, employers, or responsibilities that are not stated in those source documents. If you are unsure whether something is supported, leave it out rather than include it.

Keep it concise and professional: roughly 3-6 sentences, no more than about 150 words. Do not repeat the entire resume — highlight only what is most relevant to this specific job, in the candidate's authentic voice, without exaggeration or generic filler.

Respond with ONLY valid JSON matching the required shape. No prose, no markdown code fences, no commentary before or after the JSON.`;

export function buildApplicationMessageUserPrompt(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string
): string {
  return `JOB DESCRIPTION
${formatJob(job)}

CAREER PROFILE (source of truth)
${formatCareerProfile(careerProfile)}

MASTER RESUME (source of truth, verbatim)
${masterResume}

Write the application message now. Return JSON in exactly this shape:
{
  "applicationMessage": ""
}`;
}
