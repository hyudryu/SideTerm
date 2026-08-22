const { execFile, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i;
const REACTION_EMOJI = {
  '+1': '👍', '-1': '👎', laugh: '😄', hooray: '🎉', confused: '😕', heart: '❤️', rocket: '🚀', eyes: '👀'
};
const githubTokenCache = new Map();

function parsePullRequestUrl(value) {
  const match = String(value || '').trim().match(PR_URL);
  if (!match) throw new Error('Use a full GitHub pull request URL.');
  return { owner: match[1], repo: match[2], number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}

function githubCliAvailable(environment = process.env) {
  return String(environment.PATH || '').split(path.delimiter).some((directory) => {
    if (!directory) return false;
    try {
      fs.accessSync(path.join(directory, 'gh'), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function githubCliError() {
  const error = new Error('GitHub CLI (gh) is required for pull-request monitoring. Install and authenticate gh, then restart SideTerm.');
  error.code = 'GITHUB_CLI_MISSING';
  return error;
}

function githubRepositoryOwner(cwd) {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return remote.match(/github\.com(?::|\/)([^/]+)\//i)?.[1] || '';
  } catch {
    return '';
  }
}

function githubEnvironment(owner) {
  const environment = { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1' };
  if (!owner || environment.GH_TOKEN || environment.GITHUB_TOKEN) return environment;
  if (!githubTokenCache.has(owner)) {
    try {
      const authEnvironment = { ...process.env };
      delete authEnvironment.GH_TOKEN;
      delete authEnvironment.GITHUB_TOKEN;
      const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com', '--user', owner], {
        encoding: 'utf8',
        env: authEnvironment,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      githubTokenCache.set(owner, token || null);
    } catch {
      githubTokenCache.set(owner, null);
    }
  }
  const token = githubTokenCache.get(owner);
  if (token) environment.GH_TOKEN = token;
  return environment;
}

async function runGh(args, options = {}) {
  if (!githubCliAvailable()) throw githubCliError();
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: options.cwd,
      timeout: options.timeout || 20_000,
      maxBuffer: 32 * 1024 * 1024,
      env: githubEnvironment(options.owner)
    });
    return stdout;
  } catch (error) {
    if (error?.code === 'ENOENT') throw githubCliError();
    throw error;
  }
}

async function ghJson(endpoint) {
  const owner = String(endpoint).match(/^repos\/([^/]+)\//)?.[1] || '';
  const output = await runGh(['api', endpoint, '--header', 'Accept: application/vnd.github+json'], { owner });
  return JSON.parse(output || 'null');
}

function flattenPages(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.every((page) => Array.isArray(page)) ? payload.flat() : payload;
}

function parseJsonLines(output) {
  return String(output || '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function ghCollection(endpoint) {
  const owner = String(endpoint).match(/^repos\/([^/]+)\//)?.[1] || '';
  const output = await runGh(['api', endpoint, '--paginate', '--jq', '.[]', '--header', 'Accept: application/vnd.github+json'], { owner });
  return parseJsonLines(output);
}

function cleanComment(item, kind) {
  return {
    id: `${kind}:${item.id}`,
    kind,
    author: String(item.user?.login || 'unknown').slice(0, 100),
    body: String(item.body || '').slice(0, 20_000),
    url: String(item.html_url || '').slice(0, 1000),
    path: String(item.path || '').slice(0, 1000),
    line: Number(item.line || item.original_line) || null,
    state: String(item.state || '').slice(0, 40),
    createdAt: item.created_at || item.submitted_at || '',
    updatedAt: item.updated_at || item.submitted_at || item.created_at || ''
  };
}

function reactionSummary(reactions) {
  const summaries = new Map();
  for (const reaction of reactions || []) {
    const name = String(reaction.content || '');
    const summary = summaries.get(name) || { name, emoji: REACTION_EMOJI[name] || name, count: 0, authors: [] };
    summary.count += 1;
    const author = String(reaction.user?.login || '').trim();
    if (author && !summary.authors.includes(author)) summary.authors.push(author);
    summaries.set(name, summary);
  }
  return [...summaries.values()].filter((item) => item.count > 0);
}

function changedPullRequestComments(previous, next) {
  const previousComments = new Map((previous?.comments || []).map((item) => [item.id, `${item.updatedAt}:${item.body}:${item.state}`]));
  return (next?.comments || []).filter((item) => previousComments.get(item.id) !== `${item.updatedAt}:${item.body}:${item.state}`);
}

function commentRevisionKey(comment) {
  return crypto.createHash('sha256').update(JSON.stringify([
    comment?.id || '', comment?.updatedAt || '', comment?.body || '', comment?.state || ''
  ])).digest('hex');
}

function hasCodexThumbsUp(pull, actorLogins) {
  return (pull?.reactions || []).some((reaction) => reaction.name === '+1'
    && reaction.count > 0
    && (reaction.authors || []).some((author) => isCodexAuthor(author, actorLogins)));
}

function successfulGitCommit(output) {
  const plain = String(output || '').replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
  return plain.match(/(?:^|\n)\[[^\]\r\n]+\s+([0-9a-f]{7,40})\]\s+[^\r\n]+/i)?.[1] || '';
}

function isActionableCodexComment(comment, actorLogins) {
  if (!isCodexAuthor(comment?.author, actorLogins) || !String(comment?.body || '').trim()) return false;
  return comment.kind !== 'review' || String(comment.state || '').toUpperCase() !== 'APPROVED';
}

function sameGitRevision(left, right) {
  const first = String(left || '').toLowerCase();
  const second = String(right || '').toLowerCase();
  return Boolean(first && second && (first === second || first.startsWith(second) || second.startsWith(first)));
}

function reconcileCodexApproval(previous, snapshot, pendingLocalHeadSha = '', actorLogins) {
  const approved = hasCodexThumbsUp(snapshot, actorLogins);
  const wasApproved = hasCodexThumbsUp(previous, actorLogins);
  let approvalHeadSha = String(previous?.codexApprovalHeadSha || '');
  let promptedHeadSha = String(previous?.mergePromptedHeadSha || (previous?.mergePrompted ? previous?.headSha : '') || '');
  let pendingHeadSha = String(pendingLocalHeadSha || previous?.pendingLocalHeadSha || '');

  if (pendingHeadSha && sameGitRevision(pendingHeadSha, snapshot?.headSha)) pendingHeadSha = '';
  if (!approved) {
    approvalHeadSha = '';
    promptedHeadSha = '';
  } else if (!wasApproved) {
    approvalHeadSha = String(snapshot?.headSha || '');
  } else if (!approvalHeadSha) {
    approvalHeadSha = String(previous?.headSha || snapshot?.headSha || '');
  }

  const ready = Boolean(approved && !pendingHeadSha && sameGitRevision(approvalHeadSha, snapshot?.headSha));
  return {
    codexApprovalHeadSha: approvalHeadSha,
    mergePromptedHeadSha: promptedHeadSha,
    mergePrompted: Boolean(promptedHeadSha),
    pendingLocalHeadSha: pendingHeadSha,
    ready,
    shouldPrompt: ready && !sameGitRevision(promptedHeadSha, snapshot?.headSha)
  };
}

async function fetchPullRequest(value) {
  const ref = parsePullRequestUrl(value);
  const root = `repos/${ref.owner}/${ref.repo}`;
  const [pull, reactions, issueComments, reviewComments, reviews] = await Promise.all([
    ghJson(`${root}/pulls/${ref.number}`),
    ghCollection(`${root}/issues/${ref.number}/reactions?per_page=100`),
    ghCollection(`${root}/issues/${ref.number}/comments?per_page=100`),
    ghCollection(`${root}/pulls/${ref.number}/comments?per_page=100`),
    ghCollection(`${root}/pulls/${ref.number}/reviews?per_page=100`)
  ]);
  const comments = [
    ...(issueComments || []).map((item) => cleanComment(item, 'conversation')),
    ...(reviewComments || []).map((item) => cleanComment(item, 'review-comment')),
    ...(reviews || []).filter((item) => String(item.body || '').trim()).map((item) => cleanComment(item, 'review'))
  ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id));
  const result = {
    url: ref.url,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    title: String(pull.title || '').slice(0, 500),
    body: String(pull.body || '').slice(0, 30_000),
    author: String(pull.user?.login || '').slice(0, 100),
    state: pull.merged ? 'merged' : String(pull.state || 'open'),
    draft: Boolean(pull.draft),
    headSha: String(pull.head?.sha || '').slice(0, 100),
    updatedAt: String(pull.updated_at || ''),
    reactions: reactionSummary(reactions),
    comments
  };
  result.fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    updatedAt: result.updatedAt,
    headSha: result.headSha,
    reactions: result.reactions,
    comments: result.comments.map((item) => [item.id, item.updatedAt, item.body, item.state])
  })).digest('hex');
  result.commentFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    comments: result.comments.map((item) => [item.id, item.updatedAt, item.body, item.state])
  })).digest('hex');
  return result;
}

