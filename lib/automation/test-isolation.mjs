import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

function block(config, name) {
  const section = config.match(new RegExp(`^\\[${name}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm'))
  assert.ok(section, `Missing generated ${name} configuration`)
  return section[1]
}

/** Validate before constructing any API client or mutating test fixtures. */
export function validateApiTestIsolation({ actualRoot, metadata, config, apiUrl }) {
  assert.equal(metadata.root, actualRoot, 'Isolation metadata belongs to another checkout')
  const lane = metadata.app - 3100
  assert.ok(Number.isInteger(lane) && lane >= 1 && lane <= 6, 'Invalid isolated lane')
  const app = 3100 + lane
  const api = 55000 + lane * 100 + 1
  const db = api + 1
  const project = `erp-${createHash('sha256').update(actualRoot).digest('hex').slice(0, 10)}-${lane}`
  assert.equal(metadata.api, api, 'Mismatched API lane')
  assert.equal(metadata.db, db, 'Mismatched DB lane')
  assert.equal(metadata.project, project, 'Mismatched checkout project fingerprint')
  assert.equal(config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1], project, 'Mismatched runtime project')
  assert.equal(Number(block(config, 'api').match(/^port\s*=\s*(\d+)\s*$/m)?.[1]), api, 'Mismatched runtime API port')
  assert.equal(Number(block(config, 'db').match(/^port\s*=\s*(\d+)\s*$/m)?.[1]), db, 'Mismatched runtime DB port')
  assert.equal(block(config, 'auth').match(/^site_url\s*=\s*"([^"]+)"/m)?.[1], `http://127.0.0.1:${app}`, 'Mismatched runtime app URL')
  assert.equal(apiUrl, `http://127.0.0.1:${api}`, 'API tests require the exact isolated loopback URL')
  return { lane, app, api, db, project }
}
