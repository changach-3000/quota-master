// Who is asking. Built only from the server-side session, never from a URL or
// request body, and passed explicitly into every service function.

export type Role = "admin" | "treasurer" | "auditor" | "member";

export type Viewer = {
  userId: string;
  role: Role;
  /** The viewer's own parishioner record. Members always have one. */
  parishionerId: string | null;
};

export const STAFF_ROLES: readonly Role[] = ["admin", "treasurer", "auditor"];

export class ForbiddenError extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Parish-wide data: admin, treasurer and auditor (auditor is read-only elsewhere). */
export function assertStaff(viewer: Viewer | null): asserts viewer is Viewer {
  if (!viewer || !STAFF_ROLES.includes(viewer.role)) throw new ForbiddenError();
}

/** Returns the viewer's own parishioner id; the only one member queries may use. */
export function ownParishionerId(viewer: Viewer | null): string {
  if (!viewer?.parishionerId) throw new ForbiddenError();
  return viewer.parishionerId;
}
