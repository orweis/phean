import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Art } from "@/components/marketing/art";
import { cx } from "@/lib/cx";
import { dayOf } from "@/lib/dates";
import { formatLongDay } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { BlogAuthor, BlogPost, BlogTag } from "@/server/blog";

/*
 * The blog's building blocks, laid out after the Permit.io blog: a featured story with its art beside
 * it, a grid of story cards, tag capsules, and the writer under a post. Covers are the site's own
 * illustrations, held in the same rounded frame the landing page uses.
 */

/** A writer's photo, or their initial on a disc when there is none. Decorative: the name is always beside it. */
export function AuthorPhoto({ author, size = "sm" }: { author: BlogAuthor; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-16 text-xl" : "size-8 text-sm";
  return author.image ? (
    // A 200px square served as is; next/image would only resize it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={author.image} alt="" width={200} height={200} className={cx("shrink-0 rounded-full object-cover ring-1 ring-rule", box)} />
  ) : (
    <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-full bg-accent-tint font-bold text-accent-ink", box)}>
      {author.name.slice(0, 1)}
    </span>
  );
}

/** "Or Weis · 20 November 2026 · 6 min read". The author links to their page unless `plain`. */
export function PostMeta({ post, plain = false, className }: { post: BlogPost; plain?: boolean; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted", className)}>
      {plain ? (
        <span className="font-semibold text-ink-2">{post.author.name}</span>
      ) : (
        <Link href={routes.blogAuthor(post.author.slug)} className="flex items-center gap-2 font-semibold text-ink-2 hover:text-ink">
          <AuthorPhoto author={post.author} />
          {post.author.name}
        </Link>
      )}
      <span aria-hidden>·</span>
      <time dateTime={post.date}>{formatLongDay(dayOf(post.date))}</time>
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
    </p>
  );
}

/** A post's cover: its illustration cropped to 16:9 in a rounded frame. */
export function PostCover({ post, sizes, className }: { post: BlogPost; sizes: string; className?: string }) {
  return (
    <div className={cx("relative aspect-video overflow-hidden rounded-xl bg-fill ring-1 ring-rule", className)}>
      <Art id={post.cover} decorative sizes={sizes} className="absolute inset-0 size-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]" />
    </div>
  );
}

/** Tag capsules, each leading to its posts. */
export function TagList({ tags, current, label = "Tags" }: { tags: (BlogTag & { count?: number })[]; current?: string; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const selected = tag.slug === current;
        return (
          <li key={tag.slug}>
            <Link
              href={routes.blogTag(tag.slug)}
              aria-current={selected ? "page" : undefined}
              data-selected={selected || undefined}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset",
                selected ? "bg-accent-tint text-accent-ink ring-accent/30" : "bg-panel text-ink-2 ring-rule hover:text-ink hover:ring-edge",
              )}
            >
              {tag.name}
              {tag.count !== undefined && <span className="font-normal text-muted">{tag.count}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The front page's lead story: the words on one side, its art on the other. */
export function FeaturedPost({ post }: { post: BlogPost }) {
  return (
    <article className="group relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
      <PostCover post={post} sizes="(min-width: 1280px) 40rem, (min-width: 1024px) 52vw, 100vw" className="lg:order-last" />
      <div>
        <h2 className="display text-[clamp(1.875rem,3.4vw,2.75rem)] text-ink">
          <Link href={routes.blog(post.slug)} className="after:absolute after:inset-0 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
            {post.title}
          </Link>
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">{post.description}</p>
        <PostMeta post={post} plain className="mt-5" />
        <p aria-hidden className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
          Read the story <ArrowRight className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />
        </p>
      </div>
    </article>
  );
}

/** One story in a grid. The whole card is the link; its title names it. */
export function PostCard({ post, headingLevel = 3 }: { post: BlogPost; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group relative flex flex-col">
      <PostCover post={post} sizes="(min-width: 1280px) 24rem, (min-width: 768px) 45vw, 100vw" />
      <Heading className="mt-5 font-display text-xl leading-snug font-bold tracking-title text-balance text-ink">
        <Link href={routes.blog(post.slug)} className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4">
          {post.title}
        </Link>
      </Heading>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">{post.description}</p>
      <PostMeta post={post} plain className="mt-4" />
    </article>
  );
}

/** A grid of story cards. */
export function PostGrid({ posts, headingLevel }: { posts: BlogPost[]; headingLevel?: 2 | 3 }) {
  return (
    <ul className="grid gap-x-8 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
      {posts.map((post) => (
        <li key={post.slug}>
          <PostCard post={post} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

/** A section's label over a hairline, as the Permit.io blog heads "Featured stories" and "All stories". */
export function SectionLabel({ id, children }: { id?: string; children: string }) {
  return (
    <div className="mb-8 border-b border-rule pb-3">
      <h2 id={id} className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">
        {children}
      </h2>
    </div>
  );
}

/** The writer under a post, or at the top of their page. */
export function AuthorCard({ author, linkToPage = true }: { author: BlogAuthor; linkToPage?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <AuthorPhoto author={author} size="lg" />
      <div className="min-w-0">
        <p className="font-semibold text-ink">{author.name}</p>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-2">{author.bio}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {linkToPage && (
            <Link href={routes.blogAuthor(author.slug)} className="font-semibold link">
              More from {author.name.split(" ")[0]}
            </Link>
          )}
          {author.linkedin && (
            <a href={author.linkedin} target="_blank" rel="noopener noreferrer" className="text-ink-2 link hover:text-ink">
              LinkedIn<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {author.x && (
            <a href={author.x} target="_blank" rel="noopener noreferrer" className="text-ink-2 link hover:text-ink">
              X<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

/** Previous and next links over a list of stories that runs past one page. */
export function Pager({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="More stories" className="mt-12 flex items-center justify-center gap-4 text-sm">
      {page > 1 && (
        <Link href={`${routes.blog(undefined, page - 1)}#all-stories`} className="font-semibold link">
          Newer stories
        </Link>
      )}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      {page < pages && (
        <Link href={`${routes.blog(undefined, page + 1)}#all-stories`} className="font-semibold link">
          Older stories
        </Link>
      )}
    </nav>
  );
}
