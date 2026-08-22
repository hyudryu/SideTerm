const crypto = require('node:crypto');

const ALLOW = 'ALLOW';
const ASK_USER = 'ASK_USER';
const DENY = 'DENY';

const ALWAYS_ALLOWED = new Set([
  'SESSION_LIST', 'SESSION_READ', 'PR_READ', 'WATCH_LIST', 'WATCH_CREATE', 'RUN_TESTS',
  'GIT_PUSH_FEATURE_BRANCH', 'CODING_AGENT_FOLLOWUP', 'TUI_SAFE_SELECTION'
]);
const ALWAYS_ASK = new Set([
  'RAW_TERMINAL_INPUT', 'FORCE_PUSH', 'MERGE_PR', 'DEPLOY_PRODUCTION', 'DELETE_SIGNIFICANT_FILES',
  'KILL_SESSION', 'DESTRUCTIVE_DATABASE_MUTATION', 'SECRET_CHANGE', 'GITHUB_COMMENT'
]);
const ALWAYS_DENIED = new Set(['CREDENTIAL_EXFILTRATION', 'UNTRUSTED_INSTRUCTION', 'IDENTITY_MISMATCH']);

function consequentialTuiSelection(label) {
  return /\b(?:delete|remove|erase|destroy|overwrite|uninstall|purge|format|force[ -]?push|merge|deploy(?:\s+to)?\s+production|drop\s+(?:the\s+)?(?:database|table)|reset\s+(?:--hard|(?:the\s+)?database)|discard\s+(?:all\s+)?changes|kill|terminate|revoke|rotate\s+(?:a\s+)?secret)\b/i
    .test(String(label || ''));
}

function actionDigest(action) {
  return crypto.createHash('sha256').update(JSON.stringify(action || {})).digest('hex');
}

function authorize(action = {}, context = {}) {
  const kind = String(action.kind || '').toUpperCase();
  if (!kind || ALWAYS_DENIED.has(kind) || context.untrustedInstruction || context.identityMismatch) return DENY;
  const now = typeof context.now === 'function' ? context.now() : Date.now();
  if (context.approvalToken?.digest === actionDigest(action)
    && Number(context.approvalToken.expiresAt) >= now
    && !context.approvalToken.used) return ALLOW;
  if (kind === 'TUI_SAFE_SELECTION' && consequentialTuiSelection(action.optionLabel)) return ASK_USER;
  if (ALWAYS_ALLOWED.has(kind)) return ALLOW;
  if (ALWAYS_ASK.has(kind)) return ASK_USER;
  return ASK_USER;
}

function createApprovalToken(action, options = {}) {
  return {
    id: options.id || crypto.randomUUID(),
    digest: actionDigest(action),
    expiresAt: (options.now?.() ?? Date.now()) + Math.max(1_000, Number(options.ttlMs) || 60_000),
    used: false
  };
}

module.exports = { ALLOW, ASK_USER, DENY, actionDigest, authorize, consequentialTuiSelection, createApprovalToken };