async function discoverPullRequest(cwd) {
  const output = await runGh(['pr', 'view', '--json', 'url,state', '--jq', 'select(.state == "OPEN") | .url'], { cwd, owner: githubRepositoryOwner(cwd) });
  return parsePullRequestUrl(output.trim()).url;
}

async function postPullRequestComment(value, body) {
  const ref = parsePullRequestUrl(value);
  const output = await runGh([
    'api', '--method', 'POST', `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`,
    '-f', `body=${String(body || '').slice(0, 20_000)}`
  ], { owner: ref.owner });
  const result = JSON.parse(output);
  return { id: result.id, url: result.html_url, body: result.body, createdAt: result.created_at };
}

async function mergePullRequest(value, options = {}) {
  const ref = parsePullRequestUrl(value);
  const headSha = String(options.headSha || '');
  if (!/^[0-9a-f]{7,40}$/i.test(headSha)) throw new Error('The approved pull-request revision is missing or invalid. Refresh the pull request before merging.');
  const execute = options.runGh || runGh;
  const currentOutput = await execute(['pr', 'view', ref.url, '--json', 'state,headRefOid'], { owner: ref.owner, timeout: 20_000 });
  const current = JSON.parse(currentOutput || '{}');
  if (String(current.state || '').toUpperCase() !== 'OPEN' || !sameGitRevision(current.headRefOid, headSha)) {
    throw new Error('The pull request is no longer open at the approved revision. Refresh it before merging.');
  }
  const reactionsOutput = await execute([
    'api', '--paginate', '--slurp', `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/reactions?per_page=100`
  ], { owner: ref.owner, timeout: 20_000 });
  const reactions = reactionSummary(flattenPages(JSON.parse(reactionsOutput || '[]')));
  if (!hasCodexThumbsUp({ reactions }, options.codexActorLogins)) {
    throw new Error('Codex approval is no longer present on the pull request. Refresh it before merging.');
  }
  let strategy = '--merge';
  try {
    const output = await execute(['api', `repos/${ref.owner}/${ref.repo}`], { owner: ref.owner, timeout: 20_000 });
    const repository = JSON.parse(output || '{}');
    strategy = repository.allow_merge_commit
      ? '--merge'
      : repository.allow_squash_merge
        ? '--squash'
        : repository.allow_rebase_merge
          ? '--rebase'
          : '';
    if (!strategy) throw new Error('This repository does not have an enabled pull-request merge strategy.');
  } catch (error) {
    if (/does not have an enabled/.test(String(error?.message || ''))) throw error;
    throw new Error(`SideTerm could not determine the repository's enabled merge strategy: ${String(error?.message || error)}`);
  }
  await execute(['pr', 'merge', ref.url, strategy, '--match-head-commit', headSha], { owner: ref.owner, timeout: 120_000 });
  let state = 'UNKNOWN';
  try {
    const output = await execute(['pr', 'view', ref.url, '--json', 'state'], { owner: ref.owner, timeout: 20_000 });
    state = String(JSON.parse(output || '{}').state || 'UNKNOWN').toUpperCase();
  } catch {}
  return { merged: state === 'MERGED', submitted: true, state, url: ref.url, number: ref.number, headSha };
}

