// Task instance state machine (spec 3.2).
// Every transition is a TaskEvent; this module answers "is this transition legal
// and what is the resulting state". The fold applies it.

export const TERMINAL_STATES = new Set(["verified_closed", "skipped", "expired", "cancelled", "superseded"]);

// eventType -> { from: [states allowed], to: state | fn(instance, payload) }
const TRANSITIONS = {
  released: { from: ["scheduled", "missed"], to: "released" },
  seen: { from: ["released"], to: "acknowledged" },
  started: { from: ["acknowledged", "released"], to: "in_progress" },
  field_recorded: { from: ["released", "acknowledged", "in_progress"], to: (i) => i.state }, // data event, no state change
  media_attached: { from: null, to: (i) => i.state }, // legal in any non-terminal state
  done_reported: { from: ["released", "acknowledged", "in_progress"], to: "done_reported" },
  skip_requested: { from: ["released", "acknowledged", "in_progress"], to: "skip_pending" },
  problem_flagged: { from: ["released", "acknowledged", "in_progress"], to: "blocked" },
  auto_verified: { from: ["done_reported", "needs_review"], to: "verified_closed" },
  review_required: { from: ["done_reported"], to: "needs_review" },
  verified_closed: { from: ["done_reported", "needs_review"], to: "verified_closed" },
  rejected_reopened: { from: ["needs_review"], to: "released" },
  skip_approved: { from: ["skip_pending"], to: "skipped" },
  skip_denied: { from: ["skip_pending"], to: "released" },
  unblocked: { from: ["blocked"], to: "released" },
  missed: { from: ["released", "acknowledged", "in_progress"], to: "missed" },
  rolled: { from: ["missed"], to: "released" },
  expired: { from: "any_non_terminal", to: "expired" },
  cancelled: { from: "any_non_terminal", to: "cancelled" },
  superseded: { from: "any_non_terminal", to: "superseded" },
  corrected: { from: ["verified_closed"], to: "verified_closed" },
  deferred: { from: ["scheduled", "released", "acknowledged"], to: (i) => i.state },
  reassigned: { from: null, to: (i) => i.state },
  escalated: { from: null, to: (i) => i.state },
  retake_requested: { from: ["done_reported"], to: (i) => i.state },
};

export function applyTransition(instance, eventType) {
  const t = TRANSITIONS[eventType];
  if (!t) return { ok: false, reason: `unknown event type ${eventType}` };
  const state = instance.state;
  if (t.from === "any_non_terminal") {
    if (TERMINAL_STATES.has(state)) return { ok: false, reason: `instance is terminal (${state})` };
  } else if (t.from === null) {
    if (TERMINAL_STATES.has(state) && !["corrected"].includes(eventType)) {
      return { ok: false, reason: `instance is terminal (${state})` };
    }
  } else if (!t.from.includes(state)) {
    return { ok: false, reason: `illegal transition ${state} --${eventType}-->` };
  }
  const next = typeof t.to === "function" ? t.to(instance) : t.to;
  return { ok: true, next };
}

export function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

// Terminal-positive states for KPI purposes (spec 9.2): verified_closed and approved skips.
export const TERMINAL_POSITIVE = new Set(["verified_closed", "skipped"]);
