// Evidence policy validation (spec 5.1). The client enforces this before enabling
// the Done button; the server re-validates at done_reported. A done_reported whose
// evidence is short is folded but the instance routes to needs_review with the
// deficiency noted, never bounced back to the phone (spec 6.2 semantics).

// Returns { ok, problems, field_problems, media_short }. Field problems are
// review-worthy; media shortfalls only mean "wait for the deferred blob"
// (spec 5.3: records are complete and verifiable-pending-media immediately).
export function validateEvidence(policy, summary) {
  const problems = [];
  const fieldProblems = [];
  const mediaProblems = [];
  if (!policy || !policy.classes || policy.classes.length === 0) {
    return { ok: true, problems, field_problems: fieldProblems, media_short: false };
  }

  const classes = policy.classes;
  const fields = summary.fields || {};
  const photos = summary.photo_count || 0;
  const videos = summary.video_count || 0;
  const voices = summary.voice_count || 0;

  // any_of: at least one of the listed classes must be satisfied (e.g. W-E3: photo or voice)
  if (policy.any_of) {
    const satisfied = policy.any_of.some((cls) => {
      if (cls === "E2") return photos >= 1;
      if (cls === "E5") return voices >= 1;
      if (cls === "E4") return videos >= 1;
      return false;
    });
    if (!satisfied) {
      problems.push(`requires one of: ${policy.any_of.join(", ")}`);
      mediaProblems.push(problems[0]);
    }
    return { ok: problems.length === 0, problems, field_problems: [], media_short: mediaProblems.length > 0 };
  }

  if (classes.includes("E1") && policy.fields) {
    for (const f of policy.fields) {
      const v = fields[f.key];
      if (v === undefined || v === null || v === "") {
        fieldProblems.push(`missing field ${f.key}`);
        continue;
      }
      if (f.type === "number") {
        const n = Number(v);
        if (Number.isNaN(n)) fieldProblems.push(`field ${f.key} not a number`);
        else {
          if (f.min !== undefined && n < f.min) fieldProblems.push(`field ${f.key} below min ${f.min}`);
          if (f.max !== undefined && n > f.max) fieldProblems.push(`field ${f.key} above max ${f.max}`);
        }
      }
      if (f.type === "choice" && f.options && !f.options.includes(v)) {
        fieldProblems.push(`field ${f.key} not in options`);
      }
    }
  }
  if (classes.includes("E2") || classes.includes("E3")) {
    const min = policy.photo_min ?? (classes.includes("E3") ? 2 : 1);
    if (photos < min) mediaProblems.push(`needs ${min} photo(s), has ${photos}`);
  }
  if (classes.includes("E4")) {
    const min = policy.video_min ?? 1;
    if (videos < min) mediaProblems.push(`needs ${min} video(s), has ${videos}`);
  }
  if (classes.includes("E5")) {
    const min = policy.voice_min ?? 1;
    if (voices < min) mediaProblems.push(`needs ${min} voice note(s), has ${voices}`);
  }
  problems.push(...fieldProblems, ...mediaProblems);
  return {
    ok: problems.length === 0,
    problems,
    field_problems: fieldProblems,
    media_short: mediaProblems.length > 0,
  };
}

// Random audit sampling for E0 tasks (spec 5.1): 1 in 7 instances silently upgrades
// to E2 at release. Deterministic from the instance id so release stays idempotent.
export function e0AuditUpgrade(policy, instanceUuid) {
  if (!policy?.e0_sampled) return policy;
  const n = parseInt(instanceUuid.replaceAll("-", "").slice(0, 8), 16);
  if (n % 7 === 0) {
    return { ...policy, classes: ["E2"], photo_min: 1, audit_upgraded: true };
  }
  return policy;
}
