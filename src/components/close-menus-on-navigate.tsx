"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The header and its menus persist across client navigation, so a menu whose link was followed
 * would stay open over the new page. This closes every open menu and panel when the page changes,
 * and only then: a panel opened before the page finished loading stays open.
 */
export function CloseMenusOnNavigate() {
  const page = `${usePathname()}?${useSearchParams().toString()}`;
  const shown = useRef(page);
  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    for (const menu of document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")) menu.open = false;
  }, [page]);
  return null;
}
