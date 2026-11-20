import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/** The blog: the site's bar with Blog marked, the page, and the site's footer. */
export default function BlogLayout({ children }: LayoutProps<"/blog">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader current="blog" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
