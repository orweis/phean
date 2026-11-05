import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { WorkflowEditor } from "@/components/workflow-editor";
import { requireWorkspace } from "@/server/auth/session";
import { can } from "@/server/domain/policy";
import { getWorkflow } from "@/server/domain/workflow";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const stages = await getWorkflow(ctx, {});
  const canEdit = can(ctx.actor, "workflow:manage");

  return (
    <>
      <PageHeader title="Settings" description={`How ${ctx.tenant.name} works. Changes apply to everyone in the workspace and to its agents.`} />
      <Card className="max-w-4xl">
        <CardHeader
          title="Board stages"
          description={
            canEdit
              ? "The lanes tasks move through. Rename or hide each kind's stage, and add your own inside a kind, such as Review before Done. Charts keep counting by kind; agents read these stages from whoami."
              : "The lanes tasks move through. Only workspace owners and admins can change them."
          }
        />
        <CardBody>
          {/* Remounts after a save, so the form always starts from what is stored. */}
          <WorkflowEditor key={JSON.stringify(stages)} slug={slug} stages={stages} canEdit={canEdit} />
        </CardBody>
      </Card>
    </>
  );
}
