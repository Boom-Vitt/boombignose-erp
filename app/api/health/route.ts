// Local liveness check for the bundled server. It does not read a database
// and it does not call a cloud service.
export function GET() {
  return Response.json({ ok: true })
}
