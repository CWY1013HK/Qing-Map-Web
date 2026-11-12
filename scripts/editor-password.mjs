#!/usr/bin/env node
/**
 * Mint / list / revoke per-editor passwords for /editor (dev server).
 *
 *   npm run editor-password -- add "Alice"
 *   npm run editor-password -- add "Alice" "custom-secret"   # optional fixed password
 *   npm run editor-password -- list
 *   npm run editor-password -- revoke ed-xxxx
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendGrantLog,
  editorPaths,
  findEditor,
  hashPassword,
  readEditors,
  writeEditors,
} from './editor-auth.mjs'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function newEditorId() {
  return `ed-${crypto.randomBytes(6).toString('hex')}`
}

function newPassword() {
  return crypto.randomBytes(18).toString('base64url')
}

function usage() {
  console.error(`Usage:
  npm run editor-password -- add <name> [password]
  npm run editor-password -- list
  npm run editor-password -- revoke <editorId>`)
  process.exit(1)
}

const [cmd, arg, arg2] = process.argv.slice(2)
if (!cmd) usage()

const paths = editorPaths(projectRoot)

if (cmd === 'list') {
  const data = readEditors(projectRoot)
  if (!data.editors.length) {
    console.log('No editors.')
    process.exit(0)
  }
  for (const e of data.editors) {
    const status = e.revokedAt ? `revoked ${e.revokedAt}` : 'active'
    console.log(`${e.id}\t${e.label}\tgranted ${e.createdAt}\t${status}`)
  }
  process.exit(0)
}

if (cmd === 'add') {
  const label = arg?.trim()
  if (!label) usage()
  const grantedAt = new Date().toISOString()
  const id = newEditorId()
  const password = arg2?.length ? String(arg2) : newPassword()
  const data = readEditors(projectRoot)
  data.editors.push({
    id,
    label,
    passwordHash: hashPassword(password),
    createdAt: grantedAt,
  })
  writeEditors(paths.editors, data)
  appendGrantLog(projectRoot, { action: 'grant', editorId: id, label, grantedAt })
  console.log(`Editor: ${label}`)
  console.log(`Id:     ${id}`)
  console.log(`Granted: ${grantedAt}`)
  console.log(`Password (show once): ${password}`)
  console.log('Optionally record in EDITOR-PASSWORDS.md (gitignored; see docs/editor.md).')
  process.exit(0)
}

if (cmd === 'revoke') {
  const id = arg?.trim()
  if (!id) usage()
  const data = readEditors(projectRoot)
  const editor = findEditor(data, id)
  if (!editor) {
    console.error(`No editor ${id}`)
    process.exit(1)
  }
  if (editor.revokedAt) {
    console.error(`Already revoked at ${editor.revokedAt}`)
    process.exit(1)
  }
  const revokedAt = new Date().toISOString()
  editor.revokedAt = revokedAt
  writeEditors(paths.editors, data)
  appendGrantLog(projectRoot, {
    action: 'revoke',
    editorId: id,
    label: editor.label,
    grantedAt: editor.createdAt,
    revokedAt,
  })
  console.log(`Revoked ${id} (${editor.label}) at ${revokedAt}`)
  process.exit(0)
}

usage()
