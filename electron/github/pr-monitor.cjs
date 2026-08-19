const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i;
const REACTION_EMOJI = {
  '+1': '👍', '-1': '👎', laugh: '😄', hooray: '🎉', confused: '😕', heart: '❤️', rocket: '🚀', eyes: '👀'
};

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

async function runGh(args, options = {}) {
  if (!githubCliAvailable()) throw githubCliError();
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: options.cwd,
      timeout: options.timeout || 20_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1' }
    });
    return stdout;
  } catch (error) {
    if (error?.code === 'ENOENT') throw githubCliError();
    throw error;
  }
}

async function ghJson(endpoint) {
  const output = await runGh(['api', endpoint, '--header', 'Accept: application/vnd.github+json']);
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
  const output = await runGh(['api', endpoint, '--paginate', '--jq', '.[]', '--header', 'Accept: application/vnd.github+json']);
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
  const counts = new Map();
  for (const reaction of reactions || []) counts.set(reaction.content, (counts.get(reaction.content) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, emoji: REACTION_EMOJI[name] || name, count }));
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
    ...(reviews || []).filter((item) => item.body || item.state).map((item) => cleanComment(item, 'review'))
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
  const output = await runGh(['pr', 'view', '--json', 'url', '--jq', '.url'], { cwd });
  return parsePullRequestUrl(output.trim()).url;
}

async function postPullRequestComment(value, body) {
  const ref = parsePullRequestUrl(value);
  const output = await runGh([
    'api', '--method', 'POST', `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`,
    '-f', `body=${String(body || '').slice(0, 20_000)}`
  ]);
  const result = JSON.parse(output);
  return { id: result.id, url: result.html_url, body: result.body, createdAt: result.created_at };
}

function isCodexAuthor(author) {
  return /^(?:chatgpt-codex-connector|codex|openai-codex)(?:\[bot\])?$/i.test(String(author || '').trim());
}

function shouldPollPullRequest(pull) {
  return String(pull?.state || '').toLowerCase() === 'open';
}

function pullRequestChanged(previous, next) {
  return Boolean(previous?.fingerprint && previous.fingerprint !== next?.fingerprint);
}

module.exports = {
  discoverPullRequest,
  fetchPullRequest,
  flattenPages,
  githubCliAvailable,
  isCodexAuthor,
  parsePullRequestUrl,
  parseJsonLines,
  postPullRequestComment,
  pullRequestChanged,
  reactionSummary,
  shouldPollPullRequest
};
