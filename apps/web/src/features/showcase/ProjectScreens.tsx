import { Link } from 'react-router-dom';
import type { CatalogPage, ShowcaseProject } from './showcase-catalog';
import { catalogKind, catalogPageQualifier, catalogPageTitle } from './catalog-sections';
import { SidebarSection } from './SidebarSection';
import { LocalizedView } from './showcase-locale';
import { orderedScreenPages } from './screen-navigation';

export function ProjectScreens({
  projects,
  pages,
  visible,
  projectId,
  activeKey,
  filter,
  onVisit,
}: {
  projects: ShowcaseProject[];
  pages: CatalogPage[];
  visible: CatalogPage[];
  projectId: string;
  activeKey: string;
  filter: string;
  onVisit: () => void;
}) {
  const screens = pages.filter((page) => catalogKind(page) === 'page');
  return projects.map((project) => {
    const projectPages = screens.filter((page) => page.projectId === project.id);
    if (!projectPages.length) return null;
    const rows = orderedScreenPages(visible.filter((page) => page.projectId === project.id));
    if (!rows.length) return null;
    const active = rows.some(
      (page) => activeKey === `/pages/${page.projectId}/${page.clientId}/${page.pageKey}`,
    );
    return (
      <LocalizedView key={project.id}>
        <div data-screen-project={project.id}>
          <SidebarSection
            group
            title={project.name}
            count={rows.length}
            activeKey={active ? activeKey : ''}
            defaultOpen={project.id === projectId}
            forceOpen={Boolean(filter)}
          >
            <div className="library-sidebar_rows__muylU">
              {rows.map((page) => {
                const path = `/pages/${page.projectId}/${page.clientId}/${page.pageKey}`;
                const qualifier = catalogPageQualifier(page, projectPages);
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={onVisit}
                    className="library-sidebar_row__aE5SY"
                    data-sidebar-key={path}
                    aria-current={activeKey === path ? 'page' : undefined}
                  >
                    <span className="library-sidebar_label__EP9jR">{catalogPageTitle(page)}</span>
                    {qualifier && (
                      <>
                        {' '}
                        <small className="showcase-page-qualifier">{qualifier}</small>
                      </>
                    )}
                    {page.access === 'restricted' && <span className="library-sidebar_pro__c08K_">授权</span>}
                  </Link>
                );
              })}
            </div>
          </SidebarSection>
        </div>
      </LocalizedView>
    );
  });
}
