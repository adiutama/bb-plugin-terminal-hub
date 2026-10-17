// The Services page's plugin RPC: what the page asks the server entry, which
// scans and signals processes on the machine running bb (ADR 202610171646).
// The page imports only the types; the schemas run on the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** A listed process. `pid` with `startedAt` is its identity (SVC-8). */
export const serviceSchema = z.object({
  pid: z.number().int(),
  /** SVC-4: its TCP listening ports, ascending. */
  ports: z.array(z.number().int()),
  command: z.string(),
  /** When it started, in ms, to the second (`ps -o lstart`). */
  startedAt: z.number(),
  environmentId: z.string(),
  /** SVC-18: from `BB_THREAD_ID`. */
  threadId: z.string().nullable(),
  /** SVC-18: the thread's title, when bb knows the thread. */
  threadTitle: z.string().nullable(),
  /** SVC-5: standard output, when it is a regular file. */
  logPath: z.string().nullable(),
});

/** SVC-14: one environment's processes, or SVC-11: an environment not checked. */
export const serviceGroupSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  environmentId: z.string(),
  /** LIST-34: the name as the Terminals page shows it. */
  environmentName: z.string(),
  /** SVC-11: false for an environment on another host. */
  checked: z.boolean(),
  services: z.array(serviceSchema),
});

export const servicesListSchema = z.object({
  /** SVC-12: false where `lsof` is not available. */
  available: z.boolean(),
  /** SVC-11: bb said which host it runs on; when not, no environment is checked. */
  hostKnown: z.boolean(),
  /** SVC-14: in LIST-33's order. */
  groups: z.array(serviceGroupSchema),
  /** Why bb's projects or environments could not be listed, if they could not. */
  error: z.string().nullable(),
});

const identitySchema = z.object({ pid: z.number().int(), startedAt: z.number() }).strict();

const changedSchema = z.object({ outcome: z.literal("changed") });

export const stopPlanSchema = z.discriminatedUnion("outcome", [
  changedSchema,
  z.object({
    outcome: z.literal("ready"),
    /** SVC-19: the listener's whole process group, or only the listener. */
    scope: z.enum(["group", "process"]),
    /** The process group, or the listener's PID when only it is signalled. */
    target: z.number().int(),
    /** SVC-19: how many processes will be signalled, and what they run. */
    commands: z.array(z.string()),
  }),
]);

/** SVC-19: what the confirmation said; Stop signals nothing else. */
const expectedSchema = z
  .object({
    scope: z.enum(["group", "process"]),
    target: z.number().int(),
    count: z.number().int(),
  })
  .strict();

export const servicesContract = defineRpcContract({
  "services.list": { input: z.null(), output: servicesListSchema },
  /** SVC-19: what Stop would signal, for its confirmation. */
  "services.plan": { input: identitySchema, output: stopPlanSchema },
  /** SVC-8, SVC-9: SIGTERM, or SIGKILL with `force`, after the identity check. */
  "services.stop": {
    input: identitySchema.extend({ force: z.boolean(), expected: expectedSchema }).strict(),
    output: z.discriminatedUnion("outcome", [
      changedSchema,
      z.object({ outcome: z.literal("signalled"), count: z.number().int() }),
    ]),
  },
  /** SVC-5: the last 64 KB of the process's log file. */
  "services.log": {
    input: identitySchema,
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("ended") }),
      z.object({ outcome: z.literal("none") }),
      z.object({
        outcome: z.literal("log"),
        path: z.string(),
        text: z.string(),
        /** The file could not be read. */
        error: z.string().nullable(),
      }),
    ]),
  },
});

export type Service = z.infer<typeof serviceSchema>;
export type ServiceGroup = z.infer<typeof serviceGroupSchema>;
export type ServicesList = z.infer<typeof servicesListSchema>;
export type StopPlan = z.infer<typeof stopPlanSchema>;
export type StopExpectation = z.infer<typeof expectedSchema>;
export type ServicesContract = typeof servicesContract;