function isCodexAuthor(author, actorLogins = ['chatgpt-codex-connector', 'codex', 'openai-codex']) {
  const normalized = String(author || '').trim().replace(/\[bot\]$/i, '').toLowerCase();
  return actorLogins.map((item) => String(item).trim().replace(/\[bot\]$/i, '').toLowerCase()).includes(normalized);
}

function shouldPollPullRequest(pull) {
  // Keep a lightweight observation loop for every open PR. An approval is not
  // permanent: the reaction can be withdrawn and GitHub can advance the head
  // without SideTerm seeing a local commit first.
  return String(pull?.state || '').toLowerCase() === 'open';
}

function pullRequestChanged(previous, next) {
  return Boolean(previous?.fingerprint && previous.fingerprint !== next?.fingerprint);
}

module.exports = {
  changedPullRequestComments,
  commentRevisionKey,
  discoverPullRequest,
  fetchPullRequest,
  flattenPages,
  githubCliAvailable,
  githubRepositoryOwner,
  isCodexAuthor,
  isActionableCodexComment,
  hasCodexThumbsUp,
  mergePullRequest,
  parsePullRequestUrl,
  parseJsonLines,
  postPullRequestComment,
  pullRequestChanged,
  reactionSummary,
  reconcileCodexApproval,
  sameGitRevision,
  shouldPollPullRequest,
  successfulGitCommit
};
