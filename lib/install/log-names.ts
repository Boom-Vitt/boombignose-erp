/** Start logs the desktop bundle already writes. Nothing else in the data directory is readable here. */
export const START_LOGS = ["server.log", "auth.log", "postgrest.log"] as const
export type StartLogName = (typeof START_LOGS)[number]
