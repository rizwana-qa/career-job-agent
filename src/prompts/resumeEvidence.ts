import type { TailoredResume } from "../schemas/tailoredResume.js";
import { formatCareerProfile } from "./resumeTailoring.js";
import type { ResumeRelevantProfileFields } from "../services/profileService.js";

function formatTailoredResumeFreeText(tailoredResume: TailoredResume): string {
  const experienceBlock = tailoredResume.experience
    .map((entry, i) => {
      const bullets = entry.bullets.map((b, j) => `    - experience[${i}].bullets[${j}]: ${b}`).join("\n");
      return `  experience[${i}] (${entry.title} @ ${entry.company}, ${entry.dates}):\n${bullets}`;
    })
    .join("\n");

  return [
    `professionalSummary: ${tailoredResume.professionalSummary}`,
    `experience:\n${experienceBlock || "  (none)"}`,
    `tailoredResume: ${tailoredResume.tailoredResume}`
  ].join("\n\n");
}

export const RESUME_EVIDENCE_SYSTEM_PROMPT = `You are an independent evidence auditor for a career agent. You do NOT write or rewrite resumes. Your only job is to extract every discrete factual claim from the free-text portions of an already-tailored resume, and classify each claim against the candidate's real source material (Master Resume and Career Profile).

YOU MUST NOT rewrite, edit, improve, or suggest replacement wording for the resume text itself. You are an auditor, not an editor. Your output is claims and classifications only, for a separate Resume QA step to act on.

For every discrete factual claim you find (an achievement, a metric, a technology used, a responsibility, a scope of leadership, an AI/RAG/automation claim, anything that asserts the candidate did or knows something), record:
- claim: the claim itself, in the candidate's own words from the text (verbatim or very close to it).
- sourceLocation: exactly where it came from — "professionalSummary", "experience[<index>].bullets[<index>]", or "tailoredResume".
- evidence: the specific fact from the Master Resume/Career Profile that supports or fails to support it. If there is truly no supporting evidence, say so plainly (e.g. "No mention of this in the Master Resume or Career Profile.") — never leave this blank.
- classification: exactly one of SUPPORTED, TRANSFERABLE, POTENTIALLY_UNSUPPORTED, UNSUPPORTED, UNKNOWN.

Classification definitions — apply them exactly as written:
- SUPPORTED: the source material clearly supports the claim as stated.
- TRANSFERABLE: the source demonstrates related experience, but not the exact claim as stated.
- POTENTIALLY_UNSUPPORTED: the wording may imply more experience, scope, or certainty than the source material actually establishes (e.g. a vague claim strengthened, a scope expanded, a one-time event implied as routine).
- UNSUPPORTED: no evidence for this claim exists anywhere in the supplied source material.
- UNKNOWN: there is not enough information in the source material to determine support either way.

Be skeptical and literal. A claim that is directionally similar to something in the source is not automatically SUPPORTED — if the wording is stronger, broader, or more specific than what the source actually says, classify it POTENTIALLY_UNSUPPORTED or TRANSFERABLE instead, and explain why in the evidence field.

Also provide a short list of plain-language recommendations for a human reviewer (e.g. "Verify the exact percentage cited in professionalSummary before submitting" or "Confirm the scope of team size mentioned in experience[0]"). Recommendations are advisory text, not claims — do not classify them.

Respond with ONLY valid JSON matching the required shape. No prose, no markdown code fences, no commentary before or after the JSON.`;

export function buildResumeEvidenceUserPrompt(
  masterResume: string,
  careerProfile: ResumeRelevantProfileFields,
  tailoredResume: TailoredResume
): string {
  return `MASTER RESUME (source of truth)
${masterResume}

CAREER PROFILE (source of truth)
${formatCareerProfile(careerProfile)}

TAILORED RESUME FREE TEXT TO AUDIT (do not rewrite this — only extract and classify claims from it)
${formatTailoredResumeFreeText(tailoredResume)}

Extract and classify every discrete factual claim from the free text above. Return JSON in exactly this shape:
{
  "status": "PASS | REVIEW_REQUIRED",
  "evidenceScore": 0,
  "claimsReviewed": 0,
  "supportedClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "SUPPORTED" }],
  "transferableClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "TRANSFERABLE" }],
  "potentiallyUnsupportedClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "POTENTIALLY_UNSUPPORTED" }],
  "unsupportedClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "UNSUPPORTED" }],
  "unknownClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "UNKNOWN" }],
  "recommendations": []
}`;
}
