import assert from "node:assert/strict"
import { createHash } from "node:crypto"

/**
 * Test-runner guard. Call before constructing clients or creating fixtures.
 * @param {{root: string, project: string, app: number, api: number, db: number}} isolation
 * @param {string} root Canonical worktree path returned by realpath.
 * @param {string} apiUrl Local environment API URL.
 * @param {string} configProject Project ID from the generated local config.
 */
export function assertServiceTestIsolation(isolation, root, apiUrl, configProject) {
  assert.equal(isolation.root, root, "Isolation metadata belongs to another worktree")
  assert.ok(Number.isInteger(isolation.app), "Generated app port must be an integer")
  const lane = isolation.app - 3100
  assert.ok(Number.isInteger(lane) && lane >= 1 && lane <= 6, "Use a generated lane 1..6")
  const project = `erp-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${lane}`
  assert.equal(isolation.project, project, "Isolation project fingerprint does not match this worktree")
  assert.equal(configProject, project, "Generated Supabase config does not match this worktree")
  const base = 55000 + lane * 100
  assert.equal(isolation.api, base + 1, "API port does not match the generated lane")
  assert.equal(isolation.db, base + 2, "DB port does not match the generated lane")
  assert.equal(apiUrl, `http://127.0.0.1:${base + 1}`, "Expected this lane's exact loopback API URL")
}
