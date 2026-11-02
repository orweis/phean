"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { createWorkspaceAction } from "@/app/workspaces/actions";

import { ActionForm } from "./ui/action-form";
import { Field, Input } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function CreateWorkspaceForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <ActionForm action={createWorkspaceAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Workspace name" htmlFor="workspace-name">
        <Input
          id="workspace-name"
          name="name"
          required
          maxLength={80}
          placeholder="Acme Corp"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(slugify(event.target.value));
          }}
        />
      </Field>
      <Field label="URL" htmlFor="workspace-slug">
        <div className="flex h-9 items-center rounded-md border border-edge bg-sunken pl-3 text-sm text-muted hover:border-ink-2 focus-within:border-focus focus-within:outline-2 focus-within:outline-focus">
          /w/
          <input
            id="workspace-slug"
            name="slug"
            required
            pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
            title="Lowercase letters, numbers, and dashes"
            placeholder="acme"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
            className="h-full min-w-0 flex-1 rounded-r-md bg-panel px-1 text-ink placeholder:text-muted focus:outline-none"
          />
        </div>
      </Field>
      <SubmitButton variant="primary">
        <Plus aria-hidden />
        Create
      </SubmitButton>
    </ActionForm>
  );
}
