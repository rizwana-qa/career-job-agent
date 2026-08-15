import type { Job } from "../schemas/job.js";
import { formatJob } from "./jobMatching.js";
import { formatCareerProfile } from "./resumeTailoring.js";
import type { TailoredResume } from "../schemas/tailoredResume.js";
import type { ResumeEvidenceReport } from "../schemas/resumeEvidence.js";
import type { ResumeRelevantProfileFields } from "../services/profileService.js";

function formatTailoredResume(tr: TailoredResume): string {
  const experienceBlock =
    tr.experience
      .map((entry, i) => {
        const bullets = entry.bullets.map((b) => `      - ${b}`).join("\n");
        return `  [${i}] ${entry.title} @ ${entry.company} (${entry.dates})\n${bullets}`;
      })
      .join("\n") || "  (none)";

  return [
    `Target Role: ${tr.targetRole} @ ${tr.targetCompany}`,
    `Professional Summary: ${tr.professionalSummary}`,
    `Core Skills: ${tr.coreSkills.join(", ") || "(none)"}`,
    `Experience:\n${experienceBlock}`,
    `Education: ${tr.education.join("; ") || "(none)"}`,
    `Certifications: ${tr.certifications.join("; ") || "(none)"}`,
    `Full Tailored Resume Text: ${tr.tailoredResume}`,
    "",
    "--- Resume Tailoring Agent's own self-reported claims (UNVERIFIED — this was produced by a separate, untrusted generation step; verify everything independently rather than assuming any of it is correct) ---",
    `Matched Requirements (self-reported): ${JSON.stringify(tr.matchedRequirements)}`,
    `Transferable Requirements (self-reported): ${JSON.stringify(tr.transferableRequirements)}`,
    `Gaps (self-reported): ${JSON.stringify(tr.gaps)}`,
    `Keywords Added (self-reported): ${tr.keywordsAdded.join(", ") || "(none)"}`,
    `Claims Requiring Verification (self-flagged by the Tailoring Agent): ${
      tr.claimsRequiringVerification.join("; ") || "(none)"
    }`
  ].join("\n");
}

function formatEvidenceGuardResult(eg: ResumeEvidenceReport): string {
  return [
    `Evidence Guard Status: ${eg.status} (evidenceScore: ${eg.evidenceScore}, claimsReviewed: ${eg.claimsReviewed})`,
    "",
    "--- Evidence Guard's own findings (UNVERIFIED — a separate automated pass; independently review every claim rather than assuming it is correct) ---",
    `Supported Claims: ${JSON.stringify(eg.supportedClaims)}`,
    `Transferable Claims: ${JSON.stringify(eg.transferableClaims)}`,
    `Potentially Unsupported Claims: ${JSON.stringify(eg.potentiallyUnsupportedClaims)}`,
    `Unsupported Claims: ${JSON.stringify(eg.unsupportedClaims)}`,
    `Unknown Claims: ${JSON.stringify(eg.unknownClaims)}`,
    `Evidence Guard Recommendations: ${eg.recommendations.join("; ") || "(none)"}`
  ].join("\n");
}

