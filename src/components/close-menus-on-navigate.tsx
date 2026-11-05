"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * The header and its menus persist across client navigation, so a menu whose link was followed
 * would stay open over the new page. This closes every open menu and panel when the page changes.
 */
export function CloseMenusOnNavigate() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) menu.open = false;
  }, [pathname, search]);
  return null;
}
