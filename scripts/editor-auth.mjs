/**
 * Dev editor auth: per-editor passwords, signed sessions, grant + edit audit logs.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const COOKIE_NAME = 'qing-editor-session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

export function editorPaths(projectRoot) {
  const dir = path.join(projectRoot, 'data', 'editor')
  return {
    dir,
    editors: path.join(dir, 'editors.json'),
    secret: path.join(dir, 'session.secret'),
    audit: path.join(dir, 'audit.jsonl'),
    grants: path.join(dir, 'grants.jsonl'),
  }
}

function ensureEditorDir(projectRoot) {
  const paths = editorPaths(projectRoot)
  fs.mkdirSync(paths.dir, { recursive: true })
  if (!fs.existsSync(paths.secret)) {
    fs.writeFileSync(paths.secret, crypto.randomBytes(32).toString('base64url'), 'utf8')
  }
  if (!fs.existsSync(paths.editors)) {
    writeEditors(paths.editors, { version: 1, editors: [] })
  }
  return paths
}

export function readEditors(projectRoot) {
  const { editors } = ensureEditorDir(projectRoot)
  const raw = JSON.parse(fs.readFileSync(editors, 'utf8'))
  if (!raw || !Array.isArray(raw.editors)) throw new Error('Bad editors.json')
  return raw
}

export function writeEditors(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function findEditor(data, id) {
  return data.editors.find((e) => e.id === id) ?? null
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false
  const parts = stored.split('$')
  if (parts.length !== 3) return false
  const salt = Buffer.from(parts[1], 'base64url')
  const expected = Buffer.from(parts[2], 'base64url')
  const actual = crypto.scryptSync(password, salt, 64)
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}

function readSecret(projectRoot) {
  const { secret } = ensureEditorDir(projectRoot)
  return fs.readFileSync(secret, 'utf8').trim()
}

function signPayload(projectRoot, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', readSecret(projectRoot)).update(body).digest('base64url')
  return `${body}.${sig}`
}

function parseCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function parseSession(projectRoot, token) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.', 2)
  const expected = crypto.createHmac('sha256', readSecret(projectRoot)).update(body).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.editorId || typeof payload.exp !== 'number') return null
  if (Date.now() > payload.exp) return null
  const data = readEditors(projectRoot)
  const editor = findEditor(data, payload.editorId)
  if (!editor || editor.revokedAt) return null
  return { editorId: editor.id, label: editor.label }
}

export function createSessionToken(projectRoot, editorId) {
  return signPayload(projectRoot, { editorId, exp: Date.now() + SESSION_MS })
}

export function appendJsonl(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8')
}

export function appendGrantLog(projectRoot, entry) {
  const { grants } = editorPaths(projectRoot)
  appendJsonl(grants, { at: new Date().toISOString(), ...entry })
}

export function appendAuditLog(projectRoot, entry) {
  const { audit } = editorPaths(projectRoot)
  appendJsonl(audit, { at: new Date().toISOString(), ...entry })
}

export function editorFromRequest(projectRoot, req) {
  const token = parseCookie(req, COOKIE_NAME)
  if (!token) return null
  return parseSession(projectRoot, token)
}

export function loginWithPassword(projectRoot, password) {
  const data = readEditors(projectRoot)
  for (const editor of data.editors) {
    if (editor.revokedAt) continue
    if (verifyPassword(password, editor.passwordHash)) {
      return { editorId: editor.id, label: editor.label }
    }
  }
  return null
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_MS / 1000)
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
  )
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/** Returns true if the request was handled (editor auth routes). */
export async function handleEditorAuthRoutes(projectRoot, req, res, urlPath) {
  ensureEditorDir(projectRoot)

  if (req.method === 'GET' && urlPath === '/__dev/editor/session') {
    const session = editorFromRequest(projectRoot, req)
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Not signed in' })
      return true
    }
    sendJson(res, 200, { ok: true, editor: { id: session.editorId, label: session.label } })
    return true
  }

  if (req.method === 'POST' && urlPath === '/__dev/editor/login') {
    try {
      const body = await readBody(req)
      const password = String(body.password ?? '')
      if (!password) {
        sendJson(res, 400, { ok: false, error: 'Missing password' })
        return true
      }
      const match = loginWithPassword(projectRoot, password)
      if (!match) {
        sendJson(res, 401, { ok: false, error: 'Invalid password' })
        return true
      }
      const token = createSessionToken(projectRoot, match.editorId)
      setSessionCookie(res, token)
      sendJson(res, 200, { ok: true, editor: { id: match.editorId, label: match.label } })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
    return true
  }

  if (req.method === 'POST' && urlPath === '/__dev/editor/logout') {
    clearSessionCookie(res)
    sendJson(res, 200, { ok: true })
    return true
  }

  return false
}

export function pathRequiresEditorAuth(urlPath, method) {
  if (!urlPath?.startsWith('/__dev/')) return false
  if (urlPath.startsWith('/__dev/editor/')) return false
  if (method === 'GET' && urlPath === '/__dev/annotations/chgis') return true
  if (method === 'POST') return true
  return false
}

export function requireEditorOr401(projectRoot, req, res) {
  const session = editorFromRequest(projectRoot, req)
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Editor login required' })
    return null
  }
  return session
}
