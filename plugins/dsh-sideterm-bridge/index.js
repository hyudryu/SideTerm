import http from 'node:http'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'sideterm-bridge'
export const inject = ['agents']

function agentRecord(agent, activityByAgent) {
  const id = String(agent.id)
  return {
    id,
    backend: 'deepseek-harness',
    friendlyName: String(agent.session?.title || agent.options?.name || agent.id),
    cwd: String(agent.options?.cwd || ''),
    status: agent.status === 'running' ? 'running' : 'idle',
    semanticState: agent.status === 'running' ? 'working' : undefined,
    currentTask: String(agent.options?.task || ''),
    lastActivityAt: activityByAgent.get(id)
      || Number(agent.session?.updatedAt || agent.session?.createdAt || agent.createdAt)
      || 0
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

async function requestBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256 * 1024) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export function apply(ctx, suppliedConfig = {}) {
  const config = { host: '127.0.0.1', port: 43111, ...suppliedConfig }
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('SideTerm bridge must bind to a loopback host.')
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('SideTerm bridge port must be between 1024 and 65535.')
  if (typeof config.token !== 'string' || config.token.length < 24) throw new Error('SideTerm bridge token must contain at least 24 characters.')
  const eventClients = new Set()
  const activityByAgent = new Map()
  const publish = (value) => {
    const frame = `data: ${JSON.stringify(value)}\n\n`
    for (const response of eventClients) response.write(frame)
  }
  ctx.on('session/event', (session, event) => {
    activityByAgent.set(String(session.id), Number(event?.createdAt || event?.timestamp) || Date.now())
    publish({ topic: 'session/event', sessionId: String(session.id), event })
  })
  ctx.on('agent/created', (agent) => {
    activityByAgent.set(String(agent.id), Date.now())
    publish({ topic: 'agent/status', agent: agentRecord(agent, activityByAgent) })
  })
  ctx.on('agent/disposed', (agent) => {
    activityByAgent.set(String(agent.id), Date.now())
    publish({ topic: 'agent/status', agent: { ...agentRecord(agent, activityByAgent), status: 'stopped' } })
  })

  const dispatch = async (method, input = {}) => {
    if (method === 'agents.list') return ctx.agents.list().map((agent) => agentRecord(agent, activityByAgent))
    const agent = ctx.agents.get(SessionId(String(input.id || '')))
    if (!agent) throw new Error('Harness agent not found.')
    if (method === 'agents.get') return agentRecord(agent, activityByAgent)
    const delivery = method.match(/^agents\.(followup|steer|inject)$/)?.[1]
    if (!delivery) throw new Error('Unknown bridge method.')
    const message = createUserMessage({
      content: [{ type: 'text', text: String(input.message || '').slice(0, 65536) }],
      source: delivery === 'inject'
        ? { kind: 'plugin', plugin: name, form: 'instructions' }
        : { kind: 'user' }
    })
    agent[delivery](message)
    return { accepted: true, messageId: String(message.id), delivery }
  }

  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${config.token}`) return json(response, 401, { error: 'Unauthorized.' })
    if (request.method === 'GET' && request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      response.write(': connected\n\n')
      eventClients.add(response)
      request.on('close', () => eventClients.delete(response))
      return
    }
    if (request.method !== 'POST' || request.url !== '/rpc') return json(response, 404, { error: 'Not found.' })
    try {
      const body = await requestBody(request)
      json(response, 200, { result: await dispatch(String(body.method || ''), body.input || {}) })
    } catch (error) {
      json(response, 400, { error: String(error?.message || error || 'Bridge request failed.') })
    }
  })
  server.on('error', (error) => {
    for (const response of eventClients) response.end()
    eventClients.clear()
    ctx.logger?.warn?.(`SideTerm bridge disabled: ${String(error?.message || error)}`)
  })
  server.listen(config.port, config.host)
  ctx.effect(() => () => {
    for (const response of eventClients) response.end()
    eventClients.clear()
    if (server.listening) server.close()
  })
}
