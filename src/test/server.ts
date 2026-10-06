import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** The shared MSW server. Lifecycle is driven from setup.ts; tests use
 *  `server.use(...)` to install per-test overrides. */
export const server = setupServer(...handlers);
