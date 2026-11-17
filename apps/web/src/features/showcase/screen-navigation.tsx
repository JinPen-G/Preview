import { FileText } from 'lucide-react';
import { AnimatedIcon } from '@preview/ui/admin';
import type { ShellSection } from '@preview/ui';
import type { CatalogPage } from './showcase-catalog';
import { catalogKind, catalogPageQualifier, catalogPageTitle } from './catalog-sections';

function sectionLabel(page: CatalogPage) {
  if (page.navigationGroup?.trim()) return page.navigationGroup.trim();
  const category = page.category.trim();
  const prefix = `${page.clientName} · `;
  const label = category.startsWith(prefix) ? category.slice(prefix.length).trim() : category;
  return (
    label.replace(
      /^(?:营运端|營運端|运营端|運營端|企业端|企業端|移动端|移動端|公开教程|公開教程|通知信件)\s*·\s*/u,
      '',
    ) || '页面'
  );
}

export function orderedScreenPages(pages: CatalogPage[]) {
  const ordered = [...pages].sort(
    (left, right) =>
      (left.navigationOrder ?? Number.MAX_SAFE_INTEGER) - (right.navigationOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const groups = new Map<string, CatalogPage[]>();
  for (const page of ordered) {
    const key = `${page.projectId}/${sectionLabel(page)}`;
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }
  return [...groups.values()].flat();
}

export function screenNavigation(
  catalog: CatalogPage[],
  projectId: string,
  route: (page: CatalogPage) => string,
  text: (value: string) => string,
): ShellSection[] {
  const pages = orderedScreenPages(
    catalog.filter((page) => page.projectId === projectId && page.allowed && catalogKind(page) === 'page'),
  );
  const sections = new Map<string, ShellSection>();
  for (const page of pages) {
    const label = sectionLabel(page);
    let section = sections.get(label);
    if (!section) {
      section = {
        key: `${projectId}/${label}`,
        label: text(label),
        icon: <AnimatedIcon name="folder" />,
        routes: [],
      };
      sections.set(label, section);
    }
    const qualifier = catalogPageQualifier(page, pages);
    section.routes.push({
      key: route(page),
      label: text(catalogPageTitle(page)),
      icon: <FileText size={16} />,
      qualifier: qualifier ? text(qualifier) : undefined,
    });
  }
  return [...sections.values()];
}
