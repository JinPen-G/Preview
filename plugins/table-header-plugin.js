import { fileURLToPath } from 'node:url';

const tableModule = fileURLToPath(
  new URL(
    '../packages/preview-ui/src/admin-controls/runtime/apps/admin/src/components/ui/Table.tsx',
    import.meta.url,
  ),
).replaceAll('\\', '/');

const headerChanges = [
  ['business?: { label: string;', 'business?: { heading?: ReactNode; label: string;'],
  [
    'return <DataTableColumnHeader column={column}',
    'return column.columnDef.meta?.business?.heading ?? <DataTableColumnHeader column={column}',
  ],
  [
    'business: { label, render:',
    'business: { label, heading: isValidElement<{ "data-table-heading"?: string }>(title) && title.props["data-table-heading"] === "custom" ? title : undefined, render:',
  ],
];

export function tableHeaderAdapter() {
  return {
    name: 'preview-table-header',
    enforce: 'pre',
    transform(source, id) {
      if (id.split('?')[0].replaceAll('\\', '/') !== tableModule) return;
      let code = source;
      for (const [original, replacement] of headerChanges) {
        if (code.split(original).length !== 2)
          throw new Error(`Unexpected business table header source: ${original}`);
        code = code.replace(original, replacement);
      }
      return { code, map: null };
    },
  };
}
