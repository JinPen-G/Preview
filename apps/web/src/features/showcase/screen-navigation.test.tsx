import { expect, it } from 'vitest';
import { orderedScreenPages, screenNavigation } from './screen-navigation';
import type { CatalogPage } from './showcase-catalog';

const page = (key: string, group: string, order: number): CatalogPage => ({
  projectId: 'project',
  projectName: 'Project',
  clientId: 'web',
  clientName: 'Web',
  pageKey: key,
  title: key,
  category: `Web · ${key}`,
  kind: 'page',
  allowed: true,
  access: 'public',
  navigationGroup: group,
  navigationOrder: order,
});

it('uses one grouped sequence for flat Screens and two-level application navigation', () => {
  const pages = [
    page('stations', 'Locations', 3),
    page('vehicles', 'Fleet', 1),
    page('companies', 'Locations', 2),
    page('orders', 'Orders', 0),
  ];
  const flat = orderedScreenPages(pages);
  const groups = screenNavigation(
    pages,
    'project',
    (page) => page.pageKey,
    (value) => value,
  );
  expect(groups.map((group) => group.label)).toEqual(['Orders', 'Fleet', 'Locations']);
  expect(groups.flatMap((group) => group.routes.map((route) => route.key))).toEqual(
    flat.map((page) => page.pageKey),
  );
  expect(flat.map((page) => page.pageKey)).toEqual(['orders', 'vehicles', 'companies', 'stations']);
  expect(pages[0].pageKey).toBe('stations');
});

it('keeps legacy entries, visibility, project boundaries and repeated page qualifiers', () => {
  const first = page('first', 'Fleet', 0);
  const legacy = {
    ...page('legacy', 'unused', 0),
    category: 'Web · Locations',
    navigationGroup: undefined,
    navigationOrder: undefined,
  };
  const pages = [
    first,
    { ...first, clientId: 'enterprise', clientName: 'Enterprise' },
    legacy,
    { ...page('locked', 'Private', 1), allowed: false },
    { ...page('component', 'Components', 2), kind: 'component' as const },
    { ...page('other', 'Other', 3), projectId: 'other' },
  ];
  const groups = screenNavigation(
    pages,
    'project',
    (page) => `${page.clientId}/${page.pageKey}`,
    (value) => value,
  );
  expect(groups.map((group) => group.label)).toEqual(['Fleet', 'Locations']);
  expect(groups[0].routes.map((route) => route.qualifier)).toEqual(['Web', 'Enterprise']);
  expect(groups.flatMap((group) => group.routes)).toHaveLength(3);
  expect(orderedScreenPages(pages.filter((page) => page.projectId === 'project'))).toContainEqual(pages[3]);
});
