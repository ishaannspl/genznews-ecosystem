"use client";

import { useActionState } from "react";
import { login, type LoginState } from "../actions/auth";

const field = "block w-full min-h-11 border border-current bg-transparent px-3 py-2";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, { error: initialError });

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="section-label mb-1 block">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={field} />
      </div>
      <div>
        <label htmlFor="password" className="section-label mb-1 block">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="text-link min-h-11 self-start px-4">
        Sign in
      </button>
    </form>
  );
}
