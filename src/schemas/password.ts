import { z } from "zod";

// Password rules shared by every form that sets a password and by the server.
// Length beats complexity rules (NIST 800-63B): at least 12 characters, no
// forced symbols, and the most common choices are refused outright.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

const COMMON = new Set([
  "password1234", "password12345", "123456789012", "qwertyuiop12", "iloveyou1234", "passwordpassword",
  "letmein12345", "welcome12345", "admin1234567", "changeme1234", "kenya1234567", "nairobi12345",
  "church123456", "jesus1234567", "godisgood123", "amen12345678", "treasurer123", "quotamaster1",
  "000000000000", "111111111111", "123123123123", "abc123abc123", "qwerty123456", "football1234",
]);

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "That password is too common; choose something less guessable";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email address in your password";
  return null;
}

export const newPasswordSchema = (email?: string) =>
  z
    .object({ password: z.string(), confirm: z.string() })
    .superRefine((v, ctx) => {
      const problem = passwordProblem(v.password, email);
      if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
      if (v.password !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "The two passwords don't match" });
    });
