import { z } from "zod";

/**
 * Workspace boundary (Epic 0 of the secure-ingestion spec).
 *
 * Every tenant-scoped row carries a `workspaceId`. Membership in a workspace,
 * not a global profile role, decides what a manager or admin may reach. This is
 * the contract the database RLS policies mirror.
 */

export const WorkspaceRole = z.enum(["rep", "manager", "admin"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

export const WorkspaceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
    /** Stable, URL-safe identifier. Unique across the deployment. */
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric and hyphens only"),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMembershipSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    /** Authoritative tenant-scoped role. `profiles.role` remains identity only. */
    role: WorkspaceRole,
    createdAt: z.string().datetime(),
  })
  .strict();
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;

/**
 * The resolved actor for a request. A service actor has no browser login and no
 * workspace membership row; it is granted a workspace explicitly per call so it
 * can never operate tenant-wide by default.
 */
export const ActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("user"),
      userId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      role: WorkspaceRole,
    })
    .strict(),
  z
    .object({
      kind: z.literal("service"),
      /** Server-side identifier for the process, not a person. */
      serviceId: z.string().min(1).max(100),
      workspaceId: z.string().uuid(),
    })
    .strict(),
]);
export type Actor = z.infer<typeof ActorSchema>;
