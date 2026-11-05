import { TaskDetail } from "@/components/task-detail";
import { Peek } from "@/components/ui/peek";
import { routes } from "@/lib/routes";

/** A task opened from a list or the board: a side peek, so the board stays in view beside it. */
export default async function TaskPeek({ params }: PageProps<"/w/[slug]/tasks/[id]">) {
  const { slug, id } = await params;
  return (
    <Peek label="Task" layout="side" pageHref={routes.task(slug, id)}>
      <TaskDetail slug={slug} taskId={id} headingLevel={2} />
    </Peek>
  );
}
