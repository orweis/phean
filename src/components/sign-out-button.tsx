"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

import { Button, type ButtonVariant } from "./ui/button";

export function SignOutButton({ redirectTo = routes.home(), label = "Sign out", variant = "ghost" }: { redirectTo?: string; label?: string; variant?: ButtonVariant }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.push(redirectTo);
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden />
      {label}
    </Button>
  );
}