export const RESUME_QA_SYSTEM_PROMPT = `You are an independent Resume QA reviewer for a career agent, acting simultaneously as: a Principal Software Quality Engineer, a Senior Technical Recruiter, an ATS Resume Reviewer, a Hiring Manager, and an AI Quality Reviewer.

TRUST BOUNDARY — READ THIS FIRST:
You must NOT trust the Resume Tailoring Agent's output. Treat the tailored resume as an untrusted generated artifact that may contain fabricated or exaggerated claims, regardless of how confident or well-formatted it looks. You must ALSO independently verify the Evidence Guard result rather than assuming it is correct — it is a separate automated pass, not a final verdict. Your job is to compare the tailored resume against the real source of truth: the Master Resume and the Career Profile, provided below. Anything not traceable to those two documents is suspect.

EVALUATE ACROSS ALL OF THESE DIMENSIONS:
A. Factual Accuracy — B. Evidence Support — C. JD Alignment — D. Technical Skill Alignment — E. Seniority Alignment — F. AI Skill Alignment — G. Automation Alignment — H. Leadership Alignment — I. Architecture Alignment — J. ATS Readability — K. Keyword Quality — L. Keyword Overuse — M. Professional Summary — N. Experience Relevance — O. Achievement Quality — P. Clarity — Q. Conciseness — R. Repetition — S. Credibility — T. Overall Interview Readiness.

FACTUAL ACCURACY (compare the tailored resume against the Master Resume, Career Profile, AND the Evidence Guard result):
Identify any invented experience, technologies, certifications, metrics, responsibilities, job titles, or employers, and any unsupported leadership, AI, or domain claims. Any clearly unsupported professional claim is a CRITICAL issue.

JD REQUIREMENT COVERAGE:
Extract the important requirements from the job description and classify each as DIRECT_MATCH, TRANSFERABLE, PARTIAL_MATCH, GAP, or UNKNOWN — never classify a GAP as any kind of match, and never penalize the resume for a requirement that is clearly irrelevant to it. Separate mandatory requirements from preferred/nice-to-have requirements into mandatoryRequirements and preferredRequirements.

ATS / JD ALIGNMENT REVIEW:
Evaluate job title alignment, relevant keywords, technical terminology, standard section headings, readable formatting, experience chronology, skills discoverability, and keyword placement. Produce a jdAlignmentScore (0-100). You are NOT reproducing the behavior of any commercial ATS product — never call this an "ATS Score." Call it exactly "JD Alignment Score."

KEYWORD ANALYSIS:
Report supportedKeywords (JD-relevant terms genuinely backed by the source material), missingImportantKeywords (JD-relevant terms the resume lacks, that the candidate does NOT have evidence for — never recommend adding a keyword the candidate has no evidence for), unsupportedKeywords (JD-relevant terms present in the tailored resume that are NOT backed by the source material — a red flag), and overusedKeywords (terms repeated to the point of looking like keyword stuffing).

SENIORITY CHECK:
Check whether the resume accurately reflects the candidate's real seniority — senior-level responsibilities, architecture ownership, technical ownership, leadership, decision-making, quality strategy, cross-team impact, complex systems, automation ownership, AI quality responsibilities — all only as far as the source material actually supports. Do not artificially increase seniority, and do not accept a resume that artificially increases it either.

AI EXPERIENCE CHECK (pay special attention here):
For every AI-related claim (LLM testing, RAG testing, AI agent testing, AI evaluation, AI quality engineering, AI assurance, prompt testing, AI automation), only accept it if the Career Profile or Master Resume supports it. Distinguish existing experience, transferable experience, mere learning exposure, and unsupported claims — these are not the same thing and must not be blurred together.

ISSUE SEVERITY — classify every issue exactly one of CRITICAL, HIGH, MEDIUM, LOW:
- CRITICAL: fabricated experience, fabricated certification, fabricated achievement, fabricated technology, or any other major false claim.
- HIGH: an important mandatory JD requirement missing, a major seniority mismatch, a major unsupported AI claim, or a major positioning problem.
- MEDIUM: weak achievement wording, a missing relevant (but not critical) keyword, poor ordering, repetition.
- LOW: a minor wording issue or a minor formatting issue.
Put each issue's severity in its own "severity" field AND in the correct bucket array (criticalIssues/highIssues/mediumIssues/lowIssues) — keep these consistent with each other.

FINAL DECISION — status must be exactly one of PASS, FAIL, REVIEW_REQUIRED:
- PASS: no critical issues, no high-severity issues, the resume is credible, and it is sufficiently aligned with the JD.
- FAIL: a critical factual issue exists, OR a serious unsupported claim exists, OR the resume materially misrepresents the candidate.
- REVIEW_REQUIRED: the resume is mostly valid but needs human review before it can be approved.
Keep overallScore internally consistent with your own status and issues — a FAIL should correspond to a low overallScore (generally well under 50), not a high one.

Set humanReviewRequired to true whenever any CRITICAL or HIGH issue exists, or whenever you are uncertain. The system must never automatically approve a resume that has CRITICAL or HIGH severity issues.

Respond with ONLY valid JSON matching the required shape. No prose, no markdown code fences, no commentary before or after the JSON.`;

export function buildResumeQAUserPrompt(
  job: Job,
  careerProfile: ResumeRelevantProfileFields,
  masterResume: string,
  tailoredResume: TailoredResume,
  evidenceGuardResult: ResumeEvidenceReport
): string {
  return `JOB DESCRIPTION
${formatJob(job)}

CAREER PROFILE (source of truth)
${formatCareerProfile(careerProfile)}

MASTER RESUME (source of truth, verbatim)
${masterResume}

TAILORED RESUME (untrusted — produced by a separate agent, verify independently)
${formatTailoredResume(tailoredResume)}

EVIDENCE GUARD RESULT (untrusted — produced by a separate automated pass, verify independently)
${formatEvidenceGuardResult(evidenceGuardResult)}

Perform the independent QA review now. Return JSON in exactly this shape:
{
  "status": "PASS | FAIL | REVIEW_REQUIRED",
  "overallScore": 0,
  "jdAlignmentScore": 0,
  "factualAccuracyScore": 0,
  "interviewReadinessScore": 0,
  "criticalIssues": [{ "severity": "CRITICAL", "dimension": "", "description": "", "evidence": "" }],
  "highIssues": [{ "severity": "HIGH", "dimension": "", "description": "", "evidence": "" }],
  "mediumIssues": [{ "severity": "MEDIUM", "dimension": "", "description": "", "evidence": "" }],
  "lowIssues": [{ "severity": "LOW", "dimension": "", "description": "", "evidence": "" }],
  "strengths": [],
  "mandatoryRequirements": [{ "requirement": "", "evidence": "", "matchType": "DIRECT_MATCH" }],
  "preferredRequirements": [{ "requirement": "", "evidence": "", "matchType": "TRANSFERABLE" }],
  "supportedKeywords": [],
  "missingImportantKeywords": [],
  "unsupportedKeywords": [],
  "overusedKeywords": [],
  "unsupportedClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "UNSUPPORTED" }],
  "transferableClaims": [{ "claim": "", "sourceLocation": "", "evidence": "", "classification": "TRANSFERABLE" }],
  "recommendations": [],
  "humanReviewRequired": false
}`;
}
